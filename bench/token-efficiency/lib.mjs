// Pure helpers for the token-efficiency benchmark. They read the JSON that
// `claude -p --output-format json` prints and summarize repeated runs.

// `modelUsage` has one entry per model, including the models that subagents
// used, so it is the complete count. `usage` covers only the main model.
export function runMetrics(result) {
  const models = Object.values(result?.modelUsage || {});
  const sum = (field) => models.reduce((total, model) => total + (Number(model[field]) || 0), 0);
  const fallback = result?.usage || {};
  const input = models.length ? sum("inputTokens") : Number(fallback.input_tokens) || 0;
  const cacheCreation = models.length ? sum("cacheCreationInputTokens") : Number(fallback.cache_creation_input_tokens) || 0;
  const cacheRead = models.length ? sum("cacheReadInputTokens") : Number(fallback.cache_read_input_tokens) || 0;
  const output = models.length ? sum("outputTokens") : Number(fallback.output_tokens) || 0;
  return {
    cost_usd: typeof result?.total_cost_usd === "number" ? result.total_cost_usd : sum("costUSD"),
    tokens: input + cacheCreation + cacheRead + output,
    fresh_input_tokens: input + cacheCreation,
    cache_read_tokens: cacheRead,
    output_tokens: output,
    turns: result?.num_turns ?? null,
    duration_ms: result?.duration_ms ?? null,
    subagents: result?.subagent_stats?.spawned ?? 0,
    failed: result?.is_error === true || result?.subtype !== "success",
    models: Object.keys(result?.modelUsage || {})
  };
}

export function median(values) {
  const sorted = values.filter((value) => typeof value === "number" && Number.isFinite(value)).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const MEASURES = ["cost_usd", "tokens", "fresh_input_tokens", "cache_read_tokens", "output_tokens", "turns", "duration_ms", "subagents"];

function change(base, other) {
  return base && other !== null && base !== null ? (other - base) / base : null;
}

// records: [{ task, condition: "base" | "charthouse", success, metrics }]
export function summarize(records, { setupCostUsd = null } = {}) {
  const tasks = [...new Set(records.map((record) => record.task))];
  const rows = tasks.map((task) => {
    const conditions = Object.fromEntries(["base", "charthouse"].map((condition) => {
      const runs = records.filter((record) => record.task === task && record.condition === condition);
      const medians = Object.fromEntries(MEASURES.map((measure) => [measure, median(runs.map((run) => run.metrics?.[measure]))]));
      return [condition, { runs: runs.length, success_rate: runs.length ? runs.filter((run) => run.success).length / runs.length : null, ...medians }];
    }));
    return {
      task,
      ...conditions,
      cost_change: change(conditions.base.cost_usd, conditions.charthouse.cost_usd),
      token_change: change(conditions.base.tokens, conditions.charthouse.tokens)
    };
  });
  const total = (condition, measure) => rows.reduce((sum, row) => sum + (row[condition][measure] || 0), 0);
  const baseCost = total("base", "cost_usd");
  const charthouseCost = total("charthouse", "cost_usd");
  const savingPerSuite = baseCost - charthouseCost;
  return {
    tasks: rows,
    suite: {
      base_cost_usd: baseCost,
      charthouse_cost_usd: charthouseCost,
      base_tokens: total("base", "tokens"),
      charthouse_tokens: total("charthouse", "tokens"),
      cost_change: change(baseCost, charthouseCost),
      setup_cost_usd: setupCostUsd,
      // How many runs of the whole task suite repay the first Expedition.
      break_even_suites: setupCostUsd !== null && savingPerSuite > 0 ? setupCostUsd / savingPerSuite : null
    }
  };
}

const percent = (value) => value === null ? "n/a" : `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
const dollars = (value) => value === null ? "n/a" : `$${value.toFixed(4)}`;
const count = (value) => value === null ? "n/a" : Math.round(value).toLocaleString("en-US");
const rate = (value) => value === null ? "n/a" : `${Math.round(value * 100)}%`;

export function renderReport(summary) {
  const lines = [
    "# Token efficiency: Charthouse against a plain session",
    "",
    "Medians per task. Change is Charthouse relative to the plain session; negative is cheaper.",
    "",
    "| Task | Runs | Success (plain / Charthouse) | Cost (plain / Charthouse) | Cost change | Tokens (plain / Charthouse) | Token change | Turns (plain / Charthouse) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |"
  ];
  for (const row of summary.tasks) {
    lines.push(`| ${row.task} | ${row.base.runs} / ${row.charthouse.runs} | ${rate(row.base.success_rate)} / ${rate(row.charthouse.success_rate)} | ${dollars(row.base.cost_usd)} / ${dollars(row.charthouse.cost_usd)} | ${percent(row.cost_change)} | ${count(row.base.tokens)} / ${count(row.charthouse.tokens)} | ${percent(row.token_change)} | ${count(row.base.turns)} / ${count(row.charthouse.turns)} |`);
  }
  const suite = summary.suite;
  lines.push(
    "",
    `Whole suite: ${dollars(suite.base_cost_usd)} plain, ${dollars(suite.charthouse_cost_usd)} with Charthouse (${percent(suite.cost_change)}).`,
    `First Expedition: ${dollars(suite.setup_cost_usd)}. Break-even: ${suite.break_even_suites === null ? "not reached" : `${suite.break_even_suites.toFixed(1)} suite runs`}.`,
    "",
    "Compare cost only where both conditions succeed at a similar rate. A cheaper run that fails the task is not a saving."
  );
  return `${lines.join("\n")}\n`;
}
