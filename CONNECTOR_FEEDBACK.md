# Antigravity Connector — Live Test Feedback & Fix Context

**Audience:** Codex agent tasked with fixing the connector.
**Author:** Claude Code (live verification session, 2026-05-30).
**Repo:** `losleonidos777/claude-antigravity-plugin` (branch `master`).
**Companion doc:** [FIX_TASKLIST.md](FIX_TASKLIST.md) — the step-by-step implementation + live-test plan derived from this feedback.

---

## 1. What was tested and how

All 10 MCP tools were exercised live against a real, **untracked** working directory:
`e:\StabilityMatrix_win11\Packages\ComfyUI\bigmotion_pipeline\` (a ~12-file Python pipeline). The host repo's `git status` at test time:

```
?? .playwright-mcp/
?? bigmotion_pipeline/
```

Bridge binary: `agy` CLI **v1.0.3** at `C:\Users\user\AppData\Local\agy\bin\agy.EXE`. Platform: Windows 11, PowerShell.

> **The single most important environmental fact:** the entire target directory is **untracked** in git. This is the condition that exposed 3 of the 4 bugs below. It is *not* an exotic edge case — users frequently point the connector at new code, scratch dirs, generated output, or freshly scaffolded projects that haven't been committed yet.

### Result matrix

| Tool | Verdict | Notes |
|---|---|---|
| `doctor` | ✅ Works | Correctly resolved binary, git, capabilities |
| `setup` | ✅ Works | Clean diagnostics |
| `status` | ✅ Works | Correctly reconciled a cancelled job (status→`cancelled`, `finishedAt` set) |
| `delegate` (readonly) | ✅ Works | Produced an accurate 8-module summary + data flow |
| `result` | ✅ Works | Returns markdown/log/changed-files — but see Bug 3 & 4 |
| `verify_plan` | ✅ Works | High quality — found real edge cases independently |
| `execute_tasks` (worktree) | ⚠️ Partial | Isolation correct, main tree untouched — **but agent could not see the untracked source (Bug 2)** |
| `cancel` | ✅ Works | Terminated process tree cleanly |
| `review` | ❌ **Broken** | Timed out, zero findings (Bug 1) |
| `adversarial_review` | ❌ **Broken** | Timed out, zero findings (Bug 1) |

---

## 2. Bug reports (priority order)

### 🔴 Bug 1 — `review` / `adversarial_review` produce empty context on untracked or unmodified files → agent wanders the filesystem and times out

**Symptom.** Both review tools returned `status: "timeout"`, `findings: []`. The agent's narration (captured in the job log) showed it hunting for the target file across `C:\Users\user\.gemini\antigravity-cli\scratch`, then all of `C:\Users\user`, then `G:\` — never finding it — until the runtime cap killed it. ~4 minutes wasted per call, no output.

**Evidence.** The generated `prompt.md` for the review job (`target: file`, `ref: bigmotion_pipeline/download_music.py`) contained:

```
<untrusted-git-context>
## Git status
?? .playwright-mcp/
?? bigmotion_pipeline/

## Git diff target
file (bigmotion_pipeline/download_music.py)

```diff
(no diff)
```
</untrusted-git-context>
```

The file exists and is readable (`delegate` read it fine seconds earlier), but the review prompt embedded **no file content** — only an empty diff.

**Root cause.** [`server/src/core/prompt-builder.ts`](server/src/core/prompt-builder.ts) → `collectGitContext()` (lines 16–40) builds the entire review payload from `git diff`:

```ts
if (target === "file" && ref) diffArgs = ["diff", "--no-ext-diff", "--", ref];
const diff = runGit(projectRoot, diffArgs, 700_000);
...
diff || "(no diff)"
```

- `git diff -- <path>` shows **nothing** for an **untracked** file (it's not in the index) and **nothing** for a **clean/unmodified** tracked file.
- So for any untracked target — or any file with no uncommitted changes — the review agent is handed `(no diff)` and literally has nothing to review.
- Compounding factor: there is **no fast-fail guard**. [`server/src/tools/review.ts`](server/src/tools/review.ts) launches the agent unconditionally even when the context is empty. The agent, told to "review the diff" with no diff, improvises by searching the disk and burns the full `maxRuntimeMs`.

**Why it doesn't affect `delegate`/`verify_plan`:** those prompts give the agent the repo root and let it explore the live working tree directly (no `git diff` dependency), so untracked files are visible to them.

**Fix direction.**
1. In `collectGitContext`, when `target === "file"`: if `git diff` is empty, fall back to embedding the **actual file contents** (there's already a `readProjectTextFile()` helper at line 79 of the same file). Label it clearly so the agent knows it's reviewing full content, not a diff.
2. For `working-tree`/`staged` targets: if the diff is empty, also include untracked-but-not-ignored files (`git ls-files --others --exclude-standard`) and/or their contents, so "review my new code" works before the first commit.
3. Add a **fast-fail guard** in `review.ts`/`adversarial_review`: if the assembled context has no diff *and* no file content, return immediately with a clear `status: "skipped"` + message ("nothing to review: target produced an empty diff and no file content was resolved") instead of launching a doomed agent that times out.

---

### 🔴 Bug 2 — worktree-mode jobs cannot see untracked files (the worktree is a clean `HEAD` checkout)

**Symptom.** `execute_tasks` (mode `worktree`) was asked to summarize `run_all.py`. The agent log shows it ran `git status`, searched for `run_all.py` and `bigmotion_pipeline`, found **nothing**, then **created a brand-new empty `bigmotion_pipeline/` directory** containing only the output file. It never read the real code — the task only "succeeded" because the task text itself contained the summary.

**Evidence.** Inspecting the created worktree:

```
worktree/bigmotion_pipeline/  → only PIPELINE_NOTES.md   (run_all.py ABSENT)
main repo/bigmotion_pipeline/ → 12 .py files intact, NO PIPELINE_NOTES.md  (isolation correct)
```

**Root cause.** [`server/src/core/worktree.ts`](server/src/core/worktree.ts) line 18:

```ts
const add = git(projectRoot, ["worktree", "add", "-b", branchName, worktreePath, "HEAD"]);
```

`git worktree add … HEAD` checks out the committed tree only. **Untracked files do not propagate into a new worktree** — they live solely in the original working directory. Since `bigmotion_pipeline/` is untracked, it does not exist in the worktree, and the delegated agent is effectively working in an empty repo.

> **Broader than untracked (raised in Codex review):** a `HEAD` checkout *also* drops **dirty tracked files** — any staged or unstaged modifications to committed files are absent from the worktree too. So even a fully-tracked repo with uncommitted edits gives the worktree agent a stale view. The fix must reproduce the user's *full working state* (HEAD + tracked modifications + untracked-non-ignored), not just copy untracked files.

Note on naming (relevant to cleanup/tests): the worktree id is `pending-${Date.now().toString(36)}` ([`delegate.ts:20`](server/src/tools/delegate.ts), [`tasks.ts:18`](server/src/tools/tasks.ts)) — **not** the jobId. So the branch is `antigravity/pending-…` and differs from the `ag-…` jobId. Also, `prepareWorktree` returns a `warning` field that `delegate.ts`/`tasks.ts`/`common.ts` currently **drop** — it never reaches the tool result.

**Impact.** Any `delegate(mode:"worktree")` or `execute_tasks(mode:"worktree")` against uncommitted code operates on missing files. Worst case (as seen here) the agent silently fabricates a plausible-looking result. This is a **correctness/silent-data-loss class** issue, not just UX.

**Fix direction (pick one, prefer A+C):**
- **A.** After `git worktree add`, copy untracked-but-not-ignored files from `projectRoot` into the worktree. Enumerate with `git -C projectRoot ls-files --others --exclude-standard` and copy each into the same relative path under `worktreePath`. This makes the worktree a faithful snapshot of what the user actually sees.
- **B.** Detect untracked files up front; if present, return a `warning` (the function already has a `warning?` field in its return type) explaining they won't be visible, and surface it in the tool result.
- **C.** Regardless of A/B, **never let a worktree agent silently create the missing target** — the prompt/guard should make "source not found in worktree" a hard, reported failure rather than an invitation to fabricate.

---

### 🟠 Bug 3 — `changedFiles` reports false positives (it echoes pre-existing `git status`, including readonly jobs)

**Symptom.** Every job — including pure **readonly** ones that changed nothing — returned `changedFiles: [".playwright-mcp/", "bigmotion_pipeline/"]`. Those are exactly the pre-existing untracked entries from `git status` at session start. The readonly delegate's own result body correctly said *"Files changed: None"*, directly contradicting the `changedFiles` field.

**Root cause.** [`server/src/core/output-parser.ts`](server/src/core/output-parser.ts) → `gitChangedFiles()` (lines 88–105) runs `git status --short` and returns **every** entry — with no baseline. Called from:
- [`server/src/tools/common.ts`](server/src/tools/common.ts) lines 67 and 99 (on job completion)
- [`server/src/tools/result.ts`](server/src/tools/result.ts) line 12

There is no notion of "files changed *by this job*" — it's "everything dirty in the tree right now," which includes unrelated pre-existing untracked files and (for readonly jobs) changes the job never made.

**Fix direction.**
1. Snapshot a **baseline** of `git status --short` at job launch (store it on `JobState`, e.g. `baselineStatus: string[]`). On completion, compute `changedFiles = currentStatus − baseline`. For readonly jobs against a pre-dirty tree this yields `[]`, which is correct.
2. For **worktree** jobs, compute changes inside the *worktree* against its starting `HEAD` (the worktree starts clean, so `git status --short` in the worktree is already accurate — but it should be run with `cwd = worktreePath`, which `executionRoot` already is — verify this).
3. Optionally, for `readonly` mode, short-circuit `changedFiles` to `[]` by contract (a readonly job must not report changes).

---

### 🟡 Bug 4 — `summary` field returns the agent's first narration line, not the actual summary

**Symptom.** `result.summary` came back as e.g. *"I will list the contents of the bigmotion_pipeline directory to locate the source code files…"* — the agent's first streamed thought — instead of the `## Summary` / verdict section the prompt explicitly requests. The `resultMarkdown` also prepends all the `"I will examine X"` narration lines as noise before the real content.

**Root cause.** Two places take the first non-empty stdout line as the summary:
- [`server/src/tools/common.ts`](server/src/tools/common.ts) lines 76 & 108:
  ```ts
  summary: result.stdout.split(/\r?\n/).find((line) => line.trim()) || ... || result.status
  ```
- [`server/src/tools/result.ts`](server/src/tools/result.ts) line 15 (same first-line fallback on `resultMarkdown`).

The delegate/execute prompts ask the agent to end with a `- Summary` section; the review prompt asks for a JSON block with a `summary` field. Neither is parsed for the *persisted* summary — the code just grabs line 1, which is always narration.

> **Scope nuance (from Codex review):** `parseReview()` ([`output-parser.ts:44-60`](server/src/core/output-parser.ts)) *does* extract the JSON `summary` correctly for the **live return value** of `review`/`adversarial_review` when the agent emits the JSON block. So Bug 4 primarily affects (a) the **persisted `job.summary`** written in `common.ts`, and (b) the summary for **non-review tools** (`delegate`, `execute_tasks`, `verify_plan`) and `result.ts`. The fix should target those paths; don't regress the working review-JSON path.

**Fix direction.** Add an `extractSummary(markdown)` helper in `output-parser.ts` that, in priority order:
1. uses the `summary` field from the fenced JSON block (`extractJsonBlock` already exists), else
2. extracts the text under a `## Summary` / `### … Summary` / `Summary:` heading, else
3. falls back to the **last** meaningful paragraph (the conclusion) rather than the **first** line (the opening narration).

Use it in `common.ts` (both onExit + foreground) and `result.ts`. Also consider stripping leading `"I will …"` narration lines from `resultMarkdown` for delegate/execute jobs, or capturing only the final structured block.

---

## 3. Architecture map (for the fixer)

```
server/src/
  core/
    prompt-builder.ts   ← Bug 1 (collectGitContext, buildReviewPrompt)
    output-parser.ts    ← Bug 3 (gitChangedFiles), Bug 4 (parseReview/summary, add extractSummary)
    worktree.ts         ← Bug 2 (prepareWorktree: git worktree add HEAD)
    job-store.ts        ← persistence (add baselineStatus field here if used)
    cli-adapter.ts      ← buildInvocation/doctor
    process-runner.ts   ← runForeground/runBackground (timeout handling)
  tools/
    review.ts           ← Bug 1 fast-fail guard
    common.ts           ← Bug 3 & 4 (launchAntigravity sets changedFiles + summary)
    result.ts           ← Bug 3 & 4 (recomputes changedFiles + summary)
    delegate.ts, tasks.ts, cancel.ts, status.ts, doctor.ts
  schemas/
    jobs.ts             ← JobState type (add baselineStatus?: string[] if needed)
    tools.ts            ← MCP input schemas
    config.ts
```

**Build & test tooling** (`server/package.json`):
- Build: `npm run build` (= `tsc -p tsconfig.json`) — **the running MCP server uses `dist/`, so a rebuild is mandatory after any `src/` edit.**
- Unit tests: `npm test` (= build + `node --test test/unit/*.test.mjs`). **No `test/unit/` files exist yet** — the fix should add them.
- Smoke: `npm run smoke` (= build + `node ../scripts/smoke-test.mjs`).

**Reload after rebuild:** the MCP server is a long-lived stdio process owned by Claude Code; after `npm run build` the Claude Code session must reconnect the plugin server (restart session / reload plugin) for changes to take effect in live MCP tests.

---

## 4. Severity & sequencing recommendation

1. **Bug 1** (review broken) — highest user-visible impact, self-contained fix in `prompt-builder.ts` + `review.ts`.
2. **Bug 2** (worktree blindness) — correctness/silent-fabrication risk; fix in `worktree.ts`.
3. **Bug 3** (changedFiles) — misleading output; needs a baseline field, touches schema + 3 call sites.
4. **Bug 4** (summary) — cosmetic-ish but degrades every result; isolated helper + 3 call sites.

See [FIX_TASKLIST.md](FIX_TASKLIST.md) for the concrete, ordered implementation steps with live verification against `bigmotion_pipeline/`.
