"""Async LLM provider interface and implementations.

Ported from kaira-evals/src/llm/ — converted to async using asyncio.to_thread
to wrap the sync SDK calls (both google-genai and openai SDKs are sync).
"""
import asyncio
import json
import logging
import random
import tempfile
import time
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, Tuple, Type

logger = logging.getLogger(__name__)


class LLMTimeoutError(TimeoutError):
    """Raised when an LLM call exceeds the configured timeout."""
    pass


# Default timeouts (seconds) — matches frontend globalSettingsStore defaults.
# Overridden at runtime when the caller passes user-configured values.
DEFAULT_TIMEOUTS = {
    "text_only": 60,
    "with_schema": 90,
    "with_audio": 180,
    "with_audio_and_schema": 240,
}


class BaseLLMProvider(ABC):
    """Abstract base class for async LLM providers."""

    # Override in subclasses with provider-specific retryable exception types
    RETRYABLE_EXCEPTIONS: Tuple[Type[BaseException], ...] = (ConnectionError, TimeoutError)

    def __init__(self, api_key: str, model_name: str, temperature: float = 1.0):
        self.api_key = api_key
        self.model_name = model_name
        self.temperature = temperature
        # Token counts from the last call. Set from async methods (not sync
        # threads) so reads in LoggingLLMWrapper._save_log are race-free.
        self._last_tokens_in: int | None = None
        self._last_tokens_out: int | None = None
        self._timeouts: dict = dict(DEFAULT_TIMEOUTS)

    def set_timeouts(self, timeouts: dict):
        """Override timeout values from user settings."""
        self._timeouts.update(timeouts)

    def _get_timeout(self, *, has_audio: bool = False, has_schema: bool = False) -> float:
        """Pick the right timeout (seconds) based on call characteristics."""
        if has_audio and has_schema:
            return self._timeouts.get("with_audio_and_schema", DEFAULT_TIMEOUTS["with_audio_and_schema"])
        if has_audio:
            return self._timeouts.get("with_audio", DEFAULT_TIMEOUTS["with_audio"])
        if has_schema:
            return self._timeouts.get("with_schema", DEFAULT_TIMEOUTS["with_schema"])
        return self._timeouts.get("text_only", DEFAULT_TIMEOUTS["text_only"])

    async def _with_retry(self, sync_fn, *args, max_retries: int = 3):
        """Wrap a sync LLM call with exponential backoff for transient errors.

        Replaces bare asyncio.to_thread — the returned coroutine should still be
        wrapped with asyncio.wait_for so the overall timeout applies across all retries.
        """
        for attempt in range(max_retries + 1):
            try:
                return await asyncio.to_thread(sync_fn, *args)
            except self.RETRYABLE_EXCEPTIONS as e:
                if attempt == max_retries:
                    raise
                delay = (2 ** (attempt + 1)) + random.uniform(0, 1)
                logger.warning(
                    "LLM call failed (attempt %d/%d), retrying in %.1fs: %s",
                    attempt + 1, max_retries + 1, delay, e,
                )
                await asyncio.sleep(delay)

    @abstractmethod
    async def generate(
        self, prompt: str, system_prompt: Optional[str] = None,
        response_format: Optional[Dict[str, Any]] = None, **kwargs,
    ) -> str:
        pass

    @abstractmethod
    async def generate_json(
        self, prompt: str, system_prompt: Optional[str] = None,
        json_schema: Optional[Dict[str, Any]] = None, **kwargs,
    ) -> Dict[str, Any]:
        pass

    async def generate_with_audio(
        self, prompt: str, audio_bytes: bytes, mime_type: str = "audio/mpeg",
        json_schema: Optional[Dict[str, Any]] = None, **kwargs,
    ) -> str:
        """Generate content with an audio file. Returns raw text response.

        Override in providers that support audio (e.g., Gemini).
        """
        raise NotImplementedError(f"{type(self).__name__} does not support audio input")


class GeminiProvider(BaseLLMProvider):
    """Async Gemini provider using google-genai SDK."""

    def __init__(
        self, api_key: Optional[str] = None,
        service_account_path: Optional[str] = None,
        model_name: str = "",
        temperature: float = 1.0,
    ):
        super().__init__(api_key or "", model_name, temperature)

        from google import genai
        try:
            from google.api_core.exceptions import ResourceExhausted, ServiceUnavailable
            self.RETRYABLE_EXCEPTIONS = (
                ResourceExhausted, ServiceUnavailable, ConnectionError, TimeoutError,
            )
        except ImportError:
            pass  # Fall back to base class defaults

        if service_account_path:
            from pathlib import Path
            sa_path = Path(service_account_path)
            if sa_path.exists():
                import json as _json
                from google.oauth2 import service_account as sa_module
                with open(sa_path) as f:
                    sa_info = _json.load(f)
                project_id = sa_info.get("project_id", "")
                credentials = sa_module.Credentials.from_service_account_info(
                    sa_info, scopes=["https://www.googleapis.com/auth/cloud-platform"],
                )
                self.client = genai.Client(
                    vertexai=True, project=project_id, credentials=credentials,
                )
                self.auth_method = "service_account"
            else:
                raise FileNotFoundError(f"Service account file not found: {sa_path}")
        elif api_key:
            self.client = genai.Client(api_key=api_key)
            self.auth_method = "api_key"
        else:
            raise ValueError("Either api_key or service_account_path must be provided")

    def _get_model_family(self) -> str:
        """Detect Gemini model family from model name.

        Returns "2.5", "3", or "3.1" to determine thinking config format.
        """
        name = self.model_name.lower()
        if "3.1" in name:
            return "3.1"
        if "3.0" in name or "gemini-3-" in name or "gemini-3" in name.split("-"):
            return "3"
        # Default to 2.5 — covers 2.5-flash, 2.5-pro, 2.0-flash, etc.
        return "2.5"

    def _build_thinking_config(self, thinking: str = "low"):
        """Build model-family-appropriate ThinkingConfig, or None to omit.

        Gemini 2.5 uses thinking_budget (int). Gemini 3+ uses thinking_level (enum).
        These are mutually exclusive — cannot set both.
        Returns None for "off" so callers skip thinking_config entirely
        (Vertex AI rejects thinking_budget=0).

        Args:
            thinking: One of "off", "low", "medium", "high".
        """
        if thinking == "off":
            return None

        from google.genai import types

        family = self._get_model_family()

        if family == "2.5":
            # Gemini 2.5: thinking_budget (integer token count)
            # 2.5 Flash: 1–24576. 2.5 Pro: 128–32768.
            # Using concrete values — Vertex AI rejects 0 and -1 may also be rejected.
            is_pro = "pro" in self.model_name.lower()
            budget_map = {
                "low": 1024,
                "medium": 8192,
                "high": 32768 if is_pro else 24576,
            }
            budget = budget_map.get(thinking, 1024)

            # 2.5 Pro cannot go below 128
            if is_pro and budget < 128:
                budget = 128

            return types.ThinkingConfig(thinking_budget=budget)
        else:
            # Gemini 3+: thinking_level (enum string)
            level_map = {
                "low": "low",
                "medium": "medium",
                "high": "high",
            }
            level = level_map.get(thinking, "low")

            # 3 Pro/3.1 Pro: "medium" not supported
            if "pro" in self.model_name.lower() and level == "medium":
                level = "low"

            return types.ThinkingConfig(thinking_level=level)

    @staticmethod
    def _extract_tokens(response):
        """Extract token counts from Gemini response. Returns (in, out) tuple."""
        tokens_in = tokens_out = None
        if hasattr(response, "usage_metadata") and response.usage_metadata:
            tokens_in = getattr(response.usage_metadata, "prompt_token_count", None)
            tokens_out = getattr(response.usage_metadata, "candidates_token_count", None)
        return tokens_in, tokens_out

    def _sync_generate(self, prompt, system_prompt, thinking="low"):
        from google.genai import types

        config_dict = {"temperature": self.temperature}
        tc = self._build_thinking_config(thinking)
        if tc is not None:
            config_dict["thinking_config"] = tc
        if system_prompt:
            config_dict["system_instruction"] = system_prompt
        config = types.GenerateContentConfig(**config_dict)

        response = self.client.models.generate_content(
            model=self.model_name, contents=prompt, config=config,
        )
        tokens_in, tokens_out = self._extract_tokens(response)
        return response.text, tokens_in, tokens_out

    def _sync_generate_json(self, prompt, system_prompt, json_schema, thinking="low"):
        from google.genai import types

        config_dict = {
            "temperature": self.temperature,
            "response_mime_type": "application/json",
        }
        tc = self._build_thinking_config(thinking)
        if tc is not None:
            config_dict["thinking_config"] = tc
        if system_prompt:
            config_dict["system_instruction"] = system_prompt
        if json_schema:
            config_dict["response_json_schema"] = json_schema
        config = types.GenerateContentConfig(**config_dict)

        response = self.client.models.generate_content(
            model=self.model_name, contents=prompt, config=config,
        )
        tokens_in, tokens_out = self._extract_tokens(response)
        try:
            return json.loads(response.text), tokens_in, tokens_out
        except json.JSONDecodeError:
            text = response.text.strip()
            if text.startswith("```json"):
                text = text[7:]
            if text.endswith("```"):
                text = text[:-3]
            return json.loads(text.strip()), tokens_in, tokens_out

    def _sync_generate_with_audio(self, prompt, audio_bytes, mime_type, json_schema, thinking="low"):
        """Sync helper: build audio part and generate content with it.

        Vertex AI (service_account) does not support the Files API, so we
        send audio bytes inline.  The Developer API (api_key) keeps the
        existing upload-and-poll flow which handles large files better.
        """
        from google.genai import types
        import os

        if self.auth_method == "service_account":
            # Vertex AI: inline bytes — no Files API available
            audio_part = types.Part.from_bytes(data=audio_bytes, mime_type=mime_type)
        else:
            # Developer API: upload via Files API + poll until ACTIVE
            suffix = ".mp3"
            if "wav" in mime_type:
                suffix = ".wav"
            elif "ogg" in mime_type:
                suffix = ".ogg"
            elif "mp4" in mime_type or "m4a" in mime_type:
                suffix = ".m4a"
            elif "webm" in mime_type:
                suffix = ".webm"

            tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
            try:
                tmp.write(audio_bytes)
                tmp.close()

                uploaded_file = self.client.files.upload(file=tmp.name)

                poll_start = time.monotonic()
                while uploaded_file.state and uploaded_file.state.name != "ACTIVE":
                    if time.monotonic() - poll_start > 30:
                        raise TimeoutError(
                            f"File upload timed out after 30s (state={uploaded_file.state.name})"
                        )
                    time.sleep(1)
                    uploaded_file = self.client.files.get(name=uploaded_file.name)

                audio_part = types.Part.from_uri(
                    file_uri=uploaded_file.uri,
                    mime_type=uploaded_file.mime_type or mime_type,
                )
            finally:
                os.unlink(tmp.name)

        contents = [audio_part, prompt]

        config_dict = {"temperature": self.temperature}
        tc = self._build_thinking_config(thinking)
        if tc is not None:
            config_dict["thinking_config"] = tc
        if json_schema:
            config_dict["response_mime_type"] = "application/json"
            config_dict["response_json_schema"] = json_schema

        config = types.GenerateContentConfig(**config_dict)

        response = self.client.models.generate_content(
            model=self.model_name, contents=contents, config=config,
        )
        tokens_in, tokens_out = self._extract_tokens(response)
        return response.text, tokens_in, tokens_out

    async def generate(self, prompt, system_prompt=None, response_format=None, **kwargs):
        thinking = kwargs.get("thinking", "low")
        timeout = self._get_timeout()
        try:
            text, self._last_tokens_in, self._last_tokens_out = await asyncio.wait_for(
                self._with_retry(self._sync_generate, prompt, system_prompt, thinking),
                timeout=timeout,
            )
            return text
        except asyncio.TimeoutError:
            raise LLMTimeoutError(f"LLM generate call timed out after {timeout}s")

    async def generate_json(self, prompt, system_prompt=None, json_schema=None, **kwargs):
        thinking = kwargs.get("thinking", "low")
        timeout = self._get_timeout(has_schema=bool(json_schema))
        try:
            data, self._last_tokens_in, self._last_tokens_out = await asyncio.wait_for(
                self._with_retry(self._sync_generate_json, prompt, system_prompt, json_schema, thinking),
                timeout=timeout,
            )
            return data
        except asyncio.TimeoutError:
            raise LLMTimeoutError(f"LLM generate_json call timed out after {timeout}s")

    async def generate_with_audio(self, prompt, audio_bytes, mime_type="audio/mpeg", json_schema=None, **kwargs):
        thinking = kwargs.get("thinking", "low")
        timeout = self._get_timeout(has_audio=True, has_schema=bool(json_schema))
        try:
            text, self._last_tokens_in, self._last_tokens_out = await asyncio.wait_for(
                self._with_retry(self._sync_generate_with_audio, prompt, audio_bytes, mime_type, json_schema, thinking),
                timeout=timeout,
            )
            return text
        except asyncio.TimeoutError:
            raise LLMTimeoutError(f"LLM generate_with_audio call timed out after {timeout}s")


class OpenAIProvider(BaseLLMProvider):
    """Async OpenAI provider."""

    def __init__(self, api_key: str, model_name: str = "", temperature: float = 1.0):
        super().__init__(api_key, model_name, temperature)
        from openai import OpenAI
        self.client = OpenAI(api_key=api_key)
        try:
            from openai import RateLimitError, APIConnectionError
            self.RETRYABLE_EXCEPTIONS = (
                RateLimitError, APIConnectionError, ConnectionError, TimeoutError,
            )
        except ImportError:
            pass  # Fall back to base class defaults

    @staticmethod
    def _extract_tokens(response):
        """Extract token counts from OpenAI response. Returns (in, out) tuple."""
        tokens_in = tokens_out = None
        if response.usage:
            tokens_in = response.usage.prompt_tokens
            tokens_out = response.usage.completion_tokens
        return tokens_in, tokens_out

    def _sync_generate(self, prompt, system_prompt, response_format):
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        params = {"model": self.model_name, "messages": messages, "temperature": self.temperature}
        if response_format:
            params["response_format"] = response_format

        response = self.client.chat.completions.create(**params)
        tokens_in, tokens_out = self._extract_tokens(response)
        return response.choices[0].message.content, tokens_in, tokens_out

    def _sync_generate_json(self, prompt, system_prompt, json_schema):
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        params = {"model": self.model_name, "messages": messages, "temperature": self.temperature}
        if json_schema:
            params["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "response", "schema": json_schema},
            }
        else:
            params["response_format"] = {"type": "json_object"}

        response = self.client.chat.completions.create(**params)
        tokens_in, tokens_out = self._extract_tokens(response)
        content = response.choices[0].message.content
        try:
            return json.loads(content), tokens_in, tokens_out
        except json.JSONDecodeError:
            text = content.strip()
            if text.startswith("```json"):
                text = text[7:]
            if text.endswith("```"):
                text = text[:-3]
            return json.loads(text.strip()), tokens_in, tokens_out

    def _sync_generate_with_audio(self, prompt, audio_bytes, mime_type, json_schema):
        """Sync helper: send audio as base64 inline data to OpenAI."""
        import base64

        b64_data = base64.b64encode(audio_bytes).decode("utf-8")

        # Determine audio format from mime_type
        fmt = "mp3"
        if "wav" in mime_type:
            fmt = "wav"
        elif "mp4" in mime_type or "m4a" in mime_type:
            fmt = "mp4"
        elif "webm" in mime_type:
            fmt = "webm"
        elif "ogg" in mime_type:
            fmt = "ogg"

        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {"data": b64_data, "format": fmt},
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ]

        params = {
            "model": self.model_name,
            "messages": messages,
            "temperature": self.temperature,
        }
        if json_schema:
            params["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "response", "schema": json_schema},
            }

        response = self.client.chat.completions.create(**params)
        tokens_in, tokens_out = self._extract_tokens(response)
        return response.choices[0].message.content, tokens_in, tokens_out

    async def generate(self, prompt, system_prompt=None, response_format=None, **kwargs):
        timeout = self._get_timeout()
        try:
            text, self._last_tokens_in, self._last_tokens_out = await asyncio.wait_for(
                self._with_retry(self._sync_generate, prompt, system_prompt, response_format),
                timeout=timeout,
            )
            return text
        except asyncio.TimeoutError:
            raise LLMTimeoutError(f"LLM generate call timed out after {timeout}s")

    async def generate_json(self, prompt, system_prompt=None, json_schema=None, **kwargs):
        timeout = self._get_timeout(has_schema=bool(json_schema))
        try:
            data, self._last_tokens_in, self._last_tokens_out = await asyncio.wait_for(
                self._with_retry(self._sync_generate_json, prompt, system_prompt, json_schema),
                timeout=timeout,
            )
            return data
        except asyncio.TimeoutError:
            raise LLMTimeoutError(f"LLM generate_json call timed out after {timeout}s")

    async def generate_with_audio(self, prompt, audio_bytes, mime_type="audio/mpeg", json_schema=None, **kwargs):
        timeout = self._get_timeout(has_audio=True, has_schema=bool(json_schema))
        try:
            text, self._last_tokens_in, self._last_tokens_out = await asyncio.wait_for(
                self._with_retry(self._sync_generate_with_audio, prompt, audio_bytes, mime_type, json_schema),
                timeout=timeout,
            )
            return text
        except asyncio.TimeoutError:
            raise LLMTimeoutError(f"LLM generate_with_audio call timed out after {timeout}s")


class LoggingLLMWrapper(BaseLLMProvider):
    """Wraps any async LLM provider to log API calls to the database."""

    def __init__(self, inner: BaseLLMProvider, log_callback=None):
        self._inner = inner
        self._log_callback = log_callback  # async callable(log_entry: dict)
        self._run_id: Optional[str] = None
        self._thread_id: Optional[str] = None
        self._test_case_label: Optional[str] = None
        self._timeouts: dict = dict(DEFAULT_TIMEOUTS)

    def set_timeouts(self, timeouts: dict):
        """Delegate to inner provider."""
        self._inner.set_timeouts(timeouts)

    @property
    def api_key(self):
        return self._inner.api_key

    @property
    def model_name(self):
        return self._inner.model_name

    @property
    def temperature(self):
        return self._inner.temperature

    def set_context(self, run_id: str, thread_id: Optional[str] = None):
        self._run_id = run_id
        self._thread_id = thread_id

    def set_thread_id(self, thread_id: Optional[str]):
        self._thread_id = thread_id

    def set_test_case_label(self, label: Optional[str]):
        self._test_case_label = label

    def clone_for_thread(self, thread_id: str) -> "LoggingLLMWrapper":
        """Lightweight clone sharing inner provider, with independent thread_id.

        Used by parallel workers that need isolated thread_id for correct
        API log attribution. Sharing the inner provider is safe — asyncio.to_thread
        creates per-call closures.
        """
        clone = LoggingLLMWrapper(self._inner, log_callback=self._log_callback)
        clone._run_id = self._run_id
        clone._thread_id = thread_id
        clone._test_case_label = self._test_case_label
        clone._timeouts = self._timeouts
        return clone

    async def generate(self, prompt, system_prompt=None, response_format=None, **kwargs):
        start = time.monotonic()
        error_text = None
        response_text = None
        try:
            response_text = await self._inner.generate(
                prompt=prompt, system_prompt=system_prompt,
                response_format=response_format, **kwargs,
            )
            return response_text
        except Exception as e:
            error_text = str(e)
            raise
        finally:
            duration_ms = (time.monotonic() - start) * 1000
            await self._save_log("generate", prompt, system_prompt, response_text, error_text, duration_ms)

    async def generate_json(self, prompt, system_prompt=None, json_schema=None, **kwargs):
        start = time.monotonic()
        error_text = None
        response_data = None
        try:
            response_data = await self._inner.generate_json(
                prompt=prompt, system_prompt=system_prompt,
                json_schema=json_schema, **kwargs,
            )
            return response_data
        except Exception as e:
            error_text = str(e)
            raise
        finally:
            duration_ms = (time.monotonic() - start) * 1000
            response_str = None
            if response_data is not None:
                try:
                    response_str = json.dumps(response_data, ensure_ascii=False)
                except (TypeError, ValueError):
                    response_str = str(response_data)
            await self._save_log("generate_json", prompt, system_prompt, response_str, error_text, duration_ms)

    async def generate_with_audio(self, prompt, audio_bytes, mime_type="audio/mpeg", json_schema=None, **kwargs):
        start = time.monotonic()
        error_text = None
        response_text = None
        try:
            response_text = await self._inner.generate_with_audio(
                prompt=prompt, audio_bytes=audio_bytes,
                mime_type=mime_type, json_schema=json_schema, **kwargs,
            )
            return response_text
        except Exception as e:
            error_text = str(e)
            raise
        finally:
            duration_ms = (time.monotonic() - start) * 1000
            # Log with truncated prompt (audio bytes not included)
            await self._save_log(
                "generate_with_audio",
                prompt[:50000],
                None,
                (response_text[:50000] if response_text else None),
                error_text,
                duration_ms,
            )

    async def _save_log(self, method, prompt, system_prompt, response, error, duration_ms):
        if not self._log_callback or not self._run_id:
            return
        try:
            tokens_in = getattr(self._inner, "_last_tokens_in", None)
            tokens_out = getattr(self._inner, "_last_tokens_out", None)
            await self._log_callback({
                "run_id": self._run_id,
                "thread_id": self._thread_id,
                "test_case_label": self._test_case_label,
                "provider": type(self._inner).__name__,
                "model": self._inner.model_name,
                "method": method,
                "prompt": prompt[:50000],
                "system_prompt": (system_prompt[:20000] if system_prompt else None),
                "response": (response[:50000] if response else None),
                "error": error,
                "duration_ms": round(duration_ms, 2),
                "tokens_in": tokens_in,
                "tokens_out": tokens_out,
            })
        except Exception as e:
            logger.warning(f"Failed to save API log: {e}")


def create_llm_provider(
    provider: str, api_key: str = "", model_name: str = "",
    temperature: float = 0.1, service_account_path: str = "",
) -> BaseLLMProvider:
    """Factory — dumb constructor, no auth policy. Use settings_helper for credential resolution."""
    if not model_name:
        raise ValueError("No model selected. Go to Settings and select a model.")
    if provider == "gemini":
        kwargs = {"model_name": model_name, "temperature": temperature}
        if api_key:
            kwargs["api_key"] = api_key
        elif service_account_path:
            kwargs["service_account_path"] = service_account_path
        return GeminiProvider(**kwargs)
    elif provider == "openai":
        return OpenAIProvider(
            api_key=api_key, model_name=model_name, temperature=temperature,
        )
    else:
        raise ValueError(f"Unknown LLM provider: {provider}")
