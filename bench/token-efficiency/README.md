# Token-efficiency benchmark

This benchmark measures what Charthouse costs and saves in a coding-agent
session. It runs the same tasks in two Claude Code environments on two
identical clones of one repository:

- **plain**: no Charthouse state, no Charthouse skills, and no hooks.
- **Charthouse**: a published Charthouse Map, the Charthouse skills, and the
  Charthouse lifecycle hooks.

The benchmark reports the cost, the token count, the number of turns, and the
task success rate for each environment. It also reports the cost of the first
Expedition and the number of task-suite runs that repay it.

## What makes the comparison fair

- Each environment has its own `CLAUDE_CONFIG_DIR`. Your plugins, skills,
  memory, global `CLAUDE.md`, and MCP servers stay out of both, because they
  add context and hooks that differ from one person to another. Claude Code's
  own instructions and tools take about 21,500 context tokens in each
  session; this floor is the same in both environments.
- Both clones start from the same commit. The Charthouse clone adds only the
  published Charthouse state on top of it.
- Every trial resets its clone and starts a new session with no saved
  history.
- The same model, maximum turn count, and permission mode apply to both
  environments.
- Each round shuffles the task order and the environment order, so that
  neither environment always runs first against a warm prompt cache.
- The cost comes from `modelUsage`, which includes subagents. Charthouse
  delegates to Navigator agents, so the main-model count alone would be low.
- Each task has a deterministic check. A cheaper run that fails the task is
  not a saving.

## Run it

The benchmark spends real tokens. Four example tasks, two environments, and
three rounds make 24 sessions and one Expedition. `--budget` caps each
session. `--total-budget` stops the run before a session that could take the
setup cost plus all trials past the cap.

1. Prepare two clones and two environments. Use a path outside this checkout
   for `--work`:

   ```bash
   node bench/token-efficiency/run.mjs prepare \
     --work ~/charthouse-bench --repo /path/to/repository --ref <commit>
   ```

2. Log in once in each environment, because each has its own configuration:

   ```bash
   CLAUDE_CONFIG_DIR=~/charthouse-bench/config/base claude        # then /login
   CLAUDE_CONFIG_DIR=~/charthouse-bench/config/charthouse claude  # then /login
   node bench/token-efficiency/run.mjs check-auth --work ~/charthouse-bench
   ```

   With `ANTHROPIC_API_KEY` set, the login step is not necessary.

3. Run the first Expedition in the Charthouse clone. The automatic setup
   approves every proposed boundary as proposed:

   ```bash
   node bench/token-efficiency/run.mjs setup --work ~/charthouse-bench --model sonnet
   ```

   For a realistic Map, run the Expedition yourself and review the gate:

   ```bash
   node bench/token-efficiency/run.mjs setup --work ~/charthouse-bench --manual
   ```

4. Run the tasks, then read the report:

   ```bash
   node bench/token-efficiency/run.mjs run --work ~/charthouse-bench \
     --tasks bench/token-efficiency/tasks.example.json --runs 3 --model sonnet \
     --budget 2 --total-budget 15
   node bench/token-efficiency/run.mjs report --work ~/charthouse-bench
   ```

`results.jsonl` in the work directory keeps every trial: its metrics, check
result, and the first part of its answer. `report.md` holds the summary.

The example tasks in `tasks.example.json` target this repository at `v0.3.0`.
To try the benchmark before you write tasks for your own repository, use
`--repo <this checkout> --ref v0.3.0`. This repository is small, so treat the
result as a test of the harness, not as a measure of Charthouse.

## Write tasks

A task file is a JSON array. Each task has an `id`, a `prompt`, and a `check`:

- `answer_includes`: text that the final answer must contain, without regard
  to case.
- `changed_paths`: files that the session must change.
- `command`: a shell command that must exit with status 0 in the clone after
  the session, such as a test command.

Use tasks from the real work of the repository: orientation, change impact,
small fixes with tests, and reviews. Ask for short, checkable answers.
Charthouse is designed for repositories where orientation is expensive, so a
large repository shows more than a small one.

## Read the results

- Compare cost where both environments succeed at a similar rate.
- Look at the spread between rounds before you trust a small difference.
  Three rounds per task detect large effects only.
- Charthouse adds fixed context in each session: its skill text and the
  session-start Bearing line. Short tasks can cost more with Charthouse.
  Orientation and impact tasks in a large repository are where it can save.
- The first Expedition is a one-time cost. The break-even line shows how many
  runs of the whole task suite repay it.
- Hooks also take wall time without tokens. The report shows turns and cost;
  `results.jsonl` also holds the wall time.
- Turns count only the main agent. A session that delegates the task to a
  subagent can show one turn. Its cost and tokens still include the subagent.
- Ask questions that have one right answer. A question whose answer spans two
  files lets a correct but partial answer fail its check.
