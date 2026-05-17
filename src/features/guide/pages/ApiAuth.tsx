import type { ReactNode } from "react";
import { Card, MermaidDiagram, InfoBox, PageHeader } from "@/features/guide/components";
import { usePageExport } from "@/features/guide/hooks/usePageExport";

const credentialFlowDiagram = `flowchart TD
    Admin["Admin AI Settings UI"] -->|PUT api admin ai-settings| TenantTable["tenant_llm_providers (Fernet-encrypted)"]
    AnyCaller["Any backend caller"] -->|resolve_llm_credentials| Resolver["llm_credentials.resolver"]
    Resolver -->|SELECT| TenantTable
    Resolver -->|decrypt + ResolvedCredentials| Result["api_key + provider + base_url + extra_config"]
    Result -->|create_llm_provider| Factory["LLM Factory"]
    Factory -->|provider is gemini| Vertex["GeminiProvider"]
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
        title="LLM Provider Architecture (BYOK)"
        subtitle="Tenant-owned LLM credentials, admin-managed in AI Settings, resolved server-side for every call."
        pageTitle="API & Auth"
        contentRef={contentRef}
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 mb-8">
        <Card>
          <h3
            className="text-[1.0625rem] font-bold tracking-tight mb-3"
            style={{ color: "var(--text)" }}
          >
            Frontend
          </h3>
          <table
            className="w-full text-sm"
            style={{ borderCollapse: "collapse" }}
          >
            <tbody>
              <InfoRow label="Picker">
                <code>LLMConfigSection</code> (<code>src/components/ui</code>) &mdash;
                two-row provider + model dropdown fed by the admin catalogue.
              </InfoRow>
              <InfoRow label="Query">
                <code>useProviderConfigs()</code> (
                <code>src/services/api/aiSettingsQueries.ts</code>) reads
                <code> GET /api/admin/ai-settings/providers</code>.
              </InfoRow>
              <InfoRow label="Assist">
                <code>llmAssistApi</code> (
                <code>src/services/api/llmAssistApi.ts</code>) calls the 3
                server-side assist endpoints. No API key ever crosses the wire.
              </InfoRow>
              <InfoRow label="No client SDKs">
                Direct provider SDK calls (Google, OpenAI, Anthropic) live only
                on the backend.
              </InfoRow>
            </tbody>
          </table>
        </Card>

        <Card>
          <h3
            className="text-[1.0625rem] font-bold tracking-tight mb-3"
            style={{ color: "var(--text)" }}
          >
            Backend
          </h3>
          <table
            className="w-full text-sm"
            style={{ borderCollapse: "collapse" }}
          >
            <tbody>
              <InfoRow label="Resolver">
                <code>resolve_llm_credentials(db, tenant_id, provider)</code> in
                <code> app/services/llm_credentials/resolver.py</code>.
              </InfoRow>
              <InfoRow label="Storage">
                <code>platform.tenant_llm_providers</code> — one row per
                tenant + provider, Fernet-encrypted via{" "}
                <code>LLM_CREDENTIAL_KEY</code>.
              </InfoRow>
              <InfoRow label="Base class">
                <code>BaseLLMProvider</code> (
                <code>app/services/evaluators/llm_base.py</code>).
              </InfoRow>
              <InfoRow label="Wrapper">
                <code>LoggingLLMWrapper</code> &mdash; every call writes one
                <code> analytics.fact_llm_generation</code> row.
              </InfoRow>
              <InfoRow label="Admin routes">
                <code>/api/admin/llm/providers/*</code> (list / upsert /
                discover-models / validate) gated by{" "}
                <code>configuration:edit</code>.
              </InfoRow>
            </tbody>
          </table>
        </Card>
      </div>

      <h2
        className="text-2xl font-bold mt-12 mb-4"
        style={{ color: "var(--text)" }}
      >
        Setting Up Provider Credentials
      </h2>
      <Card className="mb-8">
        <p className="text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
          Admins manage credentials at <code>/admin/llm/providers</code>: enable
          a provider, paste the API key (the input is the only place a
          plaintext key ever appears in the UI), curate the models users see,
          and run <strong>Test connection</strong> to validate.
        </p>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          GET responses never carry the key &mdash; the row exposes
          <code> hasApiKey</code> and a partial-reveal <code>apiKeyPreview</code>
          {' '}(<code>XYZA••••WXYZ</code>) only. A blank <code>apiKey</code> on
          PUT preserves the stored secret.
        </p>
      </Card>

      <h2
        className="text-2xl font-bold mt-12 mb-4"
        style={{ color: "var(--text)" }}
      >
        Why no provider override?
      </h2>
      <Card className="mb-8">
        <p className="text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
          The pre-Phase-1 <code>provider_override</code> parameter is gone.
          Every backend caller now passes <code>provider</code> + <code>model</code>{' '}
          explicitly (jobs carry them in params, request handlers carry them in
          the request body) and <code>resolve_llm_credentials</code> resolves
          the matching row.
        </p>
      </Card>

      <h2
        className="text-2xl font-bold mt-12 mb-4"
        style={{ color: "var(--text)" }}
      >
        Service Account Authentication (system tenant only)
      </h2>
      <Card className="mb-8">
        <p className="text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
          The <code>GEMINI_SERVICE_ACCOUNT_PATH</code> env var still works,
          but only for <code>SYSTEM_TENANT_ID</code>. Real tenants must
          configure Gemini through AI Settings; without a saved row the
          resolver raises <code>ProviderNotConfiguredError</code>.
        </p>
        <InfoBox>
          The SA path is the planned-deprecation fallback for system-owned
          assets; user-facing flows always go through the BYOK resolver.
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
          Admin-only: <code>POST /api/admin/ai-settings/providers/&#123;p&#125;/discover-models</code>{' '}
          lists models live from the configured provider (used inside the AI
          Settings page to populate the curation Combobox).
        </p>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          End-user code reads the curated allow-list from{" "}
          <code>useProviderConfigs()</code> &mdash; it never hits a discovery
          endpoint directly.
        </p>
      </Card>
    </div>
  );
}
