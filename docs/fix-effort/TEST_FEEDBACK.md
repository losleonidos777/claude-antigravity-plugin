# Fix-Effort Live Test Feedback

Consolidated live MCP test results from the connector fix effort (F1–F4).
Originally three separate files (`F1_TEST_FEEDBACK.md`, `F2_TEST_FEEDBACK.md`,
`F3_F4_TEST_FEEDBACK.md`).

---

# F1 Test Feedback — Independent Live Verification

**Tester:** Claude Code (independent re-test, separate session from the implementer).
**Date:** 2026-05-30. **Build:** `master` @ `ffdcede` (Merge review context fixes); `dist/` confirmed rebuilt (newer than `src/`); VS Code/MCP server restarted so the live tools serve the new code.
**Scope tested:** F1 (Bug 1 — review context) only, since the session log states F2–F6 are not started.

## Verdict: F1 PASS — ship it.

All review-context behaviors work as designed. The original failure (4-minute timeout + filesystem wandering on untracked/empty-diff targets) is gone.

### Results

| # | Test (live MCP call) | Expected | Actual | ✓ |
|---|---|---|---|---|
| 1 | `doctor` | healthy on new build | ok, `agy` 1.0.3, no errors | ✅ |
| 2 | `review target:"working-tree"` (untracked tree, no diff) | instant fast-fail | `status:"skipped"` immediately, no job launched | ✅ |
| 3 | `review target:"file" ref:"bigmotion_pipeline/download_music.py"` (untracked) | completes, embeds contents | `completed`; prompt has `## File contents (no diff; reviewing full file)` + real source; 5 specific findings | ✅ |
| 4 | `adversarial_review` same file | completes | `completed`; found path-traversal + SSL + silent-failure issues | ✅ |
| 5 | `review target:"file" ref:"bigmotion_pipeline/oi.json"` (10 MB) | oversize guard | `status:"skipped"` (rejected before embed) | ✅ |
| 6 | `review target:"file" ref:"../../../../Windows/win.ini"` (escape) | path-escape guard | `status:"skipped"`, nothing outside repo leaked | ✅ |

Review quality is genuinely good — findings were accurate and file/line-specific (silent failure on truncated downloads, `curl -k` MITM, path traversal from untrusted JSON keys, hardcoded `E:\` path).

## Observations to carry into F2–F4 (not F1 regressions)

These behaved exactly as the README "known limitations" say they would, but here is concrete data for when you implement them:

- **F4 (summary) — sharper requirement found.** Even for *review* jobs, the `result` tool's `summary` field came back as the **markdown report header** (`"# Code Review Report… ## Executive Verdict…"`), **not** the clean `summary` from the JSON footer that the model reliably emitted (e.g. *"The Suno music downloader pipeline is prone to silent data corruption…"*). Root: the first-line/`firstMeaningfulParagraph` path wins before the JSON footer is consulted, and under **PTY transport the whole report arrives as one block** (no early newline), so "first line" = the title. → F4 `extractSummary` must prefer the validated JSON footer `summary` for review/adversarial jobs, and the structured `## Summary` / last-meaningful (boilerplate-filtered) for delegate/execute/verify — never first-line.
- **F3 (changedFiles) — concrete false-positive.** Readonly review/`result` returned `changedFiles: [".playwright-mcp/", "bigmotion_pipeline/", "vnccs_installed_models.json"]`. Note `vnccs_installed_models.json` is a **new** untracked file that appeared this session — a perfect example of pre-existing noise that a baseline-diff must exclude. A readonly job must yield `[]`.
- **F2 (worktree)** not exercised (correctly gated behind README guidance to track/stage files first).

## Host-repo state for the next session

Host fixture repo `e:/StabilityMatrix_win11/Packages/ComfyUI` is clean of test residue: all tests were readonly reviews — **no worktrees created, no staging performed**. Current untracked entries: `.playwright-mcp/`, `bigmotion_pipeline/`, `vnccs_installed_models.json`. `bigmotion_pipeline/` (the fixture) remains untracked as intended.


---

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


---

# F3 / F4 Test Feedback + Fix Continuation

**Tester:** Claude Code (independent live test, separate session from implementer).
**Date:** 2026-05-30. **Branch:** `fix/worktree-changedfiles-summary` @ `a2bbeda` ("Fix changed file attribution and summaries"). 40 unit tests + smoke pass; `dist/` rebuilt; VS Code/MCP rebooted so live tools serve the F3/F4 build. **Not merged to master.**
**Scope:** F3 (changedFiles attribution) + F4 (summary extraction) live verification, with F1/F2 regression spot-checks.

---

## Verdict: NOT ready to merge. One real bug (F3) + one quality tweak (F4).

| Check | Result |
|---|---|
| F1 regression (broad review → skip; file review → findings) | ✅ holds |
| F2 regression (worktree copies untracked, warning surfaced) | ✅ holds (`Copied 73 untracked file(s)`) |
| F3-LV1 — readonly job → `changedFiles: []` | ✅ PASS |
| **F3-LV2 — worktree job that creates a file → should list it** | ❌ **FAIL** (returned `[]`) |
| F3-LV3 — `baselineStatus` persisted | ✅ recorded (but dir-collapsed; see below) |
| F4-LV1 — delegate summary not `"I will…"` | ✅ narration gone / ⚠️ wrong section |
| F4-LV2 — verify_plan summary = verdict | ✅ narration gone / ⚠️ wrong section |

---

## 🔴 BUG F3-1 — untracked-directory collapse masks job-created files (must fix)

**Symptom.** A `worktree`-mode `delegate` was told to create exactly one file. It did — `bigmotion_pipeline/F3_TEST_MARKER.txt` was confirmed present in the worktree — yet `result.changedFiles` came back `[]` instead of `["bigmotion_pipeline/F3_TEST_MARKER.txt"]`.

**Evidence (from the job state JSON):**
```
mode: worktree
executionRoot: …/worktrees/…/pending-mpsin66c
baselineStatus: ['.playwright-mcp/', 'bigmotion_pipeline/', 'vnccs_installed_models.json']
changedFiles: []
```
The new file lives under `bigmotion_pipeline/`, which is already a single collapsed entry in `baselineStatus`. `changedSince(current, baseline)` therefore subtracts `bigmotion_pipeline/` wholesale and the new file vanishes.

**Root cause.** [`server/src/core/output-parser.ts:183`](server/src/core/output-parser.ts) — `gitChangedFiles` runs:
```ts
childProcess.spawnSync("git", ["status", "--porcelain=v2", "-z"], …)
```
With the default untracked mode (`-unormal`), git **collapses an untracked directory to one entry** (`bigmotion_pipeline/`) instead of listing its files. Creating/adding a file inside an already-untracked directory does not change the top-level entry set, so baseline-diff attribution can't see it.

**Why this is high-impact, not a corner case.** In `worktree` mode, F2 copies the *entire* working set into the worktree as **untracked** files. So in practice the whole tree the agent works in is untracked, and **any** file an agent creates inside an existing untracked directory is invisible to `changedFiles`. This guts F3 for the exact mode (worktree) where change attribution matters most.

**Fix.** Add `--untracked-files=all` (a.k.a. `-uall`) to the status invocation so individual untracked files are enumerated:
```ts
childProcess.spawnSync("git", ["status", "--porcelain=v2", "--untracked-files=all", "-z"], …)
```
- Porcelain v2 untracked lines are `? <path>` — confirm the existing parser keeps `?` entries and returns their paths (it should already; just more of them now).
- After the fix, baseline becomes the full per-file list (e.g. `bigmotion_pipeline/run_all.py`, …), and `changedSince` correctly yields `["bigmotion_pipeline/F3_TEST_MARKER.txt"]`.
- Minor perf note: `-uall` enumerates every untracked file under the root; fine here (readonly is forced to `[]` anyway, and worktree/suggest need the precision). `.gitignore` still excludes models/venv, so volume stays sane.

**Re-test after fix (F3-LV2):** rerun the worktree create-one-file delegate; expect `changedFiles == ["bigmotion_pipeline/F3_TEST_MARKER.txt"]` and `baselineStatus` listing individual files (not the collapsed dir).

---

## 🟡 F4 — narration suppression works; section selection is wrong for verdict-style output (recommended tweak)

**What works.** The headline goal is met: across delegate, verify_plan, and review, the summary **never** leads with the `"I will…"` narration anymore (verify_plan had a ~30-line `"I will…"` preamble that was correctly skipped). `isNarration` filtering + the JSON-footer-first path (reviews) are solid.

**What's off — two cases:**

1. **verify_plan (F4-LV2):** `summary` came back as the **"Unanswered Questions"** section instead of the **"Verdict" (PASS WITH RECOMMENDATIONS)**. verify_plan output has no `Summary` heading and no JSON footer, so `extractSummary` falls through to `lastMeaningfulParagraph()` ([`output-parser.ts:92-106`](server/src/core/output-parser.ts)), which grabs the final block — the questions, not the verdict.
2. **delegate (F4-LV1):** the output *did* contain a `### Summary` section, but `summary` returned a large intro block instead. `extractSummaryHeading()` ([`output-parser.ts:72-85`](server/src/core/output-parser.ts)) matches `^#{1,6}\s*.*summary\s*$` on a **trimmed standalone line**; under PTY transport headings are sometimes glued to preceding text (e.g. `the work done:### Summary`) or the block-splitting differs, so the anchored line match misses and it falls through.

**Recommended tweak (small, in `output-parser.ts`):**
- Treat **`Verdict`** and **`Executive Verdict`** as summary-equivalent headings. Either broaden `extractSummaryHeading`'s regex to `^#{1,6}\s*.*(summary|verdict)\s*$` (and the same in `looksLogOnly` at line 69), or add a parallel `extractVerdictHeading` consulted right after the summary heading.
- Make heading detection tolerant of **headings not on their own line**: before scanning, normalize by inserting a newline before any inline `#{1,6}` marker (e.g. `markdown.replace(/([^\n])(#{1,6}\s)/g, "$1\n$2")`), or scan with a global section regex rather than per-trimmed-line.
- Keep preferring the **first** matched verdict/summary section (current `extractSummaryHeading` already returns the first match) — for plan/verify the verdict is near the top, so first-match is correct; `lastMeaningfulParagraph` should remain only the final fallback.

**Re-test after tweak:**
- F4-LV2: verify_plan `summary` should start with the verdict (e.g. `"PASS WITH RECOMMENDATIONS …"`).
- F4-LV1: delegate `summary` should be the `### Summary` section (`"The bigmotion_pipeline directory contains 12 Python scripts…"`), not the file-list intro.
- Regression: review summary still comes from the JSON footer (don't disturb `parseReview`).

---

## Fix continuation — tasklist

Stay on branch `fix/worktree-changedfiles-summary`.

- [ ] **FX1 (F3 bug):** add `--untracked-files=all` to the `git status` call at `output-parser.ts:183`. Verify the porcelain-v2 parser still returns `?` untracked paths. `npm run build`.
- [ ] **FX2 (F3 unit test):** in the changed-files test, add a case: temp git repo, create a file inside an **already-untracked directory**, assert `changedSince` returns that file (this is the case the current `-unormal` mode misses). `npm test`.
- [ ] **FX3 (F4 tweak):** recognize `Verdict`/`Executive Verdict` as summary headings + tolerate inline/glued headings in `extractSummaryHeading` (and `looksLogOnly`). `npm run build`.
- [ ] **FX4 (F4 unit tests):** add `summary.test.mjs` cases — (a) verify/plan-style markdown with a `### Verdict` section and a trailing `Unanswered Questions` section → `extractSummary` returns the verdict; (b) a heading glued to preceding text (`done:### Summary\n…`) → still extracted. `npm test`.
- [ ] **FX5:** `npm run build && npm test && npm run smoke` all green. Append results to `CODEX_SESSION_LOG.md`. Pause for a live re-test (reload required) before F6/merge.

### Live re-test (after reload, run by Claude)
- F3-LV2: worktree create-one-file delegate → `changedFiles == ["bigmotion_pipeline/F3_TEST_MARKER.txt"]`.
- F3-LV1 regression: readonly delegate → `changedFiles: []` (still).
- F4-LV2: verify_plan → summary = verdict.
- F4-LV1: delegate → summary = its `### Summary` section.
- F1/F2 regression: broad review → skip; worktree → copies untracked + warning.

### Then F6 (merge readiness)
Only after the above pass: update `CHANGELOG.md` (F3 `-uall` fix + F4 verdict-heading), confirm `npm test`/`smoke` green, and open the PR merging `fix/worktree-changedfiles-summary` → `master`.

---

## Environment / host-repo state

- Test worktree `pending-mpsin66c` + branch `antigravity/pending-mpsin66c` removed; `git worktree list` clean. Host `bigmotion_pipeline/` intact (12 `.py`, no leaked `F3_TEST_MARKER.txt` — isolation verified).
- Host untracked entries: `.playwright-mcp/`, `bigmotion_pipeline/` (fixture), `vnccs_installed_models.json`.
- Fixtures unchanged: `bigmotion_pipeline/run_all.py` `TOPICS` = 11 slugs (oracle). For F5/unit work prefer throwaway temp git repos.
