import { useState, useCallback } from "react";
import { Send, Loader2, ChevronRight } from "lucide-react";
import { Badge, FilterPills, CodeBlock, PageHeader } from "@/features/guide/components";
import { usePageExport } from "@/features/guide/hooks/usePageExport";
import { apiEndpoints, routers, type ApiEndpoint } from "@/features/guide/data/apiEndpoints";

const methodColors: Record<string, "green" | "blue" | "amber" | "red"> = {
  GET: "green",
  POST: "blue",
  PUT: "amber",
  DELETE: "red",
};

const methodFilterOptions = [
  { id: "All", label: "All" },
  { id: "GET", label: "GET" },
  { id: "POST", label: "POST" },
  { id: "PUT", label: "PUT" },
  { id: "DELETE", label: "DELETE" },
];

interface ResponseState {
  status: number | null;
  statusText: string;
  body: string;
  error: string;
}

export default function ApiExplorer() {
  const { contentRef } = usePageExport();
  const [methodFilter, setMethodFilter] = useState("All");
  const [selected, setSelected] = useState<ApiEndpoint | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [queryValues, setQueryValues] = useState<Record<string, string>>({});
  const [pathValues, setPathValues] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ResponseState | null>(null);
  const [expandedRouters, setExpandedRouters] = useState<Set<string>>(
    new Set(),
  );

  const filteredEndpoints =
    methodFilter === "All"
      ? apiEndpoints
      : apiEndpoints.filter((e) => e.method === methodFilter);

  const groupedByRouter = routers
    .map((r) => ({
      router: r,
      endpoints: filteredEndpoints.filter((e) => e.router === r),
    }))
    .filter((g) => g.endpoints.length > 0);

  const toggleRouter = useCallback((router: string) => {
    setExpandedRouters((prev) => {
      const next = new Set(prev);
      if (next.has(router)) next.delete(router);
      else next.add(router);
      return next;
    });
  }, []);

  const selectEndpoint = useCallback((ep: ApiEndpoint) => {
    setSelected(ep);
    setQueryValues({});
    setPathValues({});
    setBody(ep.bodyExample);
    setResponse(null);
    setExpandedRouters((prev) => new Set(prev).add(ep.router));
  }, []);

  // Extract path params like {run_id}
  const pathParams = selected
    ? [...selected.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    : [];

  const buildUrl = useCallback(() => {
    if (!selected) return "";
    let path = selected.path;
    for (const param of pathParams) {
      path = path.replace(`{${param}}`, pathValues[param] || `{${param}}`);
    }
    const qs = selected.queryParams
      .filter((p) => queryValues[p])
      .map((p) => `${p}=${encodeURIComponent(queryValues[p])}`)
      .join("&");
    return `${baseUrl}${path}${qs ? `?${qs}` : ""}`;
  }, [selected, baseUrl, queryValues, pathValues, pathParams]);

  const sendRequest = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    setResponse(null);

    const url = buildUrl();
    try {
      const init: RequestInit = {
        method: selected.method,
        headers: { "Content-Type": "application/json" },
      };
      if (
        (selected.method === "POST" || selected.method === "PUT") &&
        body.trim()
      ) {
        init.body = body;
      }
      const res = await fetch(url, init);
      let text: string;
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("json")) {
        const json = await res.json();
        text = JSON.stringify(json, null, 2);
      } else {
        text = await res.text();
      }
      setResponse({
        status: res.status,
        statusText: res.statusText,
        body: text,
        error: "",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Request failed";
      setResponse({
        status: null,
        statusText: "",
        body: "",
        error: `${msg}\n\nMake sure the backend is running (docker compose up or uvicorn).`,
      });
    } finally {
      setLoading(false);
    }
  }, [selected, body, buildUrl]);

  const statusColor = response?.status
    ? response.status < 300
      ? "green"
      : response.status < 500
        ? "amber"
        : "red"
    : "red";

  return (
    <div
      ref={contentRef}
      className="page-content animate-fade-in-up"
      data-title="API Explorer"
    >
      <PageHeader
        title="API Explorer"
        subtitle={`Browse ${apiEndpoints.length} endpoints across ${routers.length} routers, then run live requests against your dev API.`}
        pageTitle="API Explorer"
        contentRef={contentRef}
      />

      <FilterPills
        options={methodFilterOptions}
        active={methodFilter}
        onChange={setMethodFilter}
        className="mb-3"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 mt-3">
        {/* Left sidebar — flat endpoint list */}
        <div
          className="overflow-y-auto"
          style={{ maxHeight: "calc(100vh - 220px)" }}
        >
          {groupedByRouter.map((group) => {
            const isExpanded = expandedRouters.has(group.router);
            return (
              <div
                key={group.router}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <button
                  onClick={() => toggleRouter(group.router)}
                  className="w-full flex items-center gap-2 px-3 py-3 text-left cursor-pointer transition-colors"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--text)",
                  }}
                >
                  <ChevronRight
                    size={14}
                    className="shrink-0 transition-transform duration-200"
                    style={{
                      transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                      color: "var(--accent-text)",
                    }}
                  />
                  <span className="text-sm font-semibold">{group.router}</span>
                  <span
                    className="text-xs ml-auto"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {group.endpoints.length}
                  </span>
                </button>
                {isExpanded && (
                  <div className="flex flex-col gap-0.5 pb-2 px-1">
                    {group.endpoints.map((ep, i) => {
                      const isSelected =
                        selected?.path === ep.path &&
                        selected?.method === ep.method;
                      return (
                        <button
                          key={`${ep.method}-${ep.path}-${i}`}
                          onClick={() => selectEndpoint(ep)}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-left cursor-pointer transition-colors w-full"
                          style={{
                            background: isSelected
                              ? "var(--accent-surface)"
                              : "transparent",
                            border: "none",
                            color: "var(--text)",
                          }}
                        >
                          <Badge color={methodColors[ep.method]}>
                            {ep.method}
                          </Badge>
                          <code
                            className="text-xs truncate"
                            style={{
                              fontFamily: "var(--font-mono)",
                              color: "var(--text-secondary)",
                            }}
                          >
                            {ep.path.replace(ep.prefix, "") || "/"}
                          </code>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right panel — request builder (no card wrappers) */}
        <div className="min-w-0">
          {!selected ? (
            <div
              className="text-center py-16"
              style={{ color: "var(--text-muted)" }}
            >
              <p className="text-sm">
                Select an endpoint from the sidebar to get started.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {/* Endpoint header */}
              <div className="flex items-center gap-3">
                <Badge color={methodColors[selected.method]}>
                  {selected.method}
                </Badge>
                <code
                  className="text-sm font-semibold"
                  style={{
                    color: "var(--text)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {selected.path}
                </code>
              </div>

              {/* Base URL */}
              <div>
                <label
                  className="block text-xs font-semibold mb-1"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Base URL{" "}
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                    (leave empty for Vite proxy)
                  </span>
                </label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://localhost:8721"
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontFamily: "var(--font-mono)",
                  }}
                />
              </div>

              {/* Path params */}
              {pathParams.length > 0 && (
                <div>
                  <label
                    className="block text-xs font-semibold mb-2"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    Path Parameters
                  </label>
                  <div className="flex flex-col gap-2">
                    {pathParams.map((param) => (
                      <div key={param} className="flex items-center gap-2">
                        <code
                          className="text-xs px-2 py-1 rounded shrink-0"
                          style={{
                            background: "var(--bg-secondary)",
                            color: "var(--accent-text)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {`{${param}}`}
                        </code>
                        <input
                          type="text"
                          placeholder={param}
                          value={pathValues[param] || ""}
                          onChange={(e) =>
                            setPathValues((prev) => ({
                              ...prev,
                              [param]: e.target.value,
                            }))
                          }
                          className="flex-1 px-3 py-1.5 rounded-lg text-sm"
                          style={{
                            background: "var(--bg-secondary)",
                            border: "1px solid var(--border)",
                            color: "var(--text)",
                            fontFamily: "var(--font-mono)",
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Query params */}
              {selected.queryParams.length > 0 && (
                <div>
                  <label
                    className="block text-xs font-semibold mb-2"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    Query Parameters
                  </label>
                  <div className="flex flex-col gap-2">
                    {selected.queryParams.map((param) => (
                      <div key={param} className="flex items-center gap-2">
                        <code
                          className="text-xs px-2 py-1 rounded shrink-0"
                          style={{
                            background: "var(--bg-secondary)",
                            color: "var(--accent-text)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {param}
                        </code>
                        <input
                          type="text"
                          placeholder={param}
                          value={queryValues[param] || ""}
                          onChange={(e) =>
                            setQueryValues((prev) => ({
                              ...prev,
                              [param]: e.target.value,
                            }))
                          }
                          className="flex-1 px-3 py-1.5 rounded-lg text-sm"
                          style={{
                            background: "var(--bg-secondary)",
                            border: "1px solid var(--border)",
                            color: "var(--text)",
                            fontFamily: "var(--font-mono)",
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Body */}
              {(selected.method === "POST" || selected.method === "PUT") && (
                <div>
                  <label
                    className="block text-xs font-semibold mb-1"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    Request Body (JSON)
                  </label>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={8}
                    className="w-full px-3 py-2 rounded-lg text-sm resize-y"
                    style={{
                      background: "var(--bg-secondary)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                </div>
              )}

              {/* Computed URL + Send */}
              <div className="flex items-center gap-3">
                <div
                  className="flex-1 px-3 py-2 rounded-lg text-xs break-all"
                  style={{
                    background: "var(--bg-secondary)",
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {buildUrl()}
                </div>
                <button
                  onClick={sendRequest}
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-colors shrink-0"
                  style={{
                    background: "var(--accent)",
                    color: "var(--text-on-color)",
                    border: "none",
                    opacity: loading ? 0.7 : 1,
                  }}
                >
                  {loading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Send size={16} />
                  )}
                  {loading ? "Sending..." : "Send"}
                </button>
              </div>

              {/* Response */}
              {response && (
                <div>
                  <div
                    className="flex items-center gap-3 py-2 mb-2"
                    style={{ borderTop: "1px solid var(--border)" }}
                  >
                    <span
                      className="text-xs font-semibold"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      Response
                    </span>
                    {response.status !== null ? (
                      <Badge color={statusColor}>
                        {response.status} {response.statusText}
                      </Badge>
                    ) : (
                      <Badge color="red">Error</Badge>
                    )}
                  </div>
                  {response.error ? (
                    <div
                      className="p-3 rounded-lg text-sm whitespace-pre-wrap break-words"
                      style={{
                        background: "var(--bg-secondary)",
                        color: "var(--color-error)",
                      }}
                    >
                      {response.error}
                    </div>
                  ) : (
                    <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                      <CodeBlock code={response.body} language="json" />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
