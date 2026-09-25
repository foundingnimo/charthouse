import { readFileSync } from "node:fs";
import { checkRepository } from "./check.mjs";
import { PATHS } from "./constants.mjs";
import { repoPath } from "./fs.mjs";
import { impact, lexicalTerms, pathMatches, rankCapabilityMatches } from "./query.mjs";
import { navigatorIdentity } from "./render.mjs";
import { listVoyages, voyagePathsOverlap } from "./voyages.mjs";

export const PRE_RESPONSE_GATE = Object.freeze({
  required: true,
  run: "immediately-before-every-substantive-response",
  decision_gate: {
    triggers: ["the verified premise already holds", "two or more materially different interpretations remain"],
    unless_user_requested: ["detailed evidence", "a contingent implementation plan"],
    include: ["one concise verified conclusion", "one material freshness caveat when needed", "exactly one focused decision question"],
    exclude: ["ownership or specialist lists", "path inventories", "risks", "verification checks", "speculative implementation", "routine no-write bookkeeping"],
    maximum_questions: 1
  },
  always: [
    "answer the current request before adjacent findings",
    "omit routine command and write-status narration",
    "remove content that does not change the answer or immediate decision",
    "check whether verified friction is a Charthouse improvement candidate"
  ]
});

function overlaps(left, right) {
  try { return voyagePathsOverlap(left, right); } catch { return false; }
}

function capabilityUnits(state, capabilities) {
  const ids = new Set(capabilities.flatMap((capability) => capability.units || []));
  for (const unit of state.map.units || []) {
    const root = unit.root === "." ? "**" : `${unit.root}/**`;
    if (capabilities.some((capability) => (capability.primary_paths || []).some((path) => overlaps(path, root)))) ids.add(unit.id);
  }
  return ids;
}

function instructionApplies(contract, paths) {
  if (contract.scope === ".") return true;
  const scoped = `${contract.scope}/**`;
  return paths.some((path) => overlaps(path, scoped));
}

function reviewTarget(state, review) {
  if (state.manifest.navigators?.[review.navigator]) {
    const capability = state.map.capabilities.find((candidate) => navigatorIdentity(candidate) === review.navigator);
    return { id: review.navigator, capability };
  }
  const capability = state.map.capabilities.find((candidate) => candidate.id === review.navigator || candidate.name === review.navigator);
  return capability ? { id: navigatorIdentity(capability), capability } : null;
}

function selectReviewers(state, capabilities, responsibleIds, ranked, objective) {
  const rankById = new Map(ranked.map((item) => [item.capability.id, item]));
  const objectiveTerms = new Set(lexicalTerms(objective, { removeStopWords: true }));
  const candidates = new Map();
  for (const review of capabilities.flatMap((capability) => capability.review || [])) {
    const target = reviewTarget(state, review);
    if (!target || responsibleIds.has(target.id)) continue;
    const match = target.capability ? rankById.get(target.capability.id) : null;
    const reasonTerms = lexicalTerms(review.reason || "", { removeStopWords: true })
      .filter((term) => objectiveTerms.has(term));
    const matchedTerms = [...new Set([...(match?.matched_terms || []), ...reasonTerms])];
    const existing = candidates.get(target.id);
    const item = {
      id: target.id,
      score: (match?.score || 0) + (reasonTerms.length * 3),
      matched_terms: matchedTerms
    };
    if (!existing || item.score > existing.score) candidates.set(target.id, item);
  }
  const ordered = [...candidates.values()].sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const matched = ordered.filter((item) => item.matched_terms.length >= 2);
  return (matched.length ? matched : ordered.length === 1 ? ordered : []).slice(0, 2).map((item) => item.id);
}

function shellTokens(command) {
  return (String(command).match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s]+/g) || [])
    .map((token) => token.replace(/^(["'])(.*)\1$/, "$2"));
}

function npmVerification(command) {
  const tokens = shellTokens(command);
  const npmIndex = tokens.indexOf("npm");
  if (npmIndex < 0 || tokens.slice(0, npmIndex).some((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token))) return null;
  const args = tokens.slice(npmIndex + 1);
  let workspace = null;
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--workspace" || token === "-w") {
      workspace = args[index + 1] || null;
      index += 1;
    } else if (token.startsWith("--workspace=")) {
      workspace = token.slice("--workspace=".length);
    } else if (!token.startsWith("-")) {
      positional.push(token);
    }
  }
  const script = ["run", "run-script"].includes(positional[0])
    ? positional[1]
    : ["test", "start", "stop", "restart"].includes(positional[0]) ? positional[0] : null;
  return script ? { script, workspace } : null;
}

function packageManifest(root, state, workspace) {
  const direct = workspace ? `${workspace.replace(/^\.\//, "").replace(/\/$/, "")}/package.json` : "package.json";
  const candidates = [direct];
  if (workspace) {
    for (const unit of state.map.units || []) {
      if (unit.name === workspace || unit.root === workspace) candidates.push(...(unit.manifests || []), unit.manifest);
    }
  }
  for (const candidate of [...new Set(candidates.filter((item) => item?.endsWith("package.json")))]) {
    try {
      const manifest = JSON.parse(readFileSync(repoPath(root, candidate), "utf8"));
      if (!workspace || candidate === direct || manifest.name === workspace) return { path: candidate, scripts: manifest.scripts || {} };
    } catch {}
  }
  return null;
}

function invokedNpmScripts(script) {
  return [...String(script).matchAll(/\bnpm\s+(?:(?:run|run-script)\s+)?([A-Za-z0-9:_-]+)/g)]
    .map((match) => match[1]);
}

function scriptInvokes(scripts, parent, child, seen = new Set()) {
  if (parent === child || seen.has(parent)) return parent === child;
  seen.add(parent);
  return invokedNpmScripts(scripts[parent] || "")
    .some((script) => script === child || scriptInvokes(scripts, script, child, seen));
}

function verificationSubsumes(root, state, parentCommand, childCommand) {
  const parent = npmVerification(parentCommand);
  const child = npmVerification(childCommand);
  if (!parent || !child || parent.script === child.script) return false;
  const parentManifest = packageManifest(root, state, parent.workspace);
  const childManifest = packageManifest(root, state, child.workspace);
  if (!parentManifest || !childManifest || parentManifest.path !== childManifest.path) return false;
  return scriptInvokes(parentManifest.scripts, parent.script, child.script);
}

function deduplicateVerification(root, state, commands) {
  const unique = [...new Set(commands)];
  return unique.filter((command, index) => !unique.some((candidate, candidateIndex) => {
    if (candidateIndex === index || !verificationSubsumes(root, state, candidate, command)) return false;
    return !verificationSubsumes(root, state, command, candidate) || candidateIndex < index;
  }));
}

function selectVerification(root, state, capabilities, matchByCapability, objective) {
  const objectiveTerms = new Set(lexicalTerms(objective, { removeStopWords: true }));
  const selected = [];
  for (const capability of capabilities) {
    const match = matchByCapability.get(capability.id);
    const pathTerms = lexicalTerms((match?.matched_paths || []).join(" "));
    const targetTerms = new Set([...objectiveTerms, ...pathTerms]);
    const commands = capability.verification || [];
    const ranked = commands.map((command, index) => ({
      command,
      index,
      score: lexicalTerms(command).filter((term) => targetTerms.has(term)).length
    })).sort((left, right) => right.score - left.score || left.index - right.index);
    const capabilitySelection = [];
    if (ranked[0]?.score > 0) capabilitySelection.push(ranked[0].command);
    for (const command of commands) {
      if (capabilitySelection.length >= 3) break;
      if (!capabilitySelection.includes(command)) capabilitySelection.push(command);
    }
    selected.push(...capabilitySelection);
  }
  return deduplicateVerification(root, state, selected).slice(0, 8);
}

function selectDocuments(entries, objective, limit = 8) {
  const objectiveTerms = new Set(lexicalTerms(objective, { removeStopWords: true }));
  const criticalityWeight = { binding: 5, operational: 2, informational: 0 };
  const statusWeight = { stale: 3, suspect: 2, current: 0, historical: 0 };
  return entries.map((entry, index) => {
    const [id, document] = entry;
    const lexicalScore = lexicalTerms(`${id} ${document.path}`).filter((term) => objectiveTerms.has(term)).length * 5;
    return {
      entry,
      index,
      score: lexicalScore + (criticalityWeight[document.criticality] || 0) + (statusWeight[document.status] || 0)
    };
  }).sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((item) => item.entry);
}

export function buildBrief(root, objective) {
  const report = checkRepository(root);
  const state = report.state;
  const predicted = impact(root, objective);
  const capabilities = predicted.capabilities;
  const matchByCapability = new Map((predicted.matches || []).map((match) => [match.capability, match]));
  const paths = [...new Set(capabilities.flatMap((capability) => {
    const matched = matchByCapability.get(capability.id)?.matched_paths || [];
    return matched.length ? matched : capability.primary_paths || [];
  }))].sort();
  const responsibleIds = new Set(predicted.navigators);
  const ranked = rankCapabilityMatches(state, objective);
  const reviewingIds = new Set(selectReviewers(state, capabilities, responsibleIds, ranked, objective));
  const navigatorIds = [...new Set([...responsibleIds, ...reviewingIds])].sort();
  const unitIds = capabilityUnits(state, capabilities);
  const dependencies = (state.map.dependencies || [])
    .filter((edge) => unitIds.has(edge.from) || unitIds.has(edge.to));
  const knowledge = Object.entries(state.manifest.knowledge || {})
    .filter(([, record]) => paths.some((path) => (record.paths || []).some((recordPath) => overlaps(path, recordPath))))
    .map(([id, record]) => ({ id, source: record.source, status: record.status, paths: record.paths || [] }));
  const documentEntries = Object.entries(state.manifest.documents || {})
    .filter(([, document]) => document.kind !== "instruction-contract")
    .filter(([id, document]) => !id.startsWith("navigator-") && !document.path.startsWith("docs/charthouse/"))
    .filter(([, document]) => paths.some((path) => (document.watches || []).some((watch) => overlaps(path, watch))));
  const documents = selectDocuments(documentEntries, objective)
    .map(([id, document]) => ({
      id,
      path: document.path,
      status: document.status,
      criticality: document.criticality,
      findings: report.findings.filter((finding) => finding.path === document.path).map((finding) => finding.code)
    }));
  const instructionContracts = (state.map.instruction_contracts || [])
    .filter((contract) => instructionApplies(contract, paths))
    .map((contract) => ({
      id: contract.id,
      path: contract.path,
      kind: contract.kind,
      providers: contract.providers,
      scope: contract.scope,
      parent: contract.parent,
      ownership: contract.ownership,
      over_limit: contract.over_limit,
      findings: report.findings.filter((finding) => finding.path === contract.path).map((finding) => finding.code)
    }));
  const activeVoyages = listVoyages(root, { openOnly: true }).filter((voyage) => voyage.status === "active");
  const conflicts = activeVoyages
    .filter((voyage) => paths.some((path) => voyage.leased_paths.some((lease) => overlaps(path, lease))))
    .map((voyage) => ({ id: voyage.id, objective: voyage.objective, leased_paths: voyage.leased_paths }));
  const verification = selectVerification(root, state, capabilities, matchByCapability, objective);
  const decisions = [];
  const canonicalFinding = report.findings.find((finding) => finding.code.startsWith("canonical-") && finding.level === "error");
  if (canonicalFinding) decisions.push(canonicalFinding.message);
  if (report.charter.state !== "complete") decisions.push(`The Charter is ${report.charter.state}; do not claim an approved intent constraint.`);
  if (capabilities.some((capability) => capability.approved !== true)) decisions.push("One or more predicted capability boundaries are preliminary and need verification.");
  if (documents.some((document) => document.findings.length || document.status === "suspect" || document.status === "stale")) decisions.push("Review the affected suspect or stale documents before relying on them.");
  if (conflicts.length) decisions.push("Resolve the active Voyage path overlap before implementation.");
  if (!capabilities.length) decisions.push("Lexical impact prediction found no capability. Ask the repository mapper or inspect the Map before implementation.");
  let charterText = null;
  try { charterText = readFileSync(repoPath(root, PATHS.charter), "utf8"); } catch {}
  const charterLimit = 12000;

  return {
    objective,
    publication: report.publication,
    git: report.canonical,
    bearing: {
      current: report.current,
      errors: report.errors,
      warnings: report.warnings,
      relevant_findings: report.findings.filter((finding) => !finding.path || paths.some((path) => pathMatches(path, finding.path)))
    },
    charter: {
      state: report.charter.state,
      path: PATHS.charter,
      text: charterText && charterText.length > charterLimit ? charterText.slice(0, charterLimit) : charterText,
      truncated: Boolean(charterText && charterText.length > charterLimit)
    },
    likely_paths: paths,
    capabilities: capabilities.map((capability) => ({
      id: capability.id,
      name: capability.name,
      purpose: capability.purpose,
      confidence: capability.confidence,
      approved: capability.approved === true,
      primary_paths: capability.primary_paths,
      evidence: capability.evidence,
      selection: matchByCapability.get(capability.id) || null
    })),
    navigators: navigatorIds.map((id) => ({
      id,
      role: responsibleIds.has(id) && reviewingIds.has(id) ? "responsible-and-reviewing" : responsibleIds.has(id) ? "responsible" : "reviewing",
      ...state.manifest.navigators[id]
    })),
    knowledge,
    instruction_contracts: instructionContracts,
    documents,
    dependencies,
    verification,
    active_voyage_conflicts: conflicts,
    required_human_decisions: decisions,
    pre_response_gate: PRE_RESPONSE_GATE,
    note: "Impact selection uses ranked lexical evidence and bounded review expansion. A Navigator must verify semantic scope before implementation."
  };
}

function lines(items, render, empty = "- None") {
  return items.length ? items.map((item) => `- ${render(item)}`) : [empty];
}

export function renderBrief(brief) {
  const output = [
    `Charthouse brief: ${brief.objective}`,
    "",
    `Map publication: ${brief.publication.state} (${brief.publication.map}; Bearing ${brief.publication.bearing})`,
    `Bearing: ${brief.bearing.current ? "current" : "needs attention"} (${brief.bearing.errors} error(s), ${brief.bearing.warnings} warning(s))`,
    `Canonical branch: ${brief.git.ref || "unpinned"} (${brief.git.relationship})`,
    `Charter: ${brief.charter.state} (${brief.charter.path})`,
    "",
    "Likely paths:",
    ...lines(brief.likely_paths, (path) => path),
    "",
    "Navigators:",
    ...lines(brief.navigators, (navigator) => `${navigator.id}: ${navigator.role} (${navigator.source})`),
    "",
    "Knowledge:",
    ...lines(brief.knowledge, (record) => `${record.id}: ${record.status} (${record.source})`),
    "",
    "Instruction contracts:",
    ...lines(brief.instruction_contracts, (contract) => `${contract.path}: ${contract.kind}, scope ${contract.scope}${contract.findings.length ? ` [${contract.findings.join(", ")}]` : ""}`),
    "",
    "Documents:",
    ...lines(brief.documents, (document) => `${document.id}: ${document.status}${document.findings.length ? ` [${document.findings.join(", ")}]` : ""} (${document.path})`),
    "",
    "Verification:",
    ...lines(brief.verification, (command) => command),
    "",
    "Required decisions:",
    ...lines(brief.required_human_decisions, (decision) => decision),
    "",
    "Pre-response gate: required. If the premise already holds or the request is materially ambiguous, return only a concise verified conclusion, a material freshness caveat when needed, and one focused decision question. Omit ownership, path inventories, risks, checks, speculative implementation, and routine bookkeeping.",
    "",
    brief.note
  ];
  return `${output.join("\n")}\n`;
}
