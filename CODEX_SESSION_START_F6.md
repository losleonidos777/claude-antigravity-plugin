# Codex Session Start — Final Phase (FX6 cosmetic fix → F6 merge)

You are finishing the connector fix effort. **All four bugs (F1–F4) are implemented and live-verified.** One cosmetic edge remains (FX6); fix it, then do F6 (CHANGELOG + merge to master).

---

## Status coming in (2026-05-30)

Branch `fix/worktree-changedfiles-summary` @ `ba8c80e`, 43 unit tests + smoke green. Independent live re-test results:

- **F1** review context — ✅ (broad → `skipped`, file review → embedded contents + findings).
- **F2** worktree full working state — ✅ (copies untracked + replays tracked, warning surfaced, agent reads real source).
- **F3** changedFiles attribution — ✅ **FIXED by FX1** (`--untracked-files=all`): worktree job that creates a file now returns `changedFiles: ["bigmotion_pipeline/F3_TEST_MARKER.txt"]`; readonly → `[]`.
- **F4** summary extraction — ✅ verdict + clean-heading + JSON-footer cases all work (verify_plan now returns the Verdict; worktree job returns its `### Summary`; narration never leaks).
- **One minor edge → FX6 below.**

## FX6 — heading glued to FOLLOWING text isn't isolated (the only thing to fix)

**Symptom (live):** a readonly `delegate` whose output contained `…ComfyUI server.## SummaryThe bigmotion_pipeline directory contains 12 Python files…` returned the verbose file-list intro as `summary` instead of the `## Summary` section. (Narration-free and accurate, just the wrong block — cosmetic.)

**Root cause:** in [`server/src/core/output-parser.ts`](server/src/core/output-parser.ts):
- `normalizeMarkdownHeadings` (line ~73): `markdown.replace(/([^\r\n#])(#{1,6}\s+)/g, "$1\n$2")` splits a heading glued to *preceding* text, so `server.## Summary` → `server.\n## Summary`. ✅ glued-before handled.
- But the heading title is also glued to the *following* sentence with no break: the line becomes `## SummaryThe bigmotion_pipeline…`.
- `isSummaryHeading` (line ~77): `/^#{1,6}\s*.*(?:summary|verdict)\s*$/i` requires the line to **end** with the keyword. `## SummaryThe …` does not end with `summary`, so the heading is missed and extraction falls through to the verbose paragraph.

**Fix (small, in `normalizeMarkdownHeadings` or a second pass before `isSummaryHeading`):** also break a heading keyword that is glued to a following word. After the existing replace, add:
```ts
// split "## SummaryThe bigmotion…" → "## Summary\nThe bigmotion…"
// only when a known summary/verdict keyword is immediately followed by a letter (no space)
out = out.replace(/(#{1,6}\s*(?:executive\s+)?(?:summary|verdict))(?=[A-Za-z])/gi, "$1\n");
```
- `(?=[A-Za-z])` only triggers when there is NO space after the keyword, so legitimate titles like `## Summary of changes` (space → lookahead fails) are left intact.
- Keep it scoped to `summary|verdict` (and `executive verdict`) so unrelated headings aren't split.
- After this, `## Summary` is its own line, `isSummaryHeading` matches, and the existing section-capture loop (lines ~81-93) grabs the body up to the next heading.

- [ ] **FX6.1** Implement the glued-after split above. `npm run build`.
- [ ] **FX6.2** Unit test in `summary.test.mjs`: input `"...server.## SummaryThe `bigmotion_pipeline` directory contains 12 files.### Files changed\n- None"` → `extractSummary` returns the Summary body (`"The bigmotion_pipeline directory contains 12 files."`), NOT the boilerplate or a verbose intro. Also keep a guard test that `## Summary of changes` (legit multi-word title with a space) is NOT split. `npm test`.

### FX6 live re-test (after reload, run by Claude)
- Readonly `delegate` "list the .py files … end with a ## Summary section" → `summary` = the `## Summary` content, not the file-list intro.
- Regression: F4-LV2 verify_plan still returns the Verdict; review summary still from JSON footer; F3-LV2 worktree create-file still attributes exactly the new file.

---

## F6 — merge readiness (after FX6 passes re-test)

- [ ] **F6.1** `cd server && npm run build && npm test && npm run smoke` — all green.
- [ ] **F6.2** Update `CHANGELOG.md` (move the relevant items out of "Unreleased" into a release section, or extend Unreleased). Cover the whole effort:
  - **Worktree (F2):** worktree jobs now reproduce the full working state — copy untracked-non-ignored files (`git ls-files -z --others --exclude-standard`, with denied/symlink/size/total guards) and replay dirty tracked edits (`git diff --binary … HEAD` + `git apply --check`); a `warning` (copied count / replay issues) is surfaced through `delegate`/`execute_tasks`/`result`. Anti-fabrication prompt line added. Known caveat: `git diff HEAD` collapses staged vs unstaged.
  - **changedFiles (F3):** attribution is now baseline-relative (`baselineStatus` captured post-worktree-prep), uses `git status --porcelain=v2 --untracked-files=all -z` so files created inside already-untracked dirs are detected, forces `[]` for readonly jobs, and does not clobber a stored record when a finished job's worktree was removed.
  - **summary (F4):** `extractSummary` prefers the validated JSON footer, then `## Summary`/`Verdict`/`Executive Verdict` headings (tolerant of headings glued before/after text — FX6), then a boilerplate-filtered last paragraph, with a neutral log fallback; stale `"I will…"` narration summaries are overwritten.
  - **review (F1, already on master via earlier merge):** mention if not already in the changelog.
- [ ] **F6.3** Commit the FX6 + CHANGELOG changes. Append a final entry to `CODEX_SESSION_LOG.md`.
- [ ] **F6.4** Open a PR merging `fix/worktree-changedfiles-summary` → `master`. PR body should summarize F2/F3/F4 + FX1/FX6, link `CONNECTOR_FEEDBACK.md` and the `F*_TEST_FEEDBACK.md` files, list the live-verified checks, and note the one documented caveat (staged-vs-unstaged collapse). Do **not** self-merge — leave it for review.

## Build / test / reload workflow (`server/`)

- `npm run build` after every `src/` edit (live server runs `dist/`).
- `npm test` (build + `node --test test/unit/*.test.mjs`), `npm run smoke`.
- **Live MCP re-test needs a plugin reload** — the user reconnects via the MCP control tab (no full VS Code reboot required). Coordinate with the user before the FX6 live re-test.

## Guardrails

- Don't regress F1–F4 or the 8 working tools. Reviews must still use the JSON footer; F3-LV2 must still attribute the single new file; verify_plan must still return the Verdict.
- Live tests touch the host repo `e:/StabilityMatrix_win11/Packages/ComfyUI` (worktrees). Clean up using the returned `worktreePath`/`branchName` (branch `antigravity/pending-<base36 ts>`); never commit `bigmotion_pipeline/`.
- Prefer throwaway temp git repos for unit tests.

## First actions

1. `git checkout fix/worktree-changedfiles-summary` (already there). `cd server && npm run build && npm test` (43 pass).
2. Implement **FX6** + its unit test. Build + test.
3. Append to `CODEX_SESSION_LOG.md`. **Pause for the FX6 live re-test** (reload required).
4. After re-test passes: do **F6** (CHANGELOG, commit, PR to master). Do not self-merge.
