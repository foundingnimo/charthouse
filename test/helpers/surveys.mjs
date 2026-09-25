import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Build the four survey reports that the deterministic Map supports, the way the
// isolated mapper agents would, from the Map that `charthouse init` wrote.
export function surveyReports(sandbox) {
  const map = JSON.parse(readFileSync(join(sandbox, ".charthouse/map.json"), "utf8"));
  const fingerprints = JSON.parse(readFileSync(join(sandbox, ".charthouse/fingerprints.json"), "utf8"));
  const common = (role, summary) => ({
    schema_version: 1,
    role,
    baseline: {
      commit: map.baseline.commit,
      config_digest: fingerprints.config_digest,
      map_generated_at: map.generated_at
    },
    summary,
    findings: [],
    unresolved: [],
    tool_gaps: []
  });
  const contracts = map.instruction_contracts || [];
  return {
    structure: {
      ...common("structure", "The deterministic units have verified structure."),
      units: map.units.map((unit) => ({ id: unit.id, name: unit.name, root: unit.root, purpose: `Own ${unit.name}.`, evidence: [unit.manifest || unit.root], confidence: 0.9 })),
      dependencies: map.dependencies.map((edge) => ({ ...edge, confidence: 0.9 })),
      entrypoints: [],
      tests: []
    },
    capability: {
      ...common("capability", "Each deterministic unit has one draft capability."),
      capabilities: map.units.map((unit) => ({
        id: `cap-${unit.id.replace(/^unit-/, "")}`,
        name: `${unit.name} capability`,
        purpose: `Own ${unit.name}.`,
        units: [unit.id],
        primary_paths: [unit.root === "." ? "**" : `${unit.root}/**`],
        secondary_paths: [],
        evidence: [unit.manifest || unit.root],
        confidence: 0.8
      }))
    },
    documentation: {
      ...common("documentation", "Documents and Instruction Contracts are classified."),
      documents: map.documents
        .filter((document) => !contracts.some((contract) => contract.path === document.path))
        .map((document, index) => ({ id: `document-${index + 1}`, path: document.path, classification: "current", criticality: "informational", claims: [], watches: [], evidence: [document.path], confidence: 0.8 })),
      instruction_contracts: contracts.map((contract) => ({ id: contract.id, path: contract.path, providers: contract.providers, scope: contract.scope, parent: contract.parent, precedence: contract.precedence, evidence: [contract.path], confidence: 1 }))
    },
    duplication: {
      ...common("duplication", "Deterministic duplicate groups are reviewed."),
      duplicate_groups: (map.duplicate_groups || []).map((group) => ({ kind: "exact-duplicate", paths: group.paths, evidence: group.paths, confidence: 1 }))
    }
  };
}

// Store each report at its assigned path and accept it into the open Expedition.
// `run` spawns the Charthouse CLI inside the sandbox.
export function acceptAllSurveys(sandbox, run) {
  const status = run("expedition", "status", "--root", sandbox, "--json");
  assert.equal(status.status, 0, status.stderr);
  const expedition = JSON.parse(status.stdout);
  for (const [role, report] of Object.entries(surveyReports(sandbox))) {
    const file = expedition.surveys[role].report_path;
    writeFileSync(join(sandbox, file), `${JSON.stringify(report, null, 2)}\n`);
    const accepted = run("expedition", "accept-report", expedition.id, "--role", role, "--file", file, "--root", sandbox, "--json");
    assert.equal(accepted.status, 0, `${role}: ${accepted.stdout}\n${accepted.stderr}`);
  }
  return expedition;
}

// Run the Map gate the way a caller does after the surveys: start synthesis, let
// `editDraft` stand in for the synthesizer, stage the draft, and approve every
// boundary. Canonical state stays unchanged until `navigator regenerate`.
export function approveExpeditionMap(sandbox, run, editDraft = null) {
  const expedition = acceptAllSurveys(sandbox, run);
  const started = run("expedition", "synthesize", expedition.id, "--root", sandbox, "--json");
  assert.equal(started.status, 0, started.stderr);
  if (editDraft) {
    const draftPath = join(sandbox, JSON.parse(started.stdout).draft_path);
    const draft = JSON.parse(readFileSync(draftPath, "utf8"));
    editDraft(draft);
    writeFileSync(draftPath, `${JSON.stringify(draft, null, 2)}\n`);
  }
  const staged = run("expedition", "stage", expedition.id, "--root", sandbox, "--json");
  assert.equal(staged.status, 0, staged.stderr);
  const approved = run("expedition", "approve", expedition.id, "--all", "--root", sandbox, "--json");
  assert.equal(approved.status, 0, approved.stderr);
  return expedition;
}
