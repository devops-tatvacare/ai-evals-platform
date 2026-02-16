"""Async LLM provider interface and implementations.

Ported from kaira-evals/src/llm/ — converted to async using asyncio.to_thread
to wrap the sync SDK calls (both google-genai and openai SDKs are sync).
"""
import asyncio
import json
import logging
import time
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


class BaseLLMProvider(ABC):
    """Abstract base class for async LLM providers."""

    def __init__(self, api_key: str, model_name: str, temperature: float = 1.0):
        self.api_key = api_key
        self.model_name = model_name
        self.temperature = temperature

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


class GeminiProvider(BaseLLMProvider):
    """Async Gemini provider using google-genai SDK."""

    def __init__(
        self, api_key: Optional[str] = None,
        service_account_path: Optional[str] = None,
        model_name: str = "gemini-3-flash-preview",
        temperature: float = 1.0,
    ):
        super().__init__(api_key or "", model_name, temperature)

        from google import genai

        if service_account_path:
            from pathlib import Path
            sa_path = Path(service_account_path)
            if sa_path.exists():
                import json as _json
                from google.oauth2 import service_account
                with open(sa_path) as f:
                    sa_info = _json.load(f)
                credentials = service_account.Credentials.from_service_account_info(
                    sa_info, scopes=["https://www.googleapis.com/auth/generative-language"],
                )
                self.client = genai.Client(credentials=credentials)
                self.auth_method = "service_account"
            else:
                raise FileNotFoundError(f"Service account file not found: {sa_path}")
        elif api_key:
            self.client = genai.Client(api_key=api_key)
            self.auth_method = "api_key"
        else:
            raise ValueError("Either api_key or service_account_path must be provided")

    def _sync_generate(self, prompt, system_prompt, thinking_level="minimal"):
        from google.genai import types

        config_dict = {
            "temperature": self.temperature,
            "thinking_config": types.ThinkingConfig(thinking_level=thinking_level),
        }
        if system_prompt:
            config_dict["system_instruction"] = system_prompt
        config = types.GenerateContentConfig(**config_dict)

        response = self.client.models.generate_content(
            model=self.model_name, contents=prompt, config=config,
        )
        return response.text

    def _sync_generate_json(self, prompt, system_prompt, json_schema, thinking_level="minimal"):
        from google.genai import types

        config_dict = {
            "temperature": self.temperature,
            "thinking_config": types.ThinkingConfig(thinking_level=thinking_level),
            "response_mime_type": "application/json",
        }
        if system_prompt:
            config_dict["system_instruction"] = system_prompt
        if json_schema:
            config_dict["response_json_schema"] = json_schema
        config = types.GenerateContentConfig(**config_dict)

        response = self.client.models.generate_content(
            model=self.model_name, contents=prompt, config=config,
        )
        try:
            return json.loads(response.text)
        except json.JSONDecodeError:
            text = response.text.strip()
            if text.startswith("```json"):
                text = text[7:]
            if text.endswith("```"):
                text = text[:-3]
            return json.loads(text.strip())

    async def generate(self, prompt, system_prompt=None, response_format=None, **kwargs):
        thinking_level = kwargs.get("thinking_level", "minimal")
        return await asyncio.to_thread(
            self._sync_generate, prompt, system_prompt, thinking_level,
        )

    async def generate_json(self, prompt, system_prompt=None, json_schema=None, **kwargs):
        thinking_level = kwargs.get("thinking_level", "minimal")
        return await asyncio.to_thread(
            self._sync_generate_json, prompt, system_prompt, json_schema, thinking_level,
        )


class OpenAIProvider(BaseLLMProvider):
    """Async OpenAI provider."""

    def __init__(self, api_key: str, model_name: str = "gpt-4o", temperature: float = 1.0):
        super().__init__(api_key, model_name, temperature)
        from openai import OpenAI
        self.client = OpenAI(api_key=api_key)

    def _sync_generate(self, prompt, system_prompt, response_format):
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        params = {"model": self.model_name, "messages": messages, "temperature": self.temperature}
        if response_format:
            params["response_format"] = response_format

        response = self.client.chat.completions.create(**params)
        return response.choices[0].message.content

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
        content = response.choices[0].message.content
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            text = content.strip()
            if text.startswith("```json"):
                text = text[7:]
            if text.endswith("```"):
                text = text[:-3]
            return json.loads(text.strip())

    async def generate(self, prompt, system_prompt=None, response_format=None, **kwargs):
        return await asyncio.to_thread(self._sync_generate, prompt, system_prompt, response_format)

    async def generate_json(self, prompt, system_prompt=None, json_schema=None, **kwargs):
        return await asyncio.to_thread(self._sync_generate_json, prompt, system_prompt, json_schema)


class LoggingLLMWrapper(BaseLLMProvider):
    """Wraps any async LLM provider to log API calls to the database."""

    def __init__(self, inner: BaseLLMProvider, log_callback=None):
        self._inner = inner
        self._log_callback = log_callback  # async callable(log_entry: dict)
        self._run_id: Optional[str] = None
        self._thread_id: Optional[str] = None

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

    async def _save_log(self, method, prompt, system_prompt, response, error, duration_ms):
        if not self._log_callback or not self._run_id:
            return
        try:
            await self._log_callback({
                "run_id": self._run_id,
                "thread_id": self._thread_id,
                "provider": type(self._inner).__name__,
                "model": self._inner.model_name,
                "method": method,
                "prompt": prompt[:50000],
                "system_prompt": (system_prompt[:20000] if system_prompt else None),
                "response": (response[:50000] if response else None),
                "error": error,
                "duration_ms": round(duration_ms, 2),
                "tokens_in": None,
                "tokens_out": None,
            })
        except Exception as e:
            logger.warning(f"Failed to save API log: {e}")


def create_llm_provider(
    provider: str, api_key: str = "", model_name: str = "",
    temperature: float = 0.1, service_account_path: str = "",
) -> BaseLLMProvider:
    """Factory function to create an LLM provider."""
    if provider == "gemini":
        kwargs = {"model_name": model_name or "gemini-3-flash-preview", "temperature": temperature}
        if service_account_path:
            kwargs["service_account_path"] = service_account_path
        else:
            kwargs["api_key"] = api_key
        return GeminiProvider(**kwargs)
    elif provider == "openai":
        return OpenAIProvider(
            api_key=api_key, model_name=model_name or "gpt-4o", temperature=temperature,
        )
    else:
        raise ValueError(f"Unknown LLM provider: {provider}")
