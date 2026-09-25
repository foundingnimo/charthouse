# Charthouse

Charthouse is an ambient repository-context sidecar for coding agents. It maps a
software repository, publishes capability specialists, detects stale context,
and gives each implementation session a compact brief. A person can query
Charthouse, but does not need to operate it as a separate workflow.

Charthouse is designed for monorepos whose code, documentation, and ownership
boundaries do not always match their directory structure. Its canonical state
is agent-neutral. Claude Code has the richest adapter today; Codex, Grok, and
other agents that discover `SKILL.md` files can use the same Map and
Navigators.

Charthouse keeps eight kinds of durable repository context:

- A **Charter** records intended boundaries and human decisions.
- A **Map** records observed repository structure and relationships.
- **Expedition records** checkpoint the first repository survey, so that an
  interrupted session can resume it.
- **Instruction Contracts** record scoped, human-owned rules for coding agents.
- **Navigators** provide aspect-specific agent views.
- The **Logbook** provides short, path-scoped knowledge to coding agents.
- **Voyage records** preserve work lifecycle, approved scope, and active path
  ownership between sessions.
- The **Tool Gap Log** records recurring operations that could become reusable
  Toolbox tools.

Charthouse writes human-readable notes in ASD-STE100 Simplified Technical
English. Project identifiers and declared technical nouns are permitted.

## Status

Charthouse provides:

- Repository initialization and inventory scan
- Charter creation and validation
- Map display and search
- Knowledge display, search, and structural validation
- Pointer and fingerprint Bearing checks
- Command help and stable aliases
- A registered read-only Node.js Toolbox for recurring repository analysis
- Role-specific validation of isolated Expedition survey reports before
  synthesis
- Durable Expedition transaction IDs, accepted-report checkpoints, and
  interruption-safe resume
- A publication gate: Navigators stay drafts until every capability boundary
  is human-approved and each survey checkpoint is valid
- A project-local Tool Gap Log for recurring operations missing from the Toolbox
- Document review: Charthouse re-checks a document whose evidence changed
- Atomic writer locking with owner details and safe stale-lock recovery
- Durable Voyage IDs, lifecycle commands, and overlapping-path refusal
- Canonical Git reference checks for reviews and trusted-state changes
- Separate Map-publication and Bearing-health status
- Scoped monitoring for agent Instruction Contracts, with size and duplicate
  warnings
- Ambient reconciliation and ranked, bounded task briefs
- A mandatory pre-response gate that stops ambiguous tasks at one concise
  decision question
- Portable repository skills plus Claude Code agents, hooks, and path rules

Semantic capability mapping, context curation, and Refit proposals are
performed by the host coding agent through `charthouse-context`. The separate
`charthouse` skill handles explicit administration commands.

## Quickstart: sidecar mode

Sidecar mode is the recommended way to use Charthouse. Install it once for the
current user, then work with your coding agent normally. Charthouse runs at agent
session and task boundaries; it is not a daemon and no Charthouse terminal needs to
stay open. The `charthouse-context` skill handles automatic repository context, and
the separate `charthouse` skill provides optional administration commands.

Prerequisites: Git, Node.js 22 or newer, and at least one coding agent that
supports Claude skills or shared `SKILL.md` files.

1. Clone Charthouse and install both the Claude and shared-agent adapters:

   ```bash
   git clone https://github.com/foundingnimo/charthouse.git
   cd charthouse
   ./install.sh --host all
   ```

   On PowerShell:

   ```powershell
   git clone https://github.com/foundingnimo/charthouse.git
   cd charthouse
   ./install.ps1 -TargetHost all
   ```

   `--host all` is the safest choice when you use more than one coding agent.
   It installs the provider-neutral runtime in `~/.charthouse`, Claude skills and
   lifecycle hooks in `~/.claude`, and shared skills for Codex, Grok, and other
   compatible hosts in `~/.agents/skills`. It preserves unrelated agent
   settings and files.

2. Confirm the installed version, then restart every open coding-agent
   session so it loads the new skills:

   ```bash
   ~/.charthouse/bin/charthouse --version
   ```

   Charthouse does not add itself to `PATH`; installed skills call this runtime
   directly. On PowerShell, use:

   ```powershell
   node "$HOME\.charthouse\bin\charthouse" --version
   ```

3. Open the target repository in a **new** agent session and give the agent a
   normal repository request. You do not need to run `/charthouse init` first.

   ```text
   Add account recovery. Check the repository architecture and existing rationale first.
   ```

   On the first substantial task, `charthouse-context` notices that the repository
   has no Charthouse state and starts the first Expedition. If you prefer to start
   it explicitly in Claude Code, run `/charthouse init`.

4. Select the exact branch that represents accepted repository history when
   Charthouse asks for the canonical branch, for example `origin/main` or `main`.
   Charthouse lists locally available local and remote-tracking branches, but it
   does not infer the answer and never fetches, switches, merges, or rebases.
   Update the repository's Git refs yourself first if the branch you need is
   not available locally.

5. Review the proposed capability boundaries and approve or correct them.
   Initialization inventories the safe repository perimeter, maps supported
   agent instruction files as human-owned Instruction Contracts, and drafts
   one Navigator per approved capability. On a large monorepo this first
   Expedition can take significant time and tokens. It does not edit product
   code. Charthouse checkpoints each accepted survey report. If the session stops,
   a new session uses `charthouse expedition resume` and repeats only reports whose
   files or baseline no longer validate.

6. After publication, review the generated repository state before committing
   it. Charthouse normally creates `.charthouse/`, `docs/charthouse/`, and `.agents/skills/`;
   the Claude adapter also creates `.claude/agents/` and
   `.claude/rules/charthouse/`. Commit these shared views when other worktrees,
   clones, or teammates should receive the same Map and Navigators. Restart
   agent sessions once more so hosts that cache skills discover the generated
   Navigators.

That is the complete sidecar setup. From then on, use the coding agent as
usual. Charthouse quietly reconciles changed evidence, builds ranked and bounded
task briefs, and loads only the relevant Navigator views. It speaks up when it
finds a conflict, stale document, preliminary boundary, or decision that needs
approval. Routine refresh output stays out of the conversation.

Useful questions include:

```text
What Navigators did Charthouse add?
What parts of the repository are affected by this ticket?
What would be a better structure for this code?
```

The explicit `/charthouse help`, `/charthouse status`, `/charthouse doctor`, `/charthouse brief
"<objective>"`, and `/charthouse reconcile` commands are for inspection,
diagnostics, and automation. They are not required for ordinary sidecar use.
If a request explicitly forbids every repository write, the sidecar uses
`/charthouse reconcile --dry-run` to inspect pending refresh work without changing
Charthouse state.
For coordinated implementation across sessions, `/charthouse run "<objective>"`
creates a Voyage; see [Concurrent sessions](#concurrent-sessions).

If the repository already contains valid committed Charthouse state, a new session
uses that Map and its Navigators instead of starting another Expedition. It
reconciles locally changed evidence first.

Reconciliation tracks dirty-path content, `HEAD`, the configured canonical
ref, and its locally available commit. A clean commit, branch switch, or
fast-forward therefore refreshes the Map and discovers new Instruction
Contracts. Charthouse reports a canonical branch that moved ahead of the checkout,
but it does not inspect that branch's content. It rebuilds trusted context
after you update the checkout.

## Install

### Sidecar installation

Sidecar mode uses the standalone installer shown in the
[quickstart](#quickstart-sidecar-mode). The installer puts the
provider-neutral runtime in `~/.charthouse`. It publishes two non-overlapping
skills: `charthouse-context` is the automatic repository sidecar, and `charthouse` is the
explicit administration command. The default `--host all` profile installs
both skills in `~/.claude/skills/` and `~/.agents/skills/`, preserves unrelated
Claude settings, creates a settings backup, and adds Claude lifecycle hooks.

Choose a narrower profile when needed:

```bash
./install.sh --host claude  # Claude skills and lifecycle hooks
./install.sh --host shared  # ~/.agents/skills only; no Claude settings
./install.sh --host all     # both adapters; the default
```

Use `--no-hooks` when you do not want user-level Claude hooks. PowerShell uses
`-TargetHost claude|shared|all` and `-NoHooks`.

Restart open coding-agent sessions. To verify the runtime itself, run:

```bash
~/.charthouse/bin/charthouse --version
cd /path/to/a/repository
~/.charthouse/bin/charthouse doctor --root .
```

In an agent session, `/charthouse help` verifies the explicit Claude command. Do not
run `/charthouse init` only to test the installation: opening a repository and
making a normal request exercises the sidecar path, and init starts a real
Expedition if the repository has no Charthouse state.

Claude receives automatic session and change hooks. Other compatible agents
discover `charthouse-context` in the shared skill directory and reconcile at task
boundaries even when that host has no Charthouse-specific lifecycle hook.

To update a sidecar installation from the cloned Charthouse repository:

```bash
cd /path/to/charthouse
git pull --ff-only
./install.sh --update --host all
```

On PowerShell, use `./install.ps1 -Update -TargetHost all`. The installer shows
the installed and checkout versions before replacement. An update whose
profile includes Claude automatically migrates the old `~/.claude/charthouse`
runtime to `~/.charthouse`, preserves unrelated settings, and refreshes only
Charthouse-owned hooks. Restart open agent sessions afterwards, because a running
session can keep old skill text.

The installer replaces only an installed Charthouse runtime or an empty folder.
If `CHARTHOUSE_HOME` names a folder with other content, the installer stops and
changes nothing.

`charthouse --version` prints the version, source commit, and checkout an
installation came from. A runtime copied from an uncommitted source checkout
uses a `<commit>-dirty` revision label. Its `.install.json` stamp records
`"dirty": true`, and `charthouse doctor` exposes the same provenance before it
checks the runtime, selected skill adapters, Claude hooks, project lock, and
any required repository-state migration.

### Uninstall

To remove a sidecar installation, run this from the Charthouse checkout:

```bash
./install.sh --uninstall
```

On PowerShell, use `./install.ps1 -Uninstall`. The uninstaller shows each item
that it will remove and asks before it continues. Add `--yes` (`-Yes`) to skip
the question. It removes the runtime, both skills from each skill directory,
the Charthouse hooks in `~/.claude/settings.json`, and staging folders from an
interrupted install. It keeps unrelated settings and writes a settings backup.
It stops and changes nothing if the runtime folder does not contain an
installed Charthouse runtime.

The uninstaller does not change repositories. Each repository keeps its
`.charthouse/`, `docs/charthouse/`, and `.claude/` files until you remove them.

If you deleted the checkout, run the copy in the runtime:
`node ~/.charthouse/scripts/uninstall.mjs`.

### Contribute back

Tell Charthouse an idea in normal language or run:

```text
/charthouse contribute "Reconciliation needs a read-only preview."
```

The sidecar can also recognize a verified limitation in Charthouse itself. It
records one deduplicated candidate in private user state and, only for a new
candidate, offers to prepare either a GitHub suggestion or a code pull
request. It does not put this log in the target repository or installed Charthouse
runtime.

Charthouse shows the exact suggestion or draft-PR text before submission. It asks
for explicit authorization before it creates an issue, branch, commit, push,
or pull request. Code changes are made in a Charthouse source checkout, never in
`~/.charthouse`. Candidate text is generalized and must not include target-project
names, paths, tickets, code, logs, credentials, secrets, or customer data.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the complete contributor workflow.

### Agent compatibility

| Host | Charthouse adapter |
|---|---|
| Claude Code | `charthouse-context`, explicit `/charthouse`, lifecycle hooks, path rules, and `.claude/agents/` Navigators |
| Codex | `~/.agents/skills/charthouse-context`, optional `$charthouse` administration, and repository Navigators in `.agents/skills/` |
| Grok | Shared `charthouse-context` `SKILL.md` discovery; it can also consume the Claude-compatible plugin surface |
| Other agents | Use the CLI and canonical `.charthouse/` plus `docs/charthouse/` state; add a thin skill adapter when the host supports local skills |

The shared surface is intentionally smaller than Claude's adapter. It provides
the same facts and safety boundaries, but host-specific automatic hooks and
delegation UI depend on the agent. See the official [Codex skill
documentation](https://learn.chatgpt.com/docs/build-skills), [Claude Code MCP
documentation](https://code.claude.com/docs/en/mcp), and [Grok
skills and plugin documentation](https://docs.x.ai/build/features/skills-plugins-marketplaces).

### Releasing

Keep release changes and notes under `## Unreleased` while you work. Commit the
feature changes first so `npm version` starts from a clean working tree, then
create and push the release commit and tag:

```bash
git status --short
git add -A
git commit -m "Describe the release changes"
npm version minor   # or patch, major
git push --follow-tags
```

Use `minor` for backward-compatible features, `patch` for fixes, and `major`
for breaking changes. `package.json` is the only version source before that
command. `preversion` runs the tests and the plugin validator. `version` runs
`scripts/sync-version.mjs`, which copies the version into
`.claude-plugin/plugin.json` and turns the `## Unreleased` section of
`CHANGELOG.md` into the release section. npm then commits and tags `v<version>`.
A release with an empty `## Unreleased` section is refused, so record changes
as you make them. A Bearing check warns about a Map built by another version
only across a major or minor release.

### Plugin development

Load this checkout directly:

```bash
claude --plugin-dir .
```

Plugin skills use a namespace:

```text
/foundingnimo:charthouse help
```

Claude uses the plugin name as the command namespace. The plugin name is
`foundingnimo`, and the skill name is `charthouse`.

## Main commands

| Command | Alias | Purpose |
|---|---:|---|
| `brief` | — | Build ranked, bounded task context for an objective |
| `check` | `c` | Run a Bearing check |
| `contribute` | — | Prepare an upstream Charthouse suggestion or pull request |
| `docs` | `d` | Inspect documentation state |
| `expedition` | — | Inspect, resume, or checkpoint the first repository survey |
| `help` | `h` | Show command help |
| `impact` | `i` | Predict affected repository areas |
| `knowledge` | `k` | Inspect or maintain knowledge |
| `map` | `m` | Inspect or update the repository Map |
| `next` | `n` | List findings and suggested next steps; `suggest` is a synonym |
| `pr` | `p` | Generate bounded pull-request context |
| `reconcile` | — | Refresh context after evidence, commit, or branch changes |
| `run` | `r` | Create or manage a development Voyage |
| `status` | `s` | Show Charthouse state |
| `where` | `w` | Find code and docs for a concept |

Infrequent or agent-facing commands do not consume one-letter aliases:
`brief`, `charter`, `contribute`, `doctor`, `expedition`, `init`, `navigator`,
`reconcile`, `refit`, `tool`, `who`, and `why`.

## Toolbox

Charthouse installs deterministic tools for operations that agents would otherwise
reimplement as temporary scripts:

```text
charthouse tool list --json
charthouse tool describe dependency-graph --json
charthouse tool run repository-files --path "apps/**" --role source --json
charthouse tool run dependency-graph --unit payments --json
charthouse tool run documentation-index --status suspect --json
charthouse tool run duplicate-analysis --path "packages/**" --json
charthouse tool run survey-report-validate --role capability \
  --file ".charthouse/drafts/<id>/surveys/capability.json" --json
charthouse expedition accept-report <id> --role capability \
  --file ".charthouse/drafts/<id>/surveys/capability.json" --json
charthouse expedition resume <id> --json
```

Each tool declares its runtime, permissions, input schema, and output schema.
The first Toolbox release is read-only and does not use the network. A tool can
start only the subprocesses that it declares; the documentation index declares
Git because its Bearing check inspects ignore rules. Results are bounded to
protect the Claude context window.

`survey-report-validate` checks a mapper report against its role contract, the
deterministic Map and configuration baseline, supported path syntax, size
limit, admitted Map evidence, and required inventory coverage. A path that the
Map omitted or excluded cannot support a survey claim. `expedition
accept-report` validates the same contract and records the report digest as a
durable checkpoint. Each
top-level mapper gets an isolated report file and cannot delegate. `expedition
resume` re-checks accepted digests and reports only the roles that must run
again. Synthesis stops unless the structure, capability, documentation, and
duplication reports all pass.

When an agent must use a system utility, temporary script, or manual fallback,
the caller can record the missing reusable operation:

```text
charthouse tool gap record --key dependency-cycles --need "Find dependency cycles." \
  --checked dependency-graph --fallback system-utility \
  --summary "Analyzed exported edges." --input "Map dependency edges" \
  --output "Ordered cycles" --expedition E-0001 --reporter charthouse-structure-mapper
charthouse tool gap list --status candidate
charthouse tool gap export TG-0001
```

The Log accepts exactly one Voyage or Expedition ID for each observation. It
deduplicates one reporter within that context. Three observations across at
least two Voyages make a gap a Toolbox candidate; one Expedition cannot promote
its own reports. Repeat `--checked` or use a comma-separated list. Export creates
a redacted issue-ready proposal; Charthouse does not submit it or use the network.

## Document review

A fingerprint says that a watched path changed. It does not say whether the
document is now wrong. Charthouse records the commit that the fingerprints of each
document describe, so it can show what changed and let a review decide:

```text
charthouse docs review            # one packet per suspect document
charthouse docs review --json     # the packets an agent reads
charthouse docs confirm <id> --evidence docs/charthouse/chronicles/reviews/<file>.md
```

`charthouse docs review` compares the checkout with the configured canonical ref,
not with the feature branch's upstream. It refuses when the checkout is
behind, diverged, detached, or cannot resolve an explicitly configured ref.
`--allow-behind` continues deliberately without changing Git state. Document
confirmation and Voyage planning, activation, resumption, and completion use
the same guard.

A packet holds the diff since the verification commit, the commit subjects, and
the untracked files in the watched paths. Without a usable commit, the packet
asks for a full review of the document against the current code. The
watch can be an exact path or a supported `*`, `**`, or `?` pattern. A wildcard
inside a file name fingerprints only matching files. The
`charthouse-docs-reviewer` agent verifies each affected claim and returns `holds`,
`needs-change`, or `unsure`. The skill records every verdict in a Chronicle
file. `confirm` then refreshes the fingerprints and records HEAD. It refuses
without that Chronicle file. A binding document needs two independent `holds`
verdicts. A historical document, such as a dated status report, is never
reviewed.

## Project files

Charthouse creates these files inside a target repository:

```text
docs/charthouse/knowledge/       canonical durable knowledge
docs/charthouse/chronicles/      approved Voyage summaries
docs/charthouse/artifacts/       diagrams and supporting artifacts
docs/charthouse/charter.md       human-owned architectural intent
docs/charthouse/map.md           human-readable observed structure
.charthouse/map.json             machine-readable observed structure
.charthouse/config.json          scan, canonical-ref, and operating policy
.charthouse/manifest.json        knowledge and documentation index
.charthouse/fingerprints.json    freshness evidence
.charthouse/changed-paths.json   pending repository evidence changes
.charthouse/reconciliation.json  last reconciled tree, HEAD, and canonical commit
.charthouse/tool-gaps.json       recurring missing Toolbox operations
.charthouse/expeditions/         durable first-survey transaction records
.charthouse/drafts/              temporary, unpublishable Expedition reports
.charthouse/voyages/             durable Voyage records and path leases
docs/charthouse/chronicles/reviews/  document review verdicts and evidence
.claude/rules/charthouse/        generated path-scoped knowledge
.claude/agents/                generated project Navigators
.agents/skills/                generated portable Navigator skills
```

The changed-path queue in `.charthouse/changed-paths.json` is machine state. A
team can commit it or ignore it according to its workflow. Voyage records are
repository state. Commit them when other worktrees or clones must see the same
work ownership and history.

## Use Navigators from any agent session

Charthouse writes each repository specialist twice from one canonical Navigator
brief: a Claude Code project agent in `.claude/agents/`, and a portable skill
in `.agents/skills/<navigator>/SKILL.md`. A second agent session in the same
repository can use the same specialists without running another mapping
process.

In Claude Code:

- Run `/agents` to see every available project Navigator.
- Run `/charthouse who <path>` to find the Navigator responsible for a file.
- Run `/charthouse impact "<ticket or change>"` to find all likely Navigators.
- Name a Navigator explicitly, or let Claude delegate automatically from the
  capability and path details in its description.

Generated Navigators are deliberately read-only. They scope a ticket before
implementation and review the changed files and any supplied diff afterwards.
The host coding-agent session implements the change and runs the required checks.
Canonical context remains in the Map, Charter, and Navigator briefs rather
than in one session's conversation.

`brief` selects at most three responsible capabilities and two explicit
reviewers. It narrows likely paths to the best lexical path matches, keeps all
applicable Instruction Contracts, and caps supporting documents and proposed
verification at eight each. It removes redundant npm checks when the current
package manifest proves that another selected script runs them. These are
orientation hints, not proof of semantic scope; the selected Navigator must
still verify the boundary against code.

Codex and other compatible hosts discover the generated `.agents/skills/`
views. Claude Code loads project-agent files at session start. Restart a
session that caches skills or agents after approved publication, or when
`charthouse map update` or `charthouse navigator regenerate` changes Navigator files.
Initialization does not publish preliminary Navigators. In Claude, run
`/agents` after the restart to verify that it loaded them.

Commit `.agents/skills/`, `.claude/agents/`, `.claude/rules/charthouse/`, `docs/charthouse/`, and the
repository-owned `.charthouse/` state when other worktrees, clones, or team members
must receive the same generated views and context. The changed-path queue is
the workflow-specific exception described above. Do not edit generated agent
files directly. Change their Map evidence and regenerate them instead. See the
[Claude Code subagent documentation](https://code.claude.com/docs/en/subagents#choose-the-subagent-scope)
for the project-agent loading rules.

### Concurrent sessions

Charthouse serializes its own state mutations with a transient lock in the host's
private temporary directory. The path is derived from the repository working
tree and local user, so sessions for the same user in the same working tree
share one lock without adding a file to Git. The lock covers initialization,
Map and Navigator regeneration, document confirmation, Tool Gap mutation, and
hook updates to the changed-path queue. A second writer waits briefly, then
reports the owning process, host, operation, acquisition time, and lock path.
`charthouse doctor` also shows the current owner.

Charthouse removes the lock after a successful or failed operation. If a process is
forcibly terminated, `charthouse doctor` reports its local lock as stale. Run
`charthouse doctor --clear-stale-lock` to remove it only after Charthouse proves that the
recorded local process is gone. Charthouse refuses to clear an active, remote, or
unreadable lock.

Each `/charthouse run "<objective>"` also creates a durable record under
`.charthouse/voyages/`. A planning Voyage owns no paths. After plan approval,
`charthouse run activate <id>` atomically checks and claims its approved paths. An
overlap with another active Voyage is refused. `finish` or `abandon --reason`
closes the lease; the paths remain in the record as audit evidence. Use
`charthouse run status` in any session to see current ownership. The planning
record also stores the canonical ref and commit used at creation.

This layer coordinates Charthouse writers and active Voyage scopes for the same
local user and working tree. Separate local users, Git worktrees, and remote
hosts do not yet share the transient writer lock. They see Voyage leases only
when repository state is shared or synchronized; see [`backlog.md`](backlog.md).

## Configure an Expedition

Prepare `.charthouse/config.json` before `charthouse init` to configure the first scan.
When the file is absent, the host skill asks for the canonical branch and
`init --canonical-ref` creates the configuration. A prepared file must already
contain the selected branch, or the command must receive it explicitly. You
can edit scan policy before a later `charthouse map update`. Charthouse validates the
file before it scans the repository.

This excerpt shows the canonical-ref, package, and role fields in the generated
file:

```json
{
  "git": {
    "canonical_ref": "origin/main"
  },
  "scan": {
    "packages": {
      "include": { "names": [], "paths": [] },
      "exclude": { "names": ["@company/legacy-*"], "paths": [] },
      "excluded_behavior": "stub"
    },
    "tests": { "mode": "evidence", "patterns": ["**/*.test.*"] },
    "fixtures": { "mode": "evidence", "patterns": ["**/fixtures/**"] },
    "generated": { "mode": "exclude", "patterns": ["**/dist/**"] },
    "instructions": {
      "patterns": ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".cursorrules", ".github/copilot-instructions.md", ".cursor/rules/**"],
      "size_warning_bytes": 150000
    },
    "gitignored": {
      "default": "record",
      "include": ["docs/private/**"],
      "exclude": [],
      "hide": []
    }
  }
}
```

`git.canonical_ref` is the exact local or remote-tracking branch selected by
the user as accepted repository history. `null`, a tag, a missing branch, and a
symbolic alias such as `origin/HEAD` are errors. Charthouse does not fetch, switch
branches, merge, rebase, or guess a default branch. `charthouse status` and
`charthouse doctor` show the current branch, canonical commit, and ahead/behind
relationship. A behind, diverged, or detached checkout blocks document review
and confirmation and Voyage lifecycle changes unless `--allow-behind` is
explicit. An unpinned or invalid canonical branch cannot be overridden.

The complete file contains the required fields. Keep them when you edit the
configuration. Pattern arrays replace the defaults; they do not extend them.
Package selectors accept names and repository-relative path
patterns. An excluded package is a `stub` by default. Charthouse keeps its name,
root, manifests, and dependency edges, but it does not create a Navigator or
index internal files. Set `excluded_behavior` to `omit` to remove it from the
Map.

Charthouse does not classify `vendor/` or `build/` as generated by name alone.
These names frequently hold product capabilities, documentation, or
hand-written build tools. Add them to `scan.generated.patterns` only in a
repository where they are known generated output.

`scan.instructions.patterns` identifies files that control agent behaviour.
Charthouse registers each match as a binding, human-owned Instruction Contract. A
root contract applies to the repository. A nested contract applies to its
directory subtree and inherits from the nearest parent for the same provider.
Pattern arrays replace the defaults. Charthouse monitors a discovered contract
directly even when ordinary role, document, language, or package filters would
omit it. It can propose a split or correction, but it does not silently edit
the file.

File roles use these modes:

- `full`: Include the files in evidence and analysis.
- `evidence`: Let files support claims, but do not use them to define
  capabilities or duplication and Refit findings.
- `exclude`: Do not scan or fingerprint the files.

Charthouse treats `.gitignore` as repository evidence, not as an absolute scan
boundary. The default `record` mode lists ignored regions in the perimeter
inventory without reading their contents. Use `include` for intentionally
ignored evidence such as local documentation. Use `exclude` to keep a region
record-only and mark that choice as intentional. Use `hide` when its path must
not appear in the Map. Safety
exclusions for secrets and Charthouse internals always win. An ignored-file include
does not override generated, test, fixture, document, path, or language policy.
The same perimeter inventory records generated and policy-excluded boundaries
even when Git does not ignore them. The scan summary counts tracked files that
hard safety rules omit. The Map lists only non-secret path names and withholds
secret-like names. Charthouse never reads the excluded contents.

The scan also supports package-specific role overrides, document selection,
path exclusions, language filters, a maximum file size, and opt-in in-repository
symlinks. See [the specification](docs/SPEC.md) for precedence and safety rules.

## Safety

- An Expedition does not modify product code.
- Refit findings are proposals, not automatic moves.
- Raw transcripts and secrets are not durable knowledge.
- Generated rules and Navigators are projections. Their canonical sources
  remain under `docs/charthouse/` and `.charthouse/`.
- Writes to human-owned documents require a visible diff and approval.

See [the architecture](docs/ARCHITECTURE.md), [the command reference](docs/COMMANDS.md),
and [the specification](docs/SPEC.md).
