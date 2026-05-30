# Codex Session Start — Antigravity Connector, Continuation (F2 → F6)

You are continuing an in-progress fix effort. **F1 is done and merged to `master`; verified by an independent live re-test.** Your job now is F2 → F6 from `FIX_TASKLIST.md`. Read this file top to bottom, then the reference docs, then start at Task F2.

---

## Status coming in

- **F1 (Bug 1 — review context):** ✅ implemented, merged to `master` (`Merge review context fixes`), and independently live-verified. See `F1_TEST_FEEDBACK.md` for the full pass report. **Do not redo F1.**
- **F2 (Bug 2 — worktree full working state):** ❌ not started.
- **F3 (Bug 3 — changedFiles baseline attribution):** ❌ not started.
- **F4 (Bug 4 — summary extraction):** ❌ not started.
- **F5 (unit tests):** partial — `server/test/unit/` exists; add the remaining coverage.
- **F6 (build, reload, full live re-sweep, acceptance):** pending.

## Read these first (in order)

1. `F1_TEST_FEEDBACK.md` — what was verified + 3 concrete observations that sharpen F2/F3/F4.
2. `CONNECTOR_FEEDBACK.md` — root causes for all 4 bugs (still accurate for 2/3/4).
3. `FIX_TASKLIST.md` — your work doc; **start at Task F2.** It is Rev 2, twice-reviewed (GO).
4. `CODEX_SESSION_LOG.md` — what the prior session did, plus a "Research recommendations carried forward to F2–F6" block. Append your progress here as you go.

## Repository & branch

- **Root:** `C:/Users/user/.claude/plugins-local/claude-antigravity-plugin/`
- **Branch off the merged F1 work:** `git checkout master && git pull` (if applicable) then `git checkout -b fix/worktree-changedfiles-summary`
- **Edit `server/src/**`; the live server runs `server/dist/**`** — rebuild + reload after every change (see workflow).

## What each remaining task touches (source map)

```
F2  core/worktree.ts            prepareWorktree: replay tracked diff + copy untracked; return warning
    tools/delegate.ts, tasks.ts capture prepared.warning (they DON'T today — net-new)
    tools/common.ts             add warning to LaunchParams; persist + return it
    schemas/jobs.ts             add warning?: string
    core/prompt-builder.ts      worktree-mode anti-fabrication line
F3  schemas/jobs.ts             add baselineStatus?: string[]
    tools/common.ts             capture baseline AFTER F2 worktree copy; compute changedSince
    core/output-parser.ts       add changedSince(); keep gitChangedFiles
    tools/result.ts             use changedSince; add no-clobber guard when execRoot missing
F4  core/output-parser.ts       add extractSummary() (JSON footer > ## Summary > last-meaningful, filtered)
    tools/common.ts, result.ts  use extractSummary; overwrite stale narration summaries
```

## Research recommendations to honor (from prior session log)

- **F2 tracked replay:** use an applyable patch shape — `git diff --binary --no-ext-diff --no-textconv HEAD --` — and validate with `git apply --check` before applying; surface partial-state warnings instead of aborting.
- **F2 untracked copy:** `git ls-files -z --others --exclude-standard`; containment check (realpath inside project root), skip symlinks, size caps, structured `warning`. Reuse the safety helpers F1 already added in `core/safety.ts` (unsafe-segment screening, reserved device names).
- **F3:** prefer stable porcelain — `git status --porcelain=v2 -z` — for baseline/diff; document whether path-only baseline is sufficient or content hashes are needed for already-dirty files (see `FIX_TASKLIST.md` F3.6 caveat).
- **F4:** prioritize the validated JSON footer / final structured block over narration or first-line. **Concrete finding from F1 testing:** under PTY transport the whole review report arrives as one block, so first-line parsing grabs the title — `extractSummary` must parse structure, not lines (details in `F1_TEST_FEEDBACK.md`).
- **Schemas:** tool output-schema formalization is deferred — review tools have different foreground/background return shapes; don't formalize until the result model is normalized. Just keep return shapes stable.

## Build / test / reload workflow (in `server/`)

- `npm install` (idempotent) → `npm run build` (`tsc`). **Mandatory after every `src/` edit** — live server runs `dist/`.
- `npm test` (= build + `node --test test/unit/*.test.mjs`). Add F5 cases (binary/oversize, ignored, staged, rename, removed-worktree, log-only).
- `npm run smoke`.
- **Live MCP re-test requires a plugin reload / Claude Code restart** after build — unit tests don't, the F6 live sweep does. Coordinate the reload with the user.

## Live-test fixtures (host repo — belongs to the user)

- **Host repo:** `e:/StabilityMatrix_win11/Packages/ComfyUI` (git). Untracked entries currently: `.playwright-mcp/`, `bigmotion_pipeline/`, `vnccs_installed_models.json`.
- **Fixture U (untracked):** `bigmotion_pipeline/` (~12 py files). `run_all.py` defines a `TOPICS` array of exactly 11 slugs (`anthropology, art-transformations, bible-stories, explain-like-im-5, fun-facts, interesting-stories, motivational-stories, philosophy, powerful-videos-for-women, pro-tips, urban-legends`) — the oracle for F2-LV1.
- **Fixture T (dirty tracked):** `git add bigmotion_pipeline/download_music.py` + a 1-line edit, to test F2 tracked-replay (F2-LV5) and F3 attribution.
- **Prefer temp throwaway git repos for unit tests** (F5) so they don't depend on the host repo.

## Guardrails

- **Restore the host repo after every live test:** unstage Fixture T (`git reset`), revert edits, and remove test worktrees/branches using the `worktreePath`/`branchName` returned in the result (branch is `antigravity/pending-<base36 ts>`, **not** `antigravity/<jobId>`). Never commit `bigmotion_pipeline/` or `vnccs_installed_models.json`.
- **Don't regress F1 or the 8 already-working tools.** F6 must keep `doctor, setup, status, delegate, result, verify_plan, execute_tasks, cancel` green and the F1 review behaviors intact (broad→skipped, explicit file→embed+complete).
- Keep tool return shapes stable; reuse `core/safety.ts`.

## Definition of done

The acceptance checklist at the bottom of `FIX_TASKLIST.md`: worktree reproduces full working state (untracked + dirty tracked) and surfaces the warning; `changedFiles` accurate and `[]` for readonly; `summary` is the real summary (JSON footer for reviews; structured section otherwise), never narration/boilerplate; `npm run build`/`test`/`smoke` green with the new F5 cases; CHANGELOG updated; PR against `master`. Then request a live re-sweep (F6) with the user driving the reload.

## First actions

1. `cd C:/Users/user/.claude/plugins-local/claude-antigravity-plugin && git checkout -b fix/worktree-changedfiles-summary`
2. `cd server && npm run build` (confirm clean baseline) and `npm test` (see current state).
3. Read `F1_TEST_FEEDBACK.md`, then `FIX_TASKLIST.md` from Task F2.
4. Implement **F2** first (its worktree setup must land before F3's baseline capture). Append progress to `CODEX_SESSION_LOG.md`. Pause for a live re-test after F2 builds.
