# Codex Session Start — Antigravity Connector Fixes

You are implementing bug fixes for an MCP plugin. This file is your full context. Read it top to bottom, then read the two reference docs it points to, then start at Task F1.

---

## Mission

Fix 4 verified bugs in the **Antigravity connector** — an MCP server that bridges Claude Code to the local `agy` CLI so coding/review tasks can be delegated as background jobs. The bugs were found by live-testing all 10 MCP tools and the fix plan has already passed two rounds of independent review (verdict: **GO**). Your job is to turn the spec into working code, verified by the live tests in the plan.

## Repository

- **Root:** `C:/Users/user/.claude/plugins-local/claude-antigravity-plugin/`
- **Remote:** `losleonidos777/claude-antigravity-plugin`, branch `master`.
- **Start by branching:** `git checkout -b fix/review-context-and-changed-files`
- **Source you edit:** `server/src/**` (TypeScript). The running MCP server executes the compiled `server/dist/**`.

## Read these first (in order)

1. **`CONNECTOR_FEEDBACK.md`** — root-cause analysis of all 4 bugs with exact `file:line` references and evidence. This is the *why*.
2. **`FIX_TASKLIST.md`** — the *what/how*: ordered tasks F1→F6, each with implementation steps **and** a live verification test. Marked "Rev 2", reviewed and GO. **This is your primary work document — follow it task by task.**

Both are accurate as of this writing; the source files are still untouched (they describe work to do, not work done).

## The 4 bugs in one line each

1. **`review`/`adversarial_review` hang** — context is built only from `git diff`, which is empty for untracked/unmodified files → agent gets `(no diff)`, wanders the FS, times out. (`core/prompt-builder.ts` `collectGitContext`; `tools/review.ts` has no fast-fail.)
2. **worktree mode is blind to uncommitted work** — `git worktree add … HEAD` drops untracked files **and** dirty tracked edits → agent can't see the code and may fabricate output. (`core/worktree.ts`.)
3. **`changedFiles` false positives** — raw `git status --short` with no baseline → reports pre-existing untracked dirs even for readonly jobs. (`core/output-parser.ts` `gitChangedFiles`; callers `tools/common.ts`, `tools/result.ts`.)
4. **`summary` is narration** — takes the first stdout line (the agent's "I will…") instead of the requested Summary/verdict. (`tools/common.ts`, `tools/result.ts`.)

## Source map

```
server/src/
  core/prompt-builder.ts   ← Bug 1 (collectGitContext, buildReviewPrompt, readProjectTextFile)
  core/worktree.ts         ← Bug 2 (prepareWorktree)
  core/output-parser.ts    ← Bug 3 (gitChangedFiles), Bug 4 (parseReview, add extractSummary)
  core/safety.ts           ← pathIsDenied, redactSecrets, truncate (reuse these)
  tools/review.ts          ← Bug 1 fast-fail guard
  tools/common.ts          ← Bugs 3 & 4 (launchAntigravity sets changedFiles + summary); add warning to LaunchParams
  tools/delegate.ts        ← Bug 2 warning plumbing (worktree branch = pending-<ts>, NOT jobId)
  tools/tasks.ts           ← Bug 2 warning plumbing
  tools/result.ts          ← Bugs 3 & 4 (recompute path; add no-clobber guard)
  schemas/jobs.ts          ← add "skipped" to JobStatus; add baselineStatus?: string[]; add warning?: string
  schemas/tools.ts         ← MCP input schemas
```

## Implementation order

F1 (review context + fast-fail) → F2 (worktree full-state + warning plumbing) → F3 (changedFiles baseline; **depends on F2 ordering**) → F4 (summary extraction) → F5 (unit tests) → F6 (build, reload, full live re-sweep + acceptance checklist). Do them in order — F3's baseline capture must happen after F2's worktree copy.

## Build / test / reload workflow (in `server/`)

- **Install:** `npm install` (needs `typescript`, `@types/node`, `node-pty`).
- **Build:** `npm run build` (= `tsc -p tsconfig.json`). **Mandatory after every `src/` change** — the live server runs `dist/`.
- **Unit tests:** `npm test` (= build + `node --test test/unit/*.test.mjs`). **No tests exist yet — F5 creates `server/test/unit/`.**
- **Smoke:** `npm run smoke`.
- **⚠️ Reload to live-test MCP tools:** the MCP server is a long-lived stdio process owned by Claude Code. After `npm run build`, the **Claude Code session must reload the plugin / restart** before the MCP tools (`antigravity_review`, etc.) reflect your change. Unit tests don't need a reload; live MCP verification does.

## Live-test fixtures (in the host repo, NOT this plugin repo)

- **Host repo:** `e:/StabilityMatrix_win11/Packages/ComfyUI` (a git repo).
- **Fixture U (untracked):** `e:/StabilityMatrix_win11/Packages/ComfyUI/bigmotion_pipeline/` — ~12 Python files, **untracked** in git. This untracked state is what exposed bugs 1–3. `run_all.py` there defines a `TOPICS` array of exactly 11 slugs (`anthropology, art-transformations, bible-stories, explain-like-im-5, fun-facts, interesting-stories, motivational-stories, philosophy, powerful-videos-for-women, pro-tips, urban-legends`) — used as an oracle in F2-LV1.
- **Fixture T (tracked/dirty):** stage/edit a file to test the happy path: `git -C e:/StabilityMatrix_win11/Packages/ComfyUI add bigmotion_pipeline/download_music.py` (+ optional 1-line edit).

## Guardrails

- **Restore the host repo after testing.** It belongs to the user. Unstage Fixture T (`git reset`), revert any test edits, and remove test worktrees/branches using the `worktreePath`/`branchName` returned in the tool result (branch is `antigravity/pending-…`, not `antigravity/<jobId>`). Never commit `bigmotion_pipeline/`.
- **Don't regress the working tools.** `doctor, setup, status, delegate, result, verify_plan, execute_tasks, cancel` all pass today; the final F6 sweep must keep them green. In particular, `parseReview` already extracts the review JSON `summary` correctly for the live return value — fix the *persisted* summary path without breaking that.
- **Reuse `core/safety.ts`** (`pathIsDenied`, `redactSecrets`, `truncate`) rather than re-implementing.
- **Keep tool return shapes stable** — the fast-fail "skipped" return must have the same keys as the success path.

## Two known caveats (already in the plan; don't be surprised)

1. **F2.3 warning plumbing is net-new code** — `delegate.ts`/`tasks.ts` do **not** capture `prepareWorktree`'s `warning` today; you're adding the whole chain (return → `LaunchParams` → `JobState` → result).
2. **F2.1 index fidelity** — replaying tracked changes via `git diff HEAD` collapses staged+unstaged into one patch (loses the staged/unstaged distinction). Acceptable; documented limitation.

## Definition of done

The acceptance checklist at the bottom of `FIX_TASKLIST.md`. In short: review tools complete (no timeout) on untracked/unmodified targets; empty-context review fast-fails; worktree reproduces full working state + surfaces the warning; `changedFiles` is accurate ([] for readonly); `summary` is the real summary; `npm run build` + `npm test` + `npm run smoke` green with new tests covering all 4 fixes and the F5 edge cases; CHANGELOG updated; PR opened against `master`.

## First actions

1. `cd C:/Users/user/.claude/plugins-local/claude-antigravity-plugin && git checkout -b fix/review-context-and-changed-files`
2. `cd server && npm install && npm run build` (confirm a clean baseline build).
3. Read `CONNECTOR_FEEDBACK.md` and `FIX_TASKLIST.md`.
4. Begin Task **F1**.
