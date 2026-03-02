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
  Lightbulb,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeft,
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
  ForWhatItsWorth,
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
  Lightbulb,
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
  fwiw: ForWhatItsWorth,
};

function getHashPage(): string {
  const hash = window.location.hash.replace("#", "");
  return hash && pageMap[hash] ? hash : "overview";
}

const SIDEBAR_EXPANDED_W = "220px";
const SIDEBAR_COLLAPSED_W = "56px";

export default function Layout() {
  const [activePage, setActivePage] = useState(getHashPage);
  const [collapsed, setCollapsed] = useState(false);
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
  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_EXPANDED_W;

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{
        background: "var(--bg)",
        '--sidebar-width': sidebarWidth,
      } as React.CSSProperties}
    >
      {/* Sidebar — full height, self-contained */}
      <aside
        className="guide-sidebar flex flex-col shrink-0 border-r overflow-hidden"
        style={{
          width: sidebarWidth,
          height: "100vh",
          background: "var(--bg-secondary)",
          borderColor: "var(--border-subtle)",
          transition: "width 200ms ease",
        }}
      >
        {/* Sidebar header — branding + collapse toggle */}
        <div
          className="flex items-center shrink-0 border-b h-14"
          style={{
            borderColor: "var(--border-subtle)",
            padding: collapsed ? "0" : "0 12px",
            justifyContent: collapsed ? "center" : "space-between",
          }}
        >
          {!collapsed && (
            <div className="flex items-center gap-2 min-w-0 overflow-hidden">
              <img
                src="/favicon.jpeg"
                className="w-6 h-6 rounded-md shrink-0"
                alt="AI Evals"
              />
              <span
                className="text-[13px] font-semibold truncate"
                style={{ color: "var(--text)" }}
              >
                Guide
              </span>
            </div>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center justify-center rounded-md p-1.5 cursor-pointer transition-colors shrink-0"
            style={{
              color: "var(--text-muted)",
              background: "transparent",
              border: "none",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface-hover)";
              e.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--text-muted)";
            }}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {navigation.map((item) => {
            const Icon = iconMap[item.icon];
            const isActive = activePage === item.id;

            return (
              <button
                key={item.id}
                onClick={() => navigate(item.id)}
                className="flex items-center gap-2.5 w-full rounded-lg cursor-pointer transition-colors"
                style={{
                  padding: collapsed ? "8px 0" : "7px 10px",
                  justifyContent: collapsed ? "center" : "flex-start",
                  background: isActive ? "var(--accent)" : "transparent",
                  color: isActive ? "#ffffff" : "var(--text-secondary)",
                  border: "none",
                  fontSize: "13px",
                  fontWeight: isActive ? 600 : 500,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "var(--surface-hover)";
                    e.currentTarget.style.color = "var(--text)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--text-secondary)";
                  }
                }}
                title={collapsed ? item.label : undefined}
              >
                {Icon && <Icon size={16} />}
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Sidebar footer — theme toggle */}
        <div
          className="shrink-0 border-t px-2 py-2 flex"
          style={{
            borderColor: "var(--border-subtle)",
            justifyContent: collapsed ? "center" : "flex-start",
          }}
        >
          <button
            onClick={toggle}
            className="theme-toggle flex items-center gap-2 rounded-lg cursor-pointer transition-colors"
            style={{
              padding: collapsed ? "8px 0" : "7px 10px",
              justifyContent: collapsed ? "center" : "flex-start",
              width: collapsed ? "auto" : "100%",
              color: "var(--text-secondary)",
              background: "transparent",
              border: "none",
              fontSize: "13px",
              fontWeight: 500,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface-hover)";
              e.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
            title={collapsed ? `Switch to ${theme === "light" ? "dark" : "light"} mode` : undefined}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
            {!collapsed && <span>{theme === "light" ? "Dark mode" : "Light mode"}</span>}
          </button>
        </div>
      </aside>

      {/* Main content area — scrollable, full height */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        {/* Section Rail */}
        <SectionRail pageKey={activePage} />

        {/* Content */}
        <main className="mx-auto max-w-[1200px] w-full px-4 py-6 sm:px-8 flex-1">
          <PageComponent key={activePage} />
        </main>

        {/* Footer */}
        <footer
          className="footer text-center py-6 text-sm shrink-0"
          style={{
            color: "var(--text-muted)",
            borderTop: "1px solid var(--border)",
          }}
        >
          AI Evals Platform — Interactive Guide
        </footer>
      </div>
    </div>
  );
}
