import { isDocumentPath } from "./policy.mjs";
import { pathMatches } from "./query.mjs";

// Navigator coverage asks whether the approved boundaries give each maintained
// file exactly one responsible Navigator, and whether each boundary says enough
// to be useful. Documents, fixtures, and generated files have their own review.

const MAINTAINED_ROLES = new Set(["source", "test"]);
// The deterministic draft purpose. An approved boundary that still carries it
// tells a Navigator nothing about the capability.
const PLACEHOLDER_PURPOSE = /^Maintain the code in /;
const MINIMUM_PURPOSE_LENGTH = 20;
const MINIMUM_CONFIDENCE = 0.5;

function claims(capability, path) {
  return (capability.primary_paths || []).some((pattern) => pathMatches(pattern, path));
}

// The first two path segments name the area, such as `scripts/` or `tools/lint/`.
function area(path) {
  const segments = path.split("/");
  return segments.length === 1 ? path : `${segments.slice(0, Math.min(2, segments.length - 1)).join("/")}/`;
}

// Returns null before the first publication, when no boundary is approved.
export function navigatorCoverage(map) {
  const capabilities = map.capabilities || [];
  const approved = capabilities.filter((capability) => capability.approved === true);
  if (!approved.length) return null;
  const files = map.files || [];
  // A stub or omitted unit never gets a capability, so its manifest is not a gap.
  // A file outside every unit still needs a Navigator.
  const scanned = new Set((map.units || []).filter((unit) => unit.scope === "included").map((unit) => unit.id));
  const maintained = files
    .filter((file) => MAINTAINED_ROLES.has(file.role) && !isDocumentPath(file.path) && (!file.owner || scanned.has(file.owner)))
    .map((file) => file.path);

  const uncovered = [];
  const overlaps = new Map();
  for (const path of maintained) {
    const owners = approved.filter((capability) => claims(capability, path)).map((capability) => capability.id).sort();
    if (!owners.length) uncovered.push(path);
    for (let left = 0; left < owners.length; left += 1) {
      for (let right = left + 1; right < owners.length; right += 1) {
        const key = `${owners[left]}\0${owners[right]}`;
        const entry = overlaps.get(key) || { capabilities: [owners[left], owners[right]], files: 0, example: path };
        entry.files += 1;
        overlaps.set(key, entry);
      }
    }
  }
  const areas = new Map();
  for (const path of uncovered) areas.set(area(path), (areas.get(area(path)) || 0) + 1);

  const quality = approved.map((capability) => {
    const purpose = String(capability.purpose || "").trim();
    const evidence = capability.evidence || [];
    const missing = evidence.filter((path) => !files.some((file) => pathMatches(path, file.path)) && !(map.documents || []).some((document) => document.path === path));
    return {
      id: capability.id,
      broad: PLACEHOLDER_PURPOSE.test(purpose) || purpose.length < MINIMUM_PURPOSE_LENGTH,
      weak: !evidence.length || typeof capability.confidence !== "number" || capability.confidence < MINIMUM_CONFIDENCE,
      missing_evidence: missing
    };
  });

  return {
    maintained: maintained.length,
    uncovered,
    uncovered_areas: [...areas.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([path, count]) => ({ path, files: count })),
    overlaps: [...overlaps.values()].sort((left, right) => right.files - left.files),
    broad: quality.filter((item) => item.broad).map((item) => item.id),
    weak: quality.filter((item) => item.weak || item.missing_evidence.length).map((item) => ({ id: item.id, missing_evidence: item.missing_evidence })),
    unapproved: capabilities.filter((capability) => capability.approved !== true).map((capability) => capability.id)
  };
}

// Unapproved boundaries have their own suggestion, so the summary leaves them out.
export function summarizeCoverage(coverage) {
  if (!coverage) return null;
  const parts = [];
  if (coverage.uncovered.length) parts.push(`${coverage.uncovered.length} maintained file${coverage.uncovered.length === 1 ? " has" : "s have"} no Navigator`);
  if (coverage.overlaps.length) parts.push(`${coverage.overlaps.length} overlap${coverage.overlaps.length === 1 ? "" : "s"}`);
  if (coverage.broad.length) parts.push(`${coverage.broad.length} broad purpose${coverage.broad.length === 1 ? "" : "s"}`);
  if (coverage.weak.length) parts.push(`${coverage.weak.length} weak evidence record${coverage.weak.length === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : null;
}
