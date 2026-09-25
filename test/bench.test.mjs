import assert from "node:assert/strict";
import { test } from "node:test";
import { median, renderReport, runMetrics, summarize } from "../bench/token-efficiency/lib.mjs";

// The shape that `claude -p --output-format json` prints, with a subagent model.
function result({ cost, main, subagent = null, turns = 3, error = false }) {
  const modelUsage = { "claude-sonnet-5": main };
  if (subagent) modelUsage["claude-haiku-4-5"] = subagent;
  return {
    type: "result",
    subtype: error ? "error_max_turns" : "success",
    is_error: error,
    total_cost_usd: cost,
    num_turns: turns,
    duration_ms: 1000,
    usage: { input_tokens: main.inputTokens, cache_creation_input_tokens: main.cacheCreationInputTokens, cache_read_input_tokens: main.cacheReadInputTokens, output_tokens: main.outputTokens },
    modelUsage,
    subagent_stats: { spawned: subagent ? 1 : 0 }
  };
}

const usage = (input, creation, read, output, cost) => ({ inputTokens: input, cacheCreationInputTokens: creation, cacheReadInputTokens: read, outputTokens: output, costUSD: cost });

test("run metrics count every model, including subagents", () => {
  const metrics = runMetrics(result({ cost: 0.3, main: usage(10, 1000, 5000, 200, 0.2), subagent: usage(5, 500, 2000, 100, 0.1) }));
  assert.equal(metrics.cost_usd, 0.3);
  assert.equal(metrics.tokens, 10 + 1000 + 5000 + 200 + 5 + 500 + 2000 + 100);
  assert.equal(metrics.fresh_input_tokens, 1515);
  assert.equal(metrics.cache_read_tokens, 7000);
  assert.equal(metrics.subagents, 1);
  assert.equal(metrics.failed, false);
  assert.equal(runMetrics(result({ cost: 0.1, main: usage(1, 1, 1, 1, 0.1), error: true })).failed, true);
});

test("median handles odd and even counts and ignores missing values", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([null, 5, undefined]), 5);
  assert.equal(median([]), null);
});

test("the summary compares medians and computes the break-even point", () => {
  const record = (task, condition, cost, success = true) => ({ task, condition, success, metrics: runMetrics(result({ cost, main: usage(0, 0, 0, Math.round(cost * 1000), cost) })) });
  const records = [
    record("orient", "base", 0.4), record("orient", "base", 0.6), record("orient", "base", 0.5),
    record("orient", "charthouse", 0.2), record("orient", "charthouse", 0.3), record("orient", "charthouse", 0.25, false),
    record("change", "base", 1.0), record("change", "charthouse", 1.2)
  ];
  const summary = summarize(records, { setupCostUsd: 2.5 });
  const orient = summary.tasks.find((row) => row.task === "orient");
  assert.equal(orient.base.cost_usd, 0.5);
  assert.equal(orient.charthouse.cost_usd, 0.25);
  assert.equal(orient.cost_change, -0.5);
  assert.equal(orient.charthouse.success_rate, 2 / 3);
  assert.equal(summary.suite.base_cost_usd, 1.5);
  assert.equal(summary.suite.charthouse_cost_usd, 1.45);
  assert.ok(Math.abs(summary.suite.break_even_suites - 50) < 1e-9);
  const text = renderReport(summary);
  assert.match(text, /\| orient \| 3 \/ 3 \| 100% \/ 67% \| \$0\.5000 \/ \$0\.2500 \| -50\.0% \|/);
  assert.match(text, /Break-even: 50\.0 suite runs/);
  assert.equal(summarize([record("x", "base", 1), record("x", "charthouse", 2)], { setupCostUsd: 1 }).suite.break_even_suites, null);
});
