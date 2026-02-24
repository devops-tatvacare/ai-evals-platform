#!/usr/bin/env node
/**
 * sync-data.ts — Prebuild script that reads main app source files and
 * generates TypeScript data files for the education guide.
 *
 * Usage:  npx tsx scripts/sync-data.ts
 * Auto:   wired into npm run dev / npm run build via package.json
 *
 * Graceful failure: if source parsing fails, existing committed data
 * files remain in place as fallback.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
const DATA = resolve(__dirname, "../src/data");
const shouldSkipSync = ["1", "true", "yes"].includes(
  (process.env.GUIDE_SKIP_SYNC || "").toLowerCase(),
);

if (shouldSkipSync) {
  console.log("[sync] GUIDE_SKIP_SYNC is enabled; using committed guide data");
  process.exit(0);
}

let warnings = 0;
let synced = 0;

function read(rel: string): string | null {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) {
    warn(`source not found: ${rel}`);
    return null;
  }
  return readFileSync(p, "utf-8");
}

function write(file: string, content: string) {
  writeFileSync(resolve(DATA, file), content, "utf-8");
  console.log(`  \u2713 ${file}`);
  synced++;
}

function warn(msg: string) {
  console.warn(`  \u26A0 ${msg}`);
  warnings++;
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ── 1. Template Variables ───────────────────────────────────────────
// Source: backend/app/services/evaluators/variable_registry.py
// Parses VariableDefinition(...) constructor calls

function syncTemplateVars(): boolean {
  const src = read("backend/app/services/evaluators/variable_registry.py");
  if (!src) return false;

  // Extract each VariableDefinition(...) block by balanced-paren matching
  const blocks: string[] = [];
  const re = /VariableDefinition\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 1,
      i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
      i++;
    }
    blocks.push(src.substring(m.index + m[0].length, i - 1));
  }

  if (!blocks.length) return false;

  const vars: Array<{
    name: string;
    type: string;
    description: string;
    apps: string;
    promptTypes: string;
    flows: string;
  }> = [];

  for (const block of blocks) {
    // Extract positional string args (key, displayName, description, category, valueType)
    const strings: string[] = [];
    for (const sm of block.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      strings.push(sm[1]);
      if (strings.length >= 6) break;
    }
    if (strings.length < 5) continue;

    const [key, , description, category, valueType] = strings;

    // app_ids list — must be an array of quoted strings, e.g. ["voice-rx"]
    const appsM = block.match(
      /\[("(?:[^"\\]|\\.)*"(?:\s*,\s*"(?:[^"\\]|\\.)*")*)\]/,
    );
    const apps = appsM
      ? appsM[1]
          .replace(/"/g, "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .join(", ")
      : "";

    // type mapping
    let type: string;
    if (valueType === "file") type = "file";
    else if (
      block.includes("requires_eval_output=True") ||
      valueType === "number" ||
      valueType === "dynamic"
    )
      type = "computed";
    else type = "text";

    // flows from source_types kwarg
    const stM = block.match(/source_types=\[([^\]]*)\]/);
    const flows = stM
      ? stM[1]
          .replace(/"/g, "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .join(", ")
      : "all";

    // promptTypes heuristic based on category and key
    let promptTypes = "evaluation";
    if (valueType === "file") promptTypes = "transcription, evaluation";
    else if (
      category === "transcript" &&
      key !== "llm_transcript" &&
      key !== "chat_transcript"
    ) {
      promptTypes = "transcription, evaluation";
    } else if (["api_input", "api_rx"].includes(key))
      promptTypes = "transcription, evaluation";

    vars.push({
      name: `{{${key}}}`,
      type,
      description,
      apps,
      promptTypes,
      flows,
    });
  }

  if (!vars.length) return false;

  write(
    "templateVars.ts",
    `export interface TemplateVariable {
  name: string;
  type: 'file' | 'text' | 'computed';
  description: string;
  apps: string;
  promptTypes: string;
  flows: string;
}

export const templateVariables: TemplateVariable[] = [
${vars.map((v) => `  { name: '${v.name}', type: '${v.type}', description: '${esc(v.description)}', apps: '${v.apps}', promptTypes: '${v.promptTypes}', flows: '${v.flows}' },`).join("\n")}
];
`,
  );
  return true;
}

// ── 2. Database Models ──────────────────────────────────────────────
// Source: backend/app/models/*.py
// Parses class definitions, __tablename__, and mapped_column() calls

function syncDbModels(): boolean {
  const dir = resolve(ROOT, "backend/app/models");
  if (!existsSync(dir)) return false;

  const pyFiles = readdirSync(dir)
    .filter((f) => f.endsWith(".py") && !["__init__.py", "base.py"].includes(f))
    .sort();

  const models: Array<{
    model: string;
    table: string;
    keyColumns: string;
    description: string;
  }> = [];

  for (const file of pyFiles) {
    const src = readFileSync(resolve(dir, file), "utf-8");

    // Find classes extending Base/mixins
    const classRe = /^class\s+(\w+)\(([^)]*)\):/gm;
    let cm: RegExpExecArray | null;

    while ((cm = classRe.exec(src)) !== null) {
      const parents = cm[2];
      if (
        !parents.includes("Base") &&
        !parents.includes("TimestampMixin") &&
        !parents.includes("UserMixin")
      )
        continue;

      const className = cm[1];

      // Scope: from this class to the next top-level class or EOF
      const nextClass = src.indexOf("\nclass ", cm.index + 1);
      const section =
        nextClass > 0
          ? src.substring(cm.index, nextClass)
          : src.substring(cm.index);

      // Table name
      const tableM = section.match(/__tablename__\s*=\s*"([^"]+)"/);
      if (!tableM) continue;

      // Columns: name: Mapped[type] = mapped_column(...)
      const cols: string[] = [];
      const colRe =
        /^ {4}(\w+):\s*Mapped\[([^\]]+)\]\s*=\s*mapped_column\(([^)]*(?:\([^)]*\)[^)]*)*)\)/gm;
      let cc: RegExpExecArray | null;

      while ((cc = colRe.exec(section)) !== null) {
        const colName = cc[1];
        const rawType = cc[2].trim();
        const args = cc[3];

        let typeLabel = "String";
        if (rawType.includes("uuid")) typeLabel = "UUID";
        else if (rawType.includes("int")) typeLabel = "Integer";
        else if (rawType.includes("float") || rawType.includes("Float"))
          typeLabel = "Float";
        else if (rawType.includes("bool")) typeLabel = "Boolean";
        else if (rawType.includes("datetime")) typeLabel = "DateTime";
        else if (rawType.includes("dict")) typeLabel = "JSON";
        else if (rawType.includes("list")) typeLabel = "JSON";

        // Detect Text type from args
        if (args.includes("Text")) typeLabel = "Text";
        if (args.includes("JSON")) typeLabel = "JSON";

        // Flags
        const flags: string[] = [];
        if (args.includes("primary_key=True")) flags.push("PK");
        const fkM = args.match(/ForeignKey\("([^"]+)"/);
        if (fkM) flags.push(`FK\u2192${fkM[1]}`);
        if (rawType.includes("None") && !flags.includes("PK")) flags.push("?");

        const suffix = flags.length ? " " + flags.join(" ") : "";
        cols.push(`${colName} (${typeLabel}${suffix})`);
      }

      // Description from module docstring (first line)
      const docM = src.match(/^"""(.+?)"""/s);
      let desc = `${className} records`;
      if (docM) {
        const firstLine = docM[1].split("\n")[0].trim();
        if (firstLine.length > 5) desc = firstLine.replace(/\.\s*$/, "");
      }

      models.push({
        model: className,
        table: tableM[1],
        keyColumns: cols.join(", "),
        description: desc,
      });
    }
  }

  if (!models.length) return false;

  write(
    "dbModels.ts",
    `export interface DbModel {
  model: string;
  table: string;
  keyColumns: string;
  description: string;
}

export const dbModels: DbModel[] = [
${models.map((m) => `  { model: '${m.model}', table: '${m.table}', keyColumns: '${esc(m.keyColumns)}', description: '${esc(m.description)}' },`).join("\n")}
];
`,
  );
  return true;
}

// ── 3. API Routes ───────────────────────────────────────────────────
// Source: backend/app/routes/*.py
// Parses APIRouter(prefix=...) and @router.method("path") decorators

function syncApiRoutes(): boolean {
  const dir = resolve(ROOT, "backend/app/routes");
  if (!existsSync(dir)) return false;

  const pyFiles = readdirSync(dir)
    .filter((f) => f.endsWith(".py") && f !== "__init__.py")
    .sort();

  const routes: Array<{
    router: string;
    prefix: string;
    keyEndpoints: string;
    description: string;
  }> = [];

  for (const file of pyFiles) {
    const src = readFileSync(resolve(dir, file), "utf-8");

    // Find all APIRouter declarations: varname = APIRouter(prefix="...")
    const routerRe = /(\w+)\s*=\s*APIRouter\(prefix="([^"]+)"/g;
    let rm: RegExpExecArray | null;

    while ((rm = routerRe.exec(src)) !== null) {
      const varName = rm[1];
      const prefix = rm[2];

      // Find all endpoint decorators for this router variable
      const decorRe = new RegExp(
        `@${varName}\\.(get|post|put|delete|patch)\\("([^"]*)"`,
        "g",
      );
      const endpoints: string[] = [];
      let dm: RegExpExecArray | null;

      while ((dm = decorRe.exec(src)) !== null) {
        const method = dm[1].toUpperCase();
        const path = dm[2] || "/";
        endpoints.push(`${method} ${path}`);
      }

      // Router name from variable or file
      const routerName =
        varName === "router"
          ? file.replace(".py", "")
          : varName.replace(/_router$/, "");

      // Description from module docstring
      const docM = src.match(/^"""(.+?)"""/s);
      let desc = `${routerName} API`;
      if (docM) {
        const firstLine = docM[1].split("\n")[0].trim();
        if (firstLine.length > 5) desc = firstLine.replace(/\.\s*$/, "");
      }

      routes.push({
        router: routerName,
        prefix,
        keyEndpoints: endpoints.join(", "),
        description: desc,
      });
    }
  }

  if (!routes.length) return false;

  write(
    "apiRoutes.ts",
    `export interface ApiRoute {
  router: string;
  prefix: string;
  keyEndpoints: string;
  description: string;
}

export const apiRoutes: ApiRoute[] = [
${routes.map((r) => `  { router: '${r.router}', prefix: '${r.prefix}', keyEndpoints: '${esc(r.keyEndpoints)}', description: '${esc(r.description)}' },`).join("\n")}
];
`,
  );
  return true;
}

// ── 4. Evaluators ───────────────────────────────────────────────────
// Source: backend/app/services/seed_defaults.py
// Uses a Python helper script to extract evaluator constants as JSON,
// then writes a typed TypeScript data file.

interface RawSchemaField {
  key: string;
  type: string;
  description: string;
  displayMode?: string;
  isMainMetric?: boolean;
  thresholds?: { green?: number; yellow?: number };
  role?: string;
  enumValues?: string[];
  arrayItemSchema?: {
    itemType: string;
    properties: Array<{ key: string; type: string; description: string }>;
  };
}

interface RawEvaluator {
  name: string;
  prompt: string;
  output_schema: RawSchemaField[];
  app_id?: string;
  is_global?: boolean;
  show_in_header?: boolean;
  listing_id?: null;
}

function syncEvaluators(): boolean {
  const script = resolve(__dirname, "extract_evaluators.py");
  if (!existsSync(script)) {
    warn("extract_evaluators.py not found");
    return false;
  }

  let raw: string;
  try {
    raw = execSync(`python3 "${script}"`, {
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();
  } catch {
    warn("python3 extract_evaluators.py failed — is python3 available?");
    return false;
  }

  let data: Record<string, RawEvaluator[]>;
  try {
    data = JSON.parse(raw);
  } catch {
    warn("evaluators JSON parse failed");
    return false;
  }

  if ("error" in data) {
    warn(`evaluator extraction: ${String((data as unknown as { error: string }).error)}`);
    return false;
  }

  // Build typed evaluator entries grouped by scope
  const groups: Array<{
    groupId: string;
    groupLabel: string;
    appId: string;
    evaluators: RawEvaluator[];
  }> = [];

  if (data.kaira_bot) {
    groups.push({
      groupId: "kaira-bot",
      groupLabel: "Kaira Bot",
      appId: "kaira-bot",
      evaluators: data.kaira_bot,
    });
  }
  if (data.voice_rx_upload) {
    groups.push({
      groupId: "voice-rx-upload",
      groupLabel: "Voice RX — Upload Flow",
      appId: "voice-rx",
      evaluators: data.voice_rx_upload,
    });
  }
  if (data.voice_rx_api) {
    groups.push({
      groupId: "voice-rx-api",
      groupLabel: "Voice RX — API Flow",
      appId: "voice-rx",
      evaluators: data.voice_rx_api,
    });
  }

  // Strip fields not needed in docs (listing_id is always null)
  for (const g of groups) {
    g.evaluators = g.evaluators.map(
      ({ name, prompt, output_schema, app_id, is_global, show_in_header }) => ({
        name,
        prompt,
        output_schema,
        ...(app_id != null && { app_id }),
        ...(is_global != null && { is_global }),
        ...(show_in_header != null && { show_in_header }),
      }),
    );
  }

  // Serialize to TypeScript
  const jsonStr = JSON.stringify(groups, null, 2);

  write(
    "evaluators.ts",
    `// Auto-generated by sync-data.ts — do not edit manually.
// Source: backend/app/services/seed_defaults.py

export interface EvaluatorSchemaField {
  key: string;
  type: string;
  description: string;
  displayMode?: string;
  isMainMetric?: boolean;
  thresholds?: { green?: number; yellow?: number };
  role?: string;
  enumValues?: string[];
  arrayItemSchema?: {
    itemType: string;
    properties: Array<{ key: string; type: string; description: string }>;
  };
}

export interface SeedEvaluator {
  name: string;
  prompt: string;
  output_schema: EvaluatorSchemaField[];
  app_id?: string;
  is_global?: boolean;
  show_in_header?: boolean;
}

export interface EvaluatorGroup {
  groupId: string;
  groupLabel: string;
  appId: string;
  evaluators: SeedEvaluator[];
}

export const evaluatorGroups: EvaluatorGroup[] = ${jsonStr};
`,
  );
  return true;
}

// ── 5. Brain Map — verify file paths ────────────────────────────────
// The brain map data is curated (feature groupings, node IDs, etc.).
// We only verify that referenced file paths still exist in the codebase
// and log warnings for stale references.

function verifyBrainMap(): void {
  const dataFile = resolve(DATA, "brainMap.ts");
  if (!existsSync(dataFile)) {
    warn("brainMap.ts not found");
    return;
  }

  const src = readFileSync(dataFile, "utf-8");

  // Extract all fullPath values
  const pathRe = /fullPath:\s*'([^']+)'/g;
  let pm: RegExpExecArray | null;
  let total = 0;
  let missing = 0;

  while ((pm = pathRe.exec(src)) !== null) {
    total++;
    const filePath = pm[1];
    if (!existsSync(resolve(ROOT, filePath))) {
      warn(`brain map stale ref: ${filePath}`);
      missing++;
    }
  }

  if (missing === 0 && total > 0) {
    console.log(`  \u2713 brainMap.ts (${total} file refs verified)`);
  } else if (missing > 0) {
    console.log(`  \u26A0 brainMap.ts (${missing}/${total} file refs stale)`);
  }
}

// ── Main ────────────────────────────────────────────────────────────

console.log("[sync] Syncing guide data from main app sources...");
console.log(`  Root: ${ROOT}`);
console.log(`  Data: ${DATA}`);
console.log("");

try {
  if (!syncTemplateVars())
    warn("templateVars sync failed — using existing fallback");
} catch (e) {
  warn(`templateVars error: ${e instanceof Error ? e.message : String(e)}`);
}

try {
  if (!syncDbModels()) warn("dbModels sync failed — using existing fallback");
} catch (e) {
  warn(`dbModels error: ${e instanceof Error ? e.message : String(e)}`);
}

try {
  if (!syncApiRoutes()) warn("apiRoutes sync failed — using existing fallback");
} catch (e) {
  warn(`apiRoutes error: ${e instanceof Error ? e.message : String(e)}`);
}

try {
  if (!syncEvaluators())
    warn("evaluators sync failed — using existing fallback");
} catch (e) {
  warn(`evaluators error: ${e instanceof Error ? e.message : String(e)}`);
}

try {
  verifyBrainMap();
} catch (e) {
  warn(`brainMap verify error: ${e instanceof Error ? e.message : String(e)}`);
}

console.log("");
console.log(`[sync] Done — ${synced} files updated, ${warnings} warnings`);

// Never fail the build
process.exit(0);
