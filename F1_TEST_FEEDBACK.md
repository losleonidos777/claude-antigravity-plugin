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
