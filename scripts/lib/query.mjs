import { readFileSync } from "node:fs";
import { PATHS } from "./constants.mjs";
import { exists, matchesGlob, repoPath } from "./fs.mjs";
import { loadState, readKnowledgeFiles } from "./state.mjs";

function includes(value, query) {
  return String(value).toLowerCase().includes(query.toLowerCase());
}

const IMPACT_STOP_WORDS = new Set([
  "add", "backed", "change", "create", "delete", "fix", "for", "from",
  "handling", "into", "its", "make", "move", "new", "our", "remove",
  "rename", "setting", "settings", "that", "the", "their", "these", "this",
  "those", "update", "use", "using", "with", "without", "work", "working",
  "your"
]);

function normalizeTerm(value) {
  if (value === "apps") return "app";
  if (value.length > 4 && value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.length > 4 && value.endsWith("s") && !value.endsWith("ss")) return value.slice(0, -1);
  return value;
}

export function lexicalTerms(value, { removeStopWords = false } = {}) {
  const expanded = String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2)
    .map(normalizeTerm);
  return [...new Set(removeStopWords ? expanded.filter((term) => !IMPACT_STOP_WORDS.has(term)) : expanded)];
}

function termSet(values) {
  return new Set(lexicalTerms(values.filter(Boolean).join(" ")));
}

function intersection(left, right) {
  return [...left].filter((term) => right.has(term));
}

function capabilityTerms(capability) {
  return {
    identity: termSet([capability.id, capability.name]),
    primary: termSet(capability.primary_paths || []),
    secondary: termSet(capability.secondary_paths || []),
    purpose: termSet([capability.purpose]),
    evidence: termSet(capability.evidence || [])
  };
}

export function rankCapabilityMatches(state, proposal) {
  const queryTerms = lexicalTerms(proposal, { removeStopWords: true });
  if (!queryTerms.length) return [];
  const querySet = new Set(queryTerms);
  const indexed = (state.map.capabilities || []).map((capability) => ({
    capability,
    terms: capabilityTerms(capability)
  }));
  const frequencies = new Map(queryTerms.map((term) => [
    term,
    indexed.filter(({ terms }) => Object.values(terms).some((values) => values.has(term))).length
  ]));
  const total = Math.max(indexed.length, 1);

  return indexed.map(({ capability, terms }) => {
    const matchedTerms = queryTerms.filter((term) => Object.values(terms).some((values) => values.has(term)));
    const directMatchedTerms = queryTerms.filter((term) => terms.identity.has(term) || terms.primary.has(term));
    let score = 0;
    for (const term of matchedTerms) {
      const weight = terms.primary.has(term) ? 7
        : terms.identity.has(term) ? 5
          : terms.purpose.has(term) ? 3
            : terms.secondary.has(term) ? 2
              : 1;
      const specificity = 1 + Math.log2((total + 1) / ((frequencies.get(term) || 0) + 1));
      score += weight * specificity;
    }
    const pathScores = (capability.primary_paths || []).map((path) => ({
      path,
      matches: intersection(new Set(lexicalTerms(path)), querySet).length
    }));
    const bestPathScore = Math.max(0, ...pathScores.map((item) => item.matches));
    const matchedPaths = bestPathScore > 0
      ? pathScores.filter((item) => item.matches === bestPathScore).map((item) => item.path)
      : [];
    return {
      capability,
      score,
      matched_terms: matchedTerms,
      direct_matched_terms: directMatchedTerms,
      matched_paths: matchedPaths
    };
  }).filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.capability.name.localeCompare(right.capability.name));
}

export function pathMatches(pattern, path) {
  if (pattern === "**" || pattern === ".") return true;
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  if (/[*?]/.test(pattern)) return matchesGlob(pattern, path);
  return path === pattern || path.startsWith(`${pattern}/`);
}

export function matchingNavigators(state, path) {
  return Object.entries(state.manifest.navigators || {})
    .filter(([, navigator]) => [...navigator.primary_paths, ...(navigator.secondary_paths || [])].some((pattern) => pathMatches(pattern, path)))
    .map(([id]) => id);
}

export function findMap(root, query) {
  const { map } = loadState(root);
  return map.capabilities.filter((item) => [item.id, item.name, item.purpose, ...item.primary_paths, ...item.evidence].some((value) => includes(value, query)));
}

export function where(root, query) {
  const state = loadState(root);
  const capabilities = findMap(root, query);
  const knowledge = readKnowledgeFiles(root)
    .filter((item) => includes(item.text, query))
    .map((item) => item.path);
  const documents = Object.entries(state.manifest.documents || {})
    .filter(([id, item]) => includes(id, query) || includes(item.path, query))
    .map(([id, item]) => ({ id, path: item.path }));
  return { capabilities, knowledge, documents };
}

export function who(root, path) {
  const state = loadState(root);
  return matchingNavigators(state, path);
}

export function why(root, target) {
  const state = loadState(root);
  if (state.manifest.knowledge[target]) {
    const record = state.manifest.knowledge[target];
    return { id: target, record, text: exists(repoPath(root, record.source)) ? readFileSync(repoPath(root, record.source), "utf8") : null };
  }
  const applicable = Object.entries(state.manifest.knowledge || {})
    .filter(([, record]) => (record.paths || []).some((pattern) => pathMatches(pattern, target.split(":")[0])))
    .map(([id, record]) => ({ id, source: record.source, status: record.status }));
  return { target, navigators: matchingNavigators(state, target.split(":")[0]), knowledge: applicable };
}

export function impact(root, proposal) {
  const state = loadState(root);
  const ranked = rankCapabilityMatches(state, proposal);
  const topScore = ranked[0]?.score || 0;
  const selected = ranked.filter((item, index) => index === 0 || (
    item.score >= topScore * 0.3
    && item.direct_matched_terms.length > 0
    && item.matched_terms.length >= 2
  )).slice(0, 3);
  // Keep the score on capability records for callers of the existing impact
  // JSON contract. `matches` adds the explainable evidence without removing
  // that field.
  const capabilities = selected.map((item) => ({
    ...item.capability,
    score: Number(item.score.toFixed(3))
  }));
  const navigators = [...new Set(capabilities.flatMap((capability) => matchingNavigators(state, capability.primary_paths[0].replace(/\/\*\*$/, ""))))];
  return {
    proposal,
    capabilities,
    navigators,
    matches: selected.map((item) => ({
      capability: item.capability.id,
      score: Number(item.score.toFixed(3)),
      matched_terms: item.matched_terms,
      matched_paths: item.matched_paths
    })),
    note: "This result uses ranked lexical evidence. A Navigator must verify semantic impact."
  };
}

export function knowledge(root, action, argument = "") {
  const state = loadState(root);
  if (action === "show") return why(root, argument);
  if (action === "search") {
    return readKnowledgeFiles(root)
      .filter((item) => includes(item.text, argument))
      .map((item) => ({ path: item.path, ids: [...item.text.matchAll(/\bK-\d{4,}\b/g)].map((match) => match[0]) }));
  }
  return Object.entries(state.manifest.knowledge || {}).map(([id, record]) => ({ id, ...record }));
}
