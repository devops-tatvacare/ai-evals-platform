import type { ComponentType } from "react";

export interface NavItem {
  id: string;
  label: string;
  icon: string; // lucide icon name
}

export const navigation: NavItem[] = [
  { id: "overview", label: "Overview", icon: "Layout" },
  { id: "workflows", label: "Workflows", icon: "GitBranch" },
  { id: "api-auth", label: "API & Auth", icon: "Key" },
  { id: "prompts-schemas", label: "Prompts & Schemas", icon: "FileText" },
  { id: "evaluators", label: "Evaluators", icon: "FlaskConical" },
  { id: "pipelines", label: "Pipelines", icon: "Workflow" },
  { id: "brain-map", label: "Code Map", icon: "Code2" },
  { id: "db-api-ref", label: "DB & API Ref", icon: "Database" },
  { id: "api-explorer", label: "API Explorer", icon: "Terminal" },
  { id: "sbom", label: "SBOM", icon: "Package" },
  { id: "fwiw", label: "For What It's Worth?", icon: "Lightbulb" },
];

export interface PageDef {
  id: string;
  component: ComponentType;
}
