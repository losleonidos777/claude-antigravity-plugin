# Codex Session Start — Antigravity Connector, Continuation (F3 → F6)

You are continuing an in-progress fix effort. **F1 and F2 are done and live-verified.** Your job now is F3 → F6 from `FIX_TASKLIST.md`. Read this file top to bottom, then the reference docs, then start at Task F3.

---

## Status coming in

- **F1 (Bug 1 — review context):** ✅ done, merged to `master`, live-verified. See `F1_TEST_FEEDBACK.md`. Do not touch.
- **F2 (Bug 2 — worktree full working state):** ✅ done on branch `fix/worktree-changedfiles-summary`, unit-verified (30 tests) AND live-verified. See `F2_TEST_FEEDBACK.md`. Do not redo.
- **F3 (Bug 3 — changedFiles baseline attribution):** ❌ not started. `core/output-parser.ts` `gitChangedFiles` is still raw `git status --short`; no `baselineStatus`; no `changedSince`.
- **F4 (Bug 4 — summary extraction):** ❌ not started. No `extractSummary`; `common.ts`/`result.ts` still take the first non-empty line.
- **F5 (unit tests):** partial — `server/test/unit/` exists with ~30 tests; add F3/F4 + remaining edge cases.
- **F6 (build, reload, full live re-sweep, acceptance + merge):** pending.

## Read these first (in order)

1. `F2_TEST_FEEDBACK.md` — what was just verified + **two concrete signals that sharpen F3 and F4** (read these; they change implementation details).
2. `F1_TEST_FEEDBACK.md` — the PTY single-block detail that matters for F4.
3. `CONNECTOR_FEEDBACK.md` — root causes for Bugs 3 & 4 (still accurate).
4. `FIX_TASKLIST.md` — your work doc; **start at Task F3.** Rev 2, twice-reviewed (GO).
5. `CODEX_SESSION_LOG.md` — prior progress + "Research recommendations carried forward". Append your F3/F4 progress here.

## Branch

- Continue on the existing F2 branch: `git checkout fix/worktree-changedfiles-summary` (its name already covers F3/F4). Do **not** branch off master — you need F2's code.
- Edit `server/src/**`; the live server runs `server/dist/**` — rebuild + reload after every change.

## What each remaining task touches (source map)

```
F3  schemas/jobs.ts          add baselineStatus?: string[]
    tools/common.ts          capture baseline AFTER F2's worktree copy/replay; compute changedSince at completion
    core/output-parser.ts    add changedSince(cwd, baseline); keep gitChangedFiles
    tools/result.ts          use changedSince; add no-clobber guard when executionRoot missing
F4  core/output-parser.ts    add extractSummary(): JSON-footer > "## Summary" > last-meaningful (boilerplate-filtered) > neutral; never first-line
    tools/common.ts          set summary via extractSummary (onExit + foreground)
    tools/result.ts          use extractSummary; OVERWRITE stale narration summaries (don't keep job.summary if it's narration)
F5  test/unit/*.test.mjs     changed-files (baseline/rename/readonly/removed-worktree) + summary (json/heading/boilerplate/log-only)
F6  build + test + smoke + live re-sweep + CHANGELOG + PR to master
```

## Critical implementation guidance (from live testing — read `F2_TEST_FEEDBACK.md` for context)

- **F3 ordering (the #1 gotcha):** baseline MUST be captured AFTER F2 copies untracked files + replays tracked diffs into the worktree — otherwise those 73 copied files count as "job changes." For non-worktree jobs, capture baseline in `projectRoot` before launch; for worktree jobs, capture in the worktree (`executionRoot === worktreePath`) after F2 setup, before the agent runs.
- **F3 which-root:** in the last live test, a worktree job's `result.ts` recomputed `changedFiles` against the **host root** and returned the host's pre-existing untracked entries (`.playwright-mcp/`, `bigmotion_pipeline/`, `vnccs_installed_models.json`) — wrong root + no baseline. Make `changedSince` run in the same root the baseline was captured in, and persist `baselineStatus` so `result.ts` re-reads use it.
- **F3 readonly contract:** `mode === "readonly"` → force `changedFiles = []`.
- **F3 stable porcelain:** prefer `git status --porcelain=v2 -z` for baseline/diff (NUL-delimited, rename-safe); document whether path-only baseline is sufficient or content hashes are needed for already-dirty files (FIX_TASKLIST F3.6).
- **F3 no-clobber:** if a finished job's `executionRoot` no longer exists (worktree removed), `result.ts` must return the STORED `changedFiles`, not recompute to `[]`.
- **F4 prefer structured output:** under PTY transport the whole model answer arrives as ONE block, so first-line parsing grabs the title. `extractSummary` priority: validated JSON footer `summary` (reviews emit this reliably) → `## Summary`/`Summary:` section → last meaningful paragraph with boilerplate filtered (`Files changed`, `Commands run`, `Tests run`, `Remaining risks`, `Human review needed`, and `^I will`/`^I'll`) → neutral short string if only log content is available.
- **F4 overwrite stale:** `result.ts` currently keeps `job.summary` if set; a stored narration summary from job completion must be OVERWRITTEN by `extractSummary(resultMarkdown)`.

## Build / test / reload workflow (in `server/`)

- `npm run build` (`tsc`) after every `src/` edit — live server runs `dist/`.
- `npm test` (build + `node --test test/unit/*.test.mjs`). Add F5 cases.
- `npm run smoke`.
- **Live MCP re-test needs a plugin reload / Claude Code restart** after build (unit tests don't). Coordinate the reload with the user for the F6 sweep.

## Live-test fixtures (host repo — the user's, treat with care)

- **Host repo:** `e:/StabilityMatrix_win11/Packages/ComfyUI` (git). Untracked: `.playwright-mcp/`, `bigmotion_pipeline/`, `vnccs_installed_models.json`. All test worktrees are currently pruned (clean).
- **Fixture U (untracked):** `bigmotion_pipeline/` — `run_all.py` `TOPICS` = 11 slugs (oracle).
- **Fixture T (dirty tracked, for F3 attribution + F2 tracked-replay live check):** `git add bigmotion_pipeline/download_music.py` + a 1-line edit; restore with `git reset` + revert after.
- **Prefer throwaway temp git repos for F5 unit tests** so they don't depend on the host repo.

## Guardrails

- **Restore the host repo after every live test:** unstage Fixture T, revert edits, remove test worktrees/branches using the returned `worktreePath`/`branchName` (branch is `antigravity/pending-<base36 ts>`, NOT `antigravity/<jobId>`). Never commit `bigmotion_pipeline/` or `vnccs_installed_models.json`.
- **Don't regress F1 or F2** or the 8 working tools. F6 must keep: broad review→skipped, file review→embed+complete, worktree→copies untracked+replays tracked+surfaces warning+agent sees source, and `doctor/setup/status/delegate/result/verify_plan/execute_tasks/cancel` green.
- Keep tool return shapes stable; reuse `core/safety.ts`.

## Definition of done

The acceptance checklist at the bottom of `FIX_TASKLIST.md`: `changedFiles` accurate and `[]` for readonly (no pre-existing untracked noise, correct root, no-clobber on reread); `summary` is the real summary (JSON footer for reviews, structured section otherwise), never narration/boilerplate, stale ones overwritten; `npm run build`/`test`/`smoke` green with new F5 cases; CHANGELOG updated; then request a live re-sweep (F6) and open the PR to `master`.

## First actions

1. `git checkout fix/worktree-changedfiles-summary` (NOT a new branch off master).
2. `cd server && npm run build && npm test` — confirm clean baseline (~30 tests pass).
3. Read `F2_TEST_FEEDBACK.md`, then `FIX_TASKLIST.md` from Task F3.
4. Implement **F3** first (changedFiles + baseline), then **F4** (summary). Append progress to `CODEX_SESSION_LOG.md`. Pause for a live re-test after F3+F4 build, before F6/merge.
