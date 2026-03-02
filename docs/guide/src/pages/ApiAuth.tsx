import type { ReactNode } from "react";
import { Card, MermaidDiagram, InfoBox, PageHeader } from "@/components";
import { usePageExport } from "@/hooks/usePageExport";

const credentialFlowDiagram = `flowchart TD
    UI["Settings UI LLMConfigSection"] -->|Save| DB["Settings Table JSONB"]
    Job["Job Handler"] -->|get_llm_settings_from_db| SH["settings_helper.py"]
    SH -->|SELECT| DB
    SH -->|detect_service_account_path| ENV["Env GEMINI_SERVICE_ACCOUNT_PATH"]
    SH -->|Returns| Config["api_key + provider + model + auth_method + provider_override"]
    Config -->|create_llm_provider| Factory["LLM Factory"]
    Factory -->|service_account_path exists| Vertex["GeminiProvider Vertex AI"]
    Factory -->|api_key only| APIKey["GeminiProvider API Key"]
    Factory -->|provider is openai| OpenAI["OpenAIProvider"]
    Factory -->|provider is anthropic| Anthropic["AnthropicProvider"]
    Factory -->|provider is azure-openai| Azure["AzureOpenAIProvider"]`;

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr style={{ borderBottom: "1px solid var(--border)" }}>
      <td
        className="px-4 py-2.5 font-semibold text-sm whitespace-nowrap"
        style={{ color: "var(--text)", width: "160px" }}
      >
        {label}
      </td>
      <td
        className="px-4 py-2.5 text-sm"
        style={{ color: "var(--text-secondary)" }}
      >
        {children}
      </td>
    </tr>
  );
}

export default function ApiAuth() {
  const { contentRef } = usePageExport();

  return (
    <div
      ref={contentRef}
      className="page-content animate-fade-in-up"
      data-title="API & Auth"
    >
      <PageHeader
        title="LLM Provider Architecture"
        subtitle="How API keys, service accounts, and model resolution work across frontend and backend evaluators."
        pageTitle="API & Auth"
        contentRef={contentRef}
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 mb-8">
        <Card>
          <h3
            className="text-[1.0625rem] font-bold tracking-tight mb-3"
            style={{ color: "var(--text)" }}
          >
            Frontend Providers
          </h3>
          <table
            className="w-full text-sm"
            style={{ borderCollapse: "collapse" }}
          >
            <tbody>
              <InfoRow label="Interface">
                <code>ILLMProvider</code> (<code>src/services/llm/</code>)
              </InfoRow>
              <InfoRow label="Implementations">
                <code>GeminiProvider</code>
              </InfoRow>
              <InfoRow label="Used for">
                Real-time AI-assist features in browser (API key mode)
              </InfoRow>
              <InfoRow label="Pipeline">
                <code>LLMInvocationPipeline</code> (Validate &rarr; Prepare
                &rarr; Execute &rarr; Post-process)
              </InfoRow>
            </tbody>
          </table>
        </Card>

        <Card>
          <h3
            className="text-[1.0625rem] font-bold tracking-tight mb-3"
            style={{ color: "var(--text)" }}
          >
            Backend Providers
          </h3>
          <table
            className="w-full text-sm"
            style={{ borderCollapse: "collapse" }}
          >
            <tbody>
              <InfoRow label="Base class">
                <code>BaseLLMProvider</code> (
                <code>app/services/evaluators/llm_base.py</code>)
              </InfoRow>
              <InfoRow label="Implementations">
                <code>GeminiProvider</code> (google-genai SDK),{" "}
                <code>OpenAIProvider</code> (openai SDK),{" "}
                <code>AnthropicProvider</code> (anthropic SDK),{" "}
                <code>AzureOpenAIProvider</code> (openai SDK with Azure endpoint)
              </InfoRow>
              <InfoRow label="Used for">
                Background job evaluation pipelines
              </InfoRow>
              <InfoRow label="Wrapper">
                <code>LoggingLLMWrapper</code> (logs all API calls to{" "}
                <code>api_logs</code> table)
              </InfoRow>
              <InfoRow label="Methods">
                <code>generate()</code>, <code>generate_json()</code>,{" "}
                <code>generate_with_audio()</code>
              </InfoRow>
            </tbody>
          </table>
        </Card>
      </div>

      <h2
        className="text-2xl font-bold mt-12 mb-4"
        style={{ color: "var(--text)" }}
      >
        API Key Setup
      </h2>
      <Card className="mb-8">
        <p className="text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
          <code>LLMConfigSection</code> provides per-provider API key
          inputs and model selection. Keys are stored in the{" "}
          <strong>Settings</strong> table (key=
          <code>&apos;llm-settings&apos;</code>) as JSONB with fields:{" "}
          <code>provider</code>, <code>geminiApiKey</code>,{" "}
          <code>openaiApiKey</code>, <code>anthropicApiKey</code>,{" "}
          <code>azureOpenaiApiKey</code>.
        </p>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          On the frontend, <code>useLLMSettingsStore</code> (Zustand) manages
          the active configuration. On the backend,{" "}
          <code>settings_helper.get_llm_settings_from_db()</code> reads the same
          settings row to configure LLM providers for background jobs.
        </p>
      </Card>

      <h2
        className="text-2xl font-bold mt-12 mb-4"
        style={{ color: "var(--text)" }}
      >
        Provider Override
      </h2>
      <Card className="mb-8">
        <p className="text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
          Certain features (reports, evaluations) accept a{" "}
          <code>provider_override</code> parameter. This lets the caller
          temporarily switch to a different provider and API key for that
          specific job, without changing the global LLM settings.
        </p>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          The backend resolves the correct API key from the settings table based
          on the override provider, then creates the matching LLM provider
          instance.
        </p>
      </Card>

      <h2
        className="text-2xl font-bold mt-12 mb-4"
        style={{ color: "var(--text)" }}
      >
        Service Account Authentication
      </h2>
      <Card className="mb-8">
        <p className="text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
          For server-side Gemini calls, set the{" "}
          <code>GEMINI_SERVICE_ACCOUNT_PATH</code> env var pointing to a Google
          Cloud service account JSON file. The{" "}
          <code>settings_helper._detect_service_account_path()</code> function
          auto-detects it.
        </p>
        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          When present, <code>GeminiProvider</code> creates a Vertex AI client
          with <strong>oauth2 credentials</strong> instead of API key auth.
        </p>
        <InfoBox>
          Both API key and service account can coexist &mdash;{" "}
          <strong>service account</strong> for background jobs,{" "}
          <strong>API key</strong> for frontend-triggered features.
        </InfoBox>
      </Card>

      <h2
        className="text-2xl font-bold mt-12 mb-4"
        style={{ color: "var(--text)" }}
      >
        Credential Resolution Flow
      </h2>
      <MermaidDiagram chart={credentialFlowDiagram} />

      <h2
        className="text-2xl font-bold mt-12 mb-4"
        style={{ color: "var(--text)" }}
      >
        Model Discovery
      </h2>
      <Card>
        <p className="text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
          Frontend <code>modelDiscovery.ts</code> calls the{" "}
          <code>/api/llm/discover-models</code> endpoint which lists available
          models from the configured provider. Supports API key override in the
          request body for runtime provider switching.
        </p>
        <InfoBox className="mb-3">
          Models are cached in <code>useLLMSettingsStore</code> to avoid
          repeated API calls. The cache refreshes when the provider or API key
          changes.
        </InfoBox>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          The <code>ModelSelector</code> component provides a searchable
          dropdown. The backend exposes both <code>/api/llm/models</code> (model
          listing) and <code>/api/llm/auth-status</code> (service account
          status) in <code>app/routes/llm.py</code>.
        </p>
      </Card>
    </div>
  );
}
