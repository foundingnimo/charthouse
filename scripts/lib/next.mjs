import { checkRepository } from "./check.mjs";

const SEVERITY_ORDER = { major: 0, minor: 1, information: 2 };

function bySeverity(a, b) {
  return (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3);
}

function quote(value) {
  return `"${String(value).replace(/"/g, "'")}"`;
}

// `charthouse next` answers two questions from state the tool already holds: what
// did Charthouse find, and what should a person do about it first. Every suggestion
// names the command that starts the work. It reads and never writes.
export function nextSteps(root) {
  const report = checkRepository(root);
  const { state } = report;
  const documents = Object.entries(state.manifest.documents || {}).map(([id, document]) => ({ id, ...document }));
  const stale = documents.filter((document) => document.status === "stale" || document.status === "suspect");
  const suspectDocuments = [...new Map(report.findings
    .filter((item) => item.code === "document-suspect")
    .map((item) => [item.path, documents.find((document) => document.path === item.path)])
  ).values()].filter(Boolean);
  const suspectKnowledge = report.findings.filter((item) => item.code === "knowledge-suspect");
  const preliminary = state.map.capabilities.filter((item) => item.approved !== true);
  const knowledge = Object.values(state.manifest.knowledge || {});
  const anomalies = [...(state.map.anomalies || [])].sort(bySeverity);
  const unresolved = state.map.unresolved || [];
  const structural = anomalies.filter((item) => /duplicate|misplaced|drift|dead-code|copy/.test(item.kind || ""));
  const toolGapCandidates = state.tool_gaps.gaps.filter((gap) => gap.status === "candidate");

  const suggestions = [];
  const suggest = (priority, action, command, reason) => suggestions.push({ priority, action, command, reason });

  if (report.charter.state === "missing" || report.charter.state === "template") {
    suggest("now", "Write the Charter.", "charthouse charter create", "Charthouse cannot compare intent with the Map until the Charter replaces the template prompts.");
  } else if (report.charter.state === "partial") {
    suggest("now", `Finish the Charter sections: ${report.charter.template_sections.join(", ")}.`, "charthouse charter update \"<change>\"", "A partial Charter is compared section by section.");
  }
  if (preliminary.length) {
    suggest("now", `Review ${preliminary.length} preliminary capability boundar${preliminary.length === 1 ? "y" : "ies"} at the Map gate.`, "charthouse map show", "Navigators and rules are only as good as the boundaries they come from.");
  }
  for (const item of report.findings.filter((finding) => finding.level === "error" && finding.code !== "charter-missing" && finding.code !== "document-suspect")) {
    suggest("now", item.message, item.code.startsWith("document-") ? `charthouse run ${quote(`Update ${item.path}`)}` : "charthouse check", "An error keeps the Bearing check red.");
  }
  if (suspectDocuments.length) {
    const binding = suspectDocuments.some((document) => document.criticality === "binding");
    suggest(binding ? "now" : "soon", `Review ${suspectDocuments.length} suspect document${suspectDocuments.length === 1 ? "" : "s"}: ${suspectDocuments.map((document) => document.path).join(", ")}.`, "charthouse docs review", "Changed evidence does not make a document wrong. A review decides, and confirms the document when it still holds.");
  }
  const staleBinding = stale.filter((document) => document.criticality === "binding");
  const staleOther = stale.filter((document) => document.criticality !== "binding");
  if (staleOther.length) {
    suggest("soon", `Delete or correct ${staleOther.length} stale or suspect non-binding document${staleOther.length === 1 ? "" : "s"}: ${staleOther.map((document) => document.path).join(", ")}.`, `charthouse run ${quote("Delete or correct stale documents")}`, "Code wins. Delete a document that only restates code. Correct a document that holds a decision.");
  }
  if (suspectKnowledge.length) {
    suggest("soon", `Verify ${suspectKnowledge.length} knowledge record${suspectKnowledge.length === 1 ? "" : "s"} whose evidence changed.`, "charthouse check", "Suspect means the evidence moved, not that the record is wrong.");
  }
  for (const item of anomalies.filter((anomaly) => anomaly.severity === "major" && !staleBinding.some((document) => (anomaly.paths || []).includes(document.path)))) {
    suggest("soon", item.detail, `charthouse run ${quote(item.id || item.kind)}`, `Major finding${item.id ? ` ${item.id}` : ""} from the Map.`);
  }
  if (structural.length) {
    suggest("later", `Propose a Refit for ${structural.length} structural finding${structural.length === 1 ? "" : "s"} (${[...new Set(structural.map((item) => item.kind))].join(", ")}).`, "charthouse refit propose", "A Refit is a proposal and moves no code.");
  }
  if (unresolved.length) {
    suggest("later", `Decide ${unresolved.length} unresolved ownership item${unresolved.length === 1 ? "" : "s"}.`, "charthouse map show", "Unresolved scope has no Navigator.");
  }
  if (toolGapCandidates.length) {
    suggest("later", `Review ${toolGapCandidates.length} recurring Tool Gap candidate${toolGapCandidates.length === 1 ? "" : "s"}.`, "charthouse tool gap list --status candidate", "Repeated fallbacks show where a registered Toolbox operation can save work.");
  }
  if (knowledge.length === 0) {
    suggest("later", "Run the first Voyage so the context curator can propose knowledge records.", `charthouse run ${quote("<objective>")}`, "`why` and `who` answer from knowledge records, and there are none yet.");
  }
  if (!suggestions.length) suggest("later", "Nothing is waiting. Start the next objective.", `charthouse run ${quote("<objective>")}`, "The Bearing is current and the Charter is complete.");

  return {
    bearing: { ok: report.ok, current: report.current, errors: report.errors, warnings: report.warnings, information: report.information },
    charter: report.charter.state,
    findings: {
      bearing: report.findings,
      anomalies: anomalies.map((item) => ({ id: item.id || null, kind: item.kind, severity: item.severity, detail: item.detail, paths: item.paths || [] })),
      unresolved: unresolved.map((item) => ({ id: item.id || null, kind: item.kind, detail: item.detail || null, paths: item.paths || [] })),
      preliminary_capabilities: preliminary.map((item) => item.id),
      stale_documents: stale.map((document) => ({ path: document.path, status: document.status, criticality: document.criticality })),
      tool_gap_candidates: toolGapCandidates.map((gap) => ({ id: gap.id, key: gap.key, need: gap.need, occurrences: gap.occurrences, voyages: gap.voyages.length })),
      knowledge: { total: knowledge.length, suspect: knowledge.filter((item) => item.status === "suspect").length }
    },
    suggestions
  };
}

export function renderNext(result) {
  const lines = [];
  const bearing = result.bearing.ok ? (result.bearing.current ? "PASS" : "REVIEW") : "FAIL";
  lines.push(`Bearing: ${bearing} (${result.bearing.errors} error(s), ${result.bearing.warnings} warning(s)). Charter: ${result.charter}.`, "");
  lines.push("Findings", "");
  const { anomalies, unresolved, preliminary_capabilities: preliminary, stale_documents: stale, tool_gap_candidates: toolGaps } = result.findings;
  if (!anomalies.length && !unresolved.length && !preliminary.length && !stale.length && !toolGaps.length) lines.push("- None recorded.");
  for (const item of anomalies) lines.push(`- [${item.severity}] ${item.id ? `${item.id}: ` : ""}${item.detail}${item.paths.length ? ` (${item.paths.slice(0, 3).join(", ")}${item.paths.length > 3 ? ", …" : ""})` : ""}`);
  for (const item of unresolved) lines.push(`- [unresolved] ${item.id ? `${item.id}: ` : ""}${item.detail || item.kind}${item.paths.length ? ` (${item.paths.slice(0, 3).join(", ")})` : ""}`);
  for (const document of stale) lines.push(`- [${document.status}, ${document.criticality}] ${document.path}`);
  for (const gap of toolGaps) lines.push(`- [tool candidate] ${gap.id}: ${gap.need} (${gap.occurrences} occurrence(s), ${gap.voyages} Voyage(s))`);
  if (preliminary.length) lines.push(`- [preliminary] ${preliminary.length} capability boundar${preliminary.length === 1 ? "y" : "ies"} without human approval: ${preliminary.join(", ")}`);
  lines.push("", "Suggested next steps", "");
  result.suggestions.forEach((item, index) => {
    lines.push(`${index + 1}. [${item.priority}] ${item.action}`, `   ${item.command}`, `   ${item.reason}`);
  });
  return `${lines.join("\n")}\n`;
}
