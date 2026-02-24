import { useState, useEffect, useCallback, type ComponentType } from "react";
import {
  LayoutDashboard,
  GitBranch,
  Key,
  FileText,
  FlaskConical,
  Workflow,
  Code2,
  Database,
  Package,
  Terminal,
  Sun,
  Moon,
} from "lucide-react";
import { navigation } from "@/data/navigation";
import { useTheme } from "@/hooks/useTheme";
import SectionRail from "./SectionRail";
import {
  Overview,
  Workflows,
  ApiAuth,
  PromptsSchemas,
  Evaluators,
  Pipelines,
  BrainMap,
  DbApiRef,
  Sbom,
  ApiExplorer,
} from "@/pages";

const iconMap: Record<string, ComponentType<{ size?: number }>> = {
  Layout: LayoutDashboard,
  GitBranch,
  Key,
  FileText,
  FlaskConical,
  Workflow,
  Code2,
  Database,
  Package,
  Terminal,
};

const pageMap: Record<string, ComponentType> = {
  overview: Overview,
  workflows: Workflows,
  "api-auth": ApiAuth,
  "prompts-schemas": PromptsSchemas,
  evaluators: Evaluators,
  pipelines: Pipelines,
  "brain-map": BrainMap,
  "db-api-ref": DbApiRef,
  sbom: Sbom,
  "api-explorer": ApiExplorer,
};

function getHashPage(): string {
  const hash = window.location.hash.replace("#", "");
  return hash && pageMap[hash] ? hash : "overview";
}

export default function Layout() {
  const [activePage, setActivePage] = useState(getHashPage);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    const onHashChange = () => setActivePage(getHashPage());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((id: string) => {
    window.location.hash = id;
  }, []);

  const PageComponent = pageMap[activePage] ?? Overview;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <header
        className="header sticky top-0 z-50 flex items-center justify-center relative h-14 px-4 sm:px-8"
        style={{
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          background: "var(--glass-bg)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="flex items-center gap-3">
          <img
            src="/favicon.jpeg"
            className="w-7 h-7 rounded-md"
            alt="AI Evals"
          />
          <span
            className="text-[15px] font-semibold"
            style={{ color: "var(--text)" }}
          >
            AI Evals Platform
          </span>
          <span
            style={{
              color: "var(--border)",
              fontSize: "18px",
              fontWeight: 200,
              lineHeight: 1,
            }}
          >
            |
          </span>
          <span
            className="text-[13px] font-medium"
            style={{ color: "var(--accent-text)" }}
          >
            Interactive Guide
          </span>
        </div>
        <button
          onClick={toggle}
          className="theme-toggle absolute right-4 sm:right-8 flex items-center justify-center w-10 h-10 rounded-full cursor-pointer transition-colors"
          style={{
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text-secondary)",
          }}
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
        >
          {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </header>

      {/* Nav Tabs */}
      <nav
        className="nav-tabs sticky top-14 z-40 flex justify-center gap-1 overflow-x-auto px-4 py-2 sm:px-8"
        style={{
          borderBottom: "1px solid var(--border)",
          scrollbarWidth: "none",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          background: "var(--glass-bg)",
        }}
      >
        {navigation.map((item) => {
          const Icon = iconMap[item.icon];
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap cursor-pointer transition-colors"
              style={{
                background: isActive ? "var(--accent)" : "transparent",
                color: isActive ? "#ffffff" : "var(--text-secondary)",
                border: "none",
              }}
            >
              {Icon && <Icon size={16} />}
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Section Rail */}
      <SectionRail pageKey={activePage} />

      {/* Content */}
      <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-8">
        <PageComponent key={activePage} />
      </main>

      {/* Footer */}
      <footer
        className="footer text-center py-6 text-sm"
        style={{
          color: "var(--text-muted)",
          borderTop: "1px solid var(--border)",
        }}
      >
        AI Evals Platform — Interactive Guide
      </footer>
    </div>
  );
}
