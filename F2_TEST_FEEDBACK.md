# F2 Test Feedback — Independent Live Verification

**Tester:** Claude Code (independent re-test, separate session from the implementer).
**Date:** 2026-05-30. **Branch:** `fix/worktree-changedfiles-summary` @ `0a73d49` ("Reproduce dirty state in worktree jobs") — **not yet merged to master** (master still has F1 only). `dist/` confirmed rebuilt (newer than `src/`); VS Code/MCP server rebooted so the live tools serve the F2 build.
**Scope tested:** F2 (Bug 2 — worktree full working state) live verification + F1 regression. F3/F4 not yet implemented (`output-parser.ts` untouched).

## Verdict: F2 PASS — on the right track.

The original Bug 2 failure (worktree agent couldn't see untracked source and fabricated an empty `bigmotion_pipeline/`) is fixed. Untracked files now propagate into the linked worktree, the warning is surfaced, and the agent reads real source.

### Results

| # | Test (live MCP call) | Expected | Actual | ✓ |
|---|---|---|---|---|
| 1 | `doctor` | healthy on F2 build | ok, `agy` 1.0.3, no errors | ✅ |
| 2 | `execute_tasks mode:"worktree"` reading `bigmotion_pipeline/run_all.py` | agent sees untracked source, reports real slugs | reported the exact 11 `TOPICS` slugs (`anthropology`…`urban-legends`), `Blockers: None` | ✅ |
| 3 | worktree warning surfaced | launch + result carry it | `warning: "Copied 73 untracked file(s) into the isolated worktree."` in both launch and `result` | ✅ |
| 4 | worktree filesystem contains source | `run_all.py` present | 12 `.py` files copied in; `run_all.py` intact (3123 bytes) | ✅ |
| 5 | cleanup via returned names | `worktreePath`/`branchName` (not jobId) | branch `antigravity/pending-mpshhhx5` removed cleanly; host repo intact (12 files) | ✅ |
| 6 | F1 regression — broad review | instant skip | `status:"skipped"` immediately | ✅ |
| 7 | F1 regression — file review | completes, real findings | `completed`, 6 file/line-specific findings + JSON footer, no timeout | ✅ |

### Not live-tested this pass (already unit-verified by implementer; acceptable)

- **Dirty tracked-file replay** (staged + unstaged edits to committed files appearing in the worktree). The session log shows this passed in a throwaway temp git repo. It was not exercised live because the host fixture (`bigmotion_pipeline/`) is entirely untracked, so there are no dirty *tracked* files to replay without first staging one. If you want a live confirmation later: `git add bigmotion_pipeline/download_music.py`, make a 1-line edit, run a worktree delegate that reads it, expect the edited content — then `git reset`/revert.

## Confirmed-deferred behaviors (NOT F2 regressions — these are F3/F4)

`output-parser.ts` is unchanged on this branch, so the known gaps remain and showed up exactly as documented:

- **F3 (changedFiles):** the readonly worktree job's `result` returned `changedFiles: [".playwright-mcp/", "bigmotion_pipeline/", "vnccs_installed_models.json"]` — still raw `git status` with no baseline. A readonly job must yield `[]`. **Extra signal for the implementer:** for a *worktree* job, `result.ts` recomputed `changedFiles` against the host root and reported the host's pre-existing untracked entries (not the 73 copied files in the worktree). When F3 lands, be deliberate about which root `changedSince` runs in for worktree jobs, and that the F2-copied/replayed files are part of the baseline so they are never reported as job changes (this is the F3.2 "capture baseline AFTER F2 copy" ordering rule).
- **F4 (summary):** the worktree job's `summary` was first-line narration (`"I have completed the task. Here is the report:..."`); the review job's `summary` was the markdown report header (`"# Code Review: ... ## Executive Verdict"`), not the clean JSON-footer `summary` the model emitted. Both confirm F4 is still needed; `extractSummary` must prefer the JSON footer for reviews and a structured/boilerplate-filtered section otherwise — never first-line. (See F1_TEST_FEEDBACK.md for the PTY single-block detail.)

## Host-repo / environment state for the next session

- Host fixture repo `e:/StabilityMatrix_win11/Packages/ComfyUI`: clean of test residue. **All test worktrees pruned** (this session's `pending-mpshhhx5` AND a stale `pending-mprxfm1o` from an earlier session were both removed). `git worktree list` now shows only the main repo.
- Untracked entries in the host repo: `.playwright-mcp/`, `bigmotion_pipeline/` (the fixture, intact — 12 `.py`), `vnccs_installed_models.json`.
- Branch state: F1 on `master`; F2 on `fix/worktree-changedfiles-summary` (unmerged). F3/F4 should continue on the same `fix/worktree-changedfiles-summary` branch (its name already covers them).
