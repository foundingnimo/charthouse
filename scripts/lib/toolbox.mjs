import { checkRepository } from "./check.mjs";
import { matchesGlob } from "./fs.mjs";
import { loadState } from "./state.mjs";
import { SURVEY_REPORT_ROLES, SURVEY_REPORT_SCHEMA_PATH, validateSurveyReport } from "./survey-report.mjs";

const TOOL_VERSION = "1.0.0";
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const READ_ONLY_PERMISSIONS = Object.freeze({
  repository_read: true,
  repository_write: false,
  network: false,
  subprocesses: []
});
const READ_ONLY_WITH_GIT_PERMISSIONS = Object.freeze({
  repository_read: true,
  repository_write: false,
  network: false,
  subprocesses: ["git"]
});

function limitSchema() {
  return { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT };
}

function inputSchema(properties = {}, required = []) {
  return { type: "object", additionalProperties: false, ...(required.length ? { required } : {}), properties };
}

function outputSchema(properties) {
  return { type: "object", additionalProperties: true, required: Object.keys(properties), properties };
}

function pathMatches(path, selector) {
  if (!selector || selector === ".") return true;
  const normalized = selector.replace(/^\.\//, "").replace(/\/$/, "");
  if (/[*?]/.test(normalized)) return matchesGlob(normalized, path);
  return path === normalized || path.startsWith(`${normalized}/`);
}

function bounded(items, limit) {
  return {
    total: items.length,
    returned: Math.min(items.length, limit),
    truncated: items.length > limit,
    items: items.slice(0, limit)
  };
}

const TOOLS = new Map([
  ["repository-files", {
    name: "repository-files",
    description: "List Map files with bounded path, role, language, owner, and Git-ignored filters.",
    permissions: READ_ONLY_PERMISSIONS,
    input_schema: inputSchema({
      path: { type: "string", description: "Repository-relative path prefix or glob." },
      role: { type: "string", enum: ["source", "test", "fixture", "generated"] },
      language: { type: "string" },
      owner: { type: "string" },
      gitignored: { type: "boolean" },
      limit: limitSchema()
    }),
    output_schema: outputSchema({ total: { type: "integer" }, returned: { type: "integer" }, truncated: { type: "boolean" }, files: { type: "array" } }),
    run(state, input) {
      const language = input.language?.toLowerCase();
      const files = state.map.files.filter((file) =>
        pathMatches(file.path, input.path)
        && (!input.role || file.role === input.role)
        && (!language || file.language.toLowerCase() === language)
        && (!input.owner || file.owner === input.owner || file.physical_owner === input.owner)
        && (input.gitignored === undefined || file.gitignored === input.gitignored)
      );
      const result = bounded(files, input.limit);
      return { total: result.total, returned: result.returned, truncated: result.truncated, files: result.items };
    }
  }],
  ["dependency-graph", {
    name: "dependency-graph",
    description: "Return repository units and internal dependency edges, optionally centered on matching units.",
    permissions: READ_ONLY_PERMISSIONS,
    input_schema: inputSchema({
      unit: { type: "string", description: "Unit ID, name, or root substring." },
      limit: limitSchema()
    }),
    output_schema: outputSchema({ matched_units: { type: "integer" }, returned_units: { type: "integer" }, truncated: { type: "boolean" }, units: { type: "array" }, dependencies: { type: "array" } }),
    run(state, input) {
      const query = input.unit?.toLowerCase();
      const seeds = query
        ? state.map.units.filter((unit) => [unit.id, unit.name, unit.root].some((value) => String(value).toLowerCase().includes(query)))
        : state.map.units;
      if (query && seeds.length === 0) throw new Error(`No repository unit matched: ${input.unit}`);
      const seedIds = new Set(seeds.map((unit) => unit.id));
      const dependencies = query
        ? state.map.dependencies.filter((edge) => seedIds.has(edge.from) || seedIds.has(edge.to))
        : state.map.dependencies;
      const visibleIds = query
        ? new Set([...seedIds, ...dependencies.flatMap((edge) => [edge.from, edge.to])])
        : new Set(state.map.units.map((unit) => unit.id));
      const units = query
        ? [
            ...seeds,
            ...state.map.units.filter((unit) => visibleIds.has(unit.id) && !seedIds.has(unit.id))
          ]
        : state.map.units;
      const limitedUnits = bounded(units, input.limit);
      const returnedIds = new Set(limitedUnits.items.map((unit) => unit.id));
      const visibleDependencies = dependencies.filter((edge) => returnedIds.has(edge.from) && returnedIds.has(edge.to));
      return {
        matched_units: seeds.length,
        returned_units: limitedUnits.returned,
        truncated: limitedUnits.truncated || visibleDependencies.length < dependencies.length,
        units: limitedUnits.items,
        dependencies: visibleDependencies
      };
    }
  }],
  ["documentation-index", {
    name: "documentation-index",
    description: "List registered documents with declared status, criticality, watches, and current Bearing findings.",
    permissions: READ_ONLY_WITH_GIT_PERMISSIONS,
    input_schema: inputSchema({
      status: { type: "string", enum: ["all", "current", "suspect", "stale", "missing", "superseded", "historical"], default: "all" },
      limit: limitSchema()
    }),
    output_schema: outputSchema({ total: { type: "integer" }, returned: { type: "integer" }, truncated: { type: "boolean" }, documents: { type: "array" }, review_required_perimeter: { type: "array" } }),
    run(state, input, root) {
      const report = checkRepository(root);
      const documents = Object.entries(state.manifest.documents || {}).map(([id, document]) => {
        const findings = report.findings.filter((item) => item.path === document.path);
        const codes = findings.map((item) => item.code);
        const effectiveStatus = codes.includes("document-missing")
          ? "missing"
          : codes.includes("document-suspect") || document.status === "suspect"
            ? "suspect"
            : document.status;
        return {
          id,
          path: document.path,
          declared_status: document.status,
          effective_status: effectiveStatus,
          criticality: document.criticality,
          kind: document.kind || "document",
          ownership: document.ownership || null,
          scope: document.scope || null,
          providers: document.providers || [],
          parent: document.parent || null,
          watches: document.watches || [],
          findings: findings.map(({ level, code, message }) => ({ level, code, message }))
        };
      }).filter((document) => input.status === "all" || document.effective_status === input.status);
      const result = bounded(documents, input.limit);
      return {
        total: result.total,
        returned: result.returned,
        truncated: result.truncated,
        documents: result.items,
        review_required_perimeter: (state.map.perimeter_regions || [])
          .filter((region) => region.review_required)
          .slice(0, input.limit)
      };
    }
  }],
  ["duplicate-analysis", {
    name: "duplicate-analysis",
    description: "Return bounded exact-duplicate groups and related deterministic anomalies from the Map.",
    permissions: READ_ONLY_PERMISSIONS,
    input_schema: inputSchema({
      path: { type: "string", description: "Repository-relative path prefix or glob." },
      limit: limitSchema()
    }),
    output_schema: outputSchema({ total: { type: "integer" }, returned: { type: "integer" }, truncated: { type: "boolean" }, groups: { type: "array" }, anomalies: { type: "array" } }),
    run(state, input) {
      const groups = (state.map.duplicate_groups || []).filter((group) =>
        !input.path || group.paths.some((path) => pathMatches(path, input.path))
      );
      const result = bounded(groups, input.limit);
      return {
        total: result.total,
        returned: result.returned,
        truncated: result.truncated,
        groups: result.items,
        anomalies: (state.map.anomalies || []).filter((item) => item.kind === "exact-duplicates")
      };
    }
  }],
  ["survey-report-validate", {
    name: "survey-report-validate",
    description: "Validate one isolated Expedition survey report before synthesis.",
    permissions: READ_ONLY_WITH_GIT_PERMISSIONS,
    contract: {
      schema: SURVEY_REPORT_SCHEMA_PATH,
      roles: SURVEY_REPORT_ROLES,
      maximum_bytes: 2 * 1024 * 1024,
      synthesis_requires_valid: true
    },
    input_schema: inputSchema({
      role: { type: "string", enum: SURVEY_REPORT_ROLES },
      file: { type: "string", description: "Repository-relative path to one JSON survey report." }
    }, ["role", "file"]),
    output_schema: outputSchema({ valid: { type: "boolean" }, role: { type: "string" }, file: { type: "string" }, bytes: { type: "integer" }, errors: { type: "array" }, warnings: { type: "array" }, counts: { type: "object" } }),
    run(state, input, root) {
      return validateSurveyReport(root, state, { role: input.role, file: input.file });
    }
  }]
]);

function publicTool(tool, includeSchemas = true) {
  const result = {
    name: tool.name,
    version: TOOL_VERSION,
    runtime: "node",
    description: tool.description,
    permissions: tool.permissions
  };
  if (includeSchemas) {
    result.input_schema = tool.input_schema;
    result.output_schema = tool.output_schema;
    if (tool.contract) result.contract = tool.contract;
  }
  return result;
}

function parseBoolean(value, name) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Tool option --${name.replaceAll("_", "-")} must be true or false.`);
}

function parseInput(args, schema) {
  const input = {};
  const remaining = [...args];
  while (remaining.length) {
    const token = remaining.shift();
    if (!token.startsWith("--")) throw new Error(`Unexpected tool argument: ${token}`);
    const [rawName, inlineValue] = token.slice(2).split(/=(.*)/s, 2);
    const name = rawName.replaceAll("-", "_");
    const rule = schema.properties[name];
    if (!rule) throw new Error(`Unknown tool option: --${rawName}`);
    const value = inlineValue ?? remaining.shift();
    if (value === undefined || value.startsWith("--")) throw new Error(`Tool option --${rawName} requires a value.`);
    if (rule.type === "integer") {
      if (!/^\d+$/.test(value)) throw new Error(`Tool option --${rawName} must be an integer.`);
      input[name] = Number(value);
      if ((rule.minimum !== undefined && input[name] < rule.minimum) || (rule.maximum !== undefined && input[name] > rule.maximum)) {
        throw new Error(`Tool option --${rawName} must be between ${rule.minimum} and ${rule.maximum}.`);
      }
    } else if (rule.type === "boolean") {
      input[name] = parseBoolean(value, name);
    } else {
      if (!value.length) throw new Error(`Tool option --${rawName} must not be empty.`);
      input[name] = value;
    }
    if (rule.enum && !rule.enum.includes(input[name])) {
      throw new Error(`Tool option --${rawName} must be one of: ${rule.enum.join(", ")}.`);
    }
  }
  for (const [name, rule] of Object.entries(schema.properties)) {
    if (input[name] === undefined && rule.default !== undefined) input[name] = rule.default;
  }
  for (const name of schema.required || []) {
    if (input[name] === undefined) throw new Error(`Tool option --${name.replaceAll("_", "-")} is required.`);
  }
  return input;
}

export function listTools() {
  return [...TOOLS.values()].map((tool) => publicTool(tool, false));
}

export function describeTool(name) {
  const tool = TOOLS.get(name);
  if (!tool) throw new Error(`Unknown Charthouse tool: ${name}`);
  return publicTool(tool);
}

export function runTool(root, name, args = []) {
  const tool = TOOLS.get(name);
  if (!tool) throw new Error(`Unknown Charthouse tool: ${name}`);
  const input = parseInput(args, tool.input_schema);
  const state = loadState(root);
  return {
    tool: name,
    version: TOOL_VERSION,
    input,
    permissions: tool.permissions,
    result: tool.run(state, input, root)
  };
}
