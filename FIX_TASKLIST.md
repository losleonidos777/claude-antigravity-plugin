# Antigravity Connector — Fix Implementation Tasklist

**Companion to:** [CONNECTOR_FEEDBACK.md](CONNECTOR_FEEDBACK.md) (read it first — it has root causes, evidence, and `file:line` references).
**Goal:** Fix the 4 bugs, add regression tests, and verify each fix with a **live MCP run** against a real target.
**Repo:** `losleonidos777/claude-antigravity-plugin`, branch `master`. Work on a feature branch.
**Status:** Rev 2 — root causes validated against source by an independent Codex review; this revision incorporates its 5 required edits (skipped-status schema, F1 scope rule, dirty-tracked-file handling in worktrees, warning plumbing, F3↔F2 sequencing + no-clobber-on-reread, F4 stale-summary overwrite) plus expanded edge-case tests.

---

## 0. Setup & ground rules

- [x] **0.1** Create a branch: `git checkout -b fix/review-context-and-changed-files`.
- [x] **0.2** Confirm toolchain: `cd server && npm install` (need `typescript`, `@types/node`, `node-pty`).
- [x] **0.3** Baseline build is green: `npm run build` (in `server/`). Fix any pre-existing TS errors before starting.
- [x] **0.4** Create the test-output dir if missing: `server/test/unit/` (unit tests will live here; `npm test` globs `test/unit/*.test.mjs`).

**Two reusable live-test fixtures** (used throughout this doc):

- **Fixture U (untracked):** `e:\StabilityMatrix_win11\Packages\ComfyUI\bigmotion_pipeline\` — exists on disk, **untracked** in git. This is the condition that broke things.
- **Fixture T (tracked/modified):** to test the "happy path" still works, in the same host repo:
  ```
  git -C e:/StabilityMatrix_win11/Packages/ComfyUI add bigmotion_pipeline/download_music.py
  # (optionally) make a 1-line edit so a working-tree diff also exists
  ```
  After tracking, `git diff --cached -- bigmotion_pipeline/download_music.py` is non-empty → review of `target: staged`/`file` should now have real content. **Unstage afterward** (`git reset`) to restore the user's original untracked state.

> ⚠️ **After every `src/` change you must `npm run build` AND reload the plugin** (restart the Claude Code session or reload the plugin) before the live MCP tests reflect your change — the server runs from `dist/`.

---

## Task F1 — Fix review/adversarial empty context (Bug 1)

**Files:** `server/src/core/prompt-builder.ts`, `server/src/tools/review.ts`.

- [x] **F1.0** (schema prerequisite) Add `"skipped"` to the `JobStatus` union in [`server/src/schemas/jobs.ts`](server/src/schemas/jobs.ts) (lines 8-15). `status: "skipped"` is used by the fast-fail guard below and currently is **not** a valid status — without this the return type lies. (Alternative, only if you prefer not to touch the enum: keep `skipped` as an MCP-response-only string that is never written to `JobState`, and document that explicitly in `review.ts`.)
- [x] **F1.1** In `collectGitContext()`, make the function return both a diff **and** (when applicable) file content. When `target === "file" && ref`:
  - run the existing `git diff -- ref`;
  - **if the diff is empty**, read the file via `readProjectTextFile(projectRoot, ref)` and embed it under a clearly labeled `## File contents (no diff; reviewing full file)` section.
  - **Binary/size guard:** `readProjectTextFile` is UTF-8 only ([`prompt-builder.ts:84`](server/src/core/prompt-builder.ts)). Before embedding: skip if the file looks binary (NUL byte in first ~8KB) and cap embedded size with the existing `truncate()` (and rely on `redactSecrets()` already in that helper). For a binary/oversize file, emit a one-line note instead of dumping bytes.
- [x] **F1.2** **Scope rule (resolves the F1.2↔F1-LV2 tension):** only embed *untracked* file content when the review is **explicitly scoped** — i.e. `target === "file"` with a `ref`, OR a future explicit path arg. For a bare `target: "working-tree"` / `"staged"` with **no ref** and an empty diff, do **NOT** dump arbitrary untracked files (they may be unrelated, e.g. `.playwright-mcp/`) — instead fall through to the fast-fail guard (F1.4). This keeps "review my one new file" working while "review everything" on a dirty-but-undiffed tree fails fast rather than reviewing noise. (If you want scoped working-tree review of new files later, add an explicit `paths: string[]` arg — out of scope here, note it as a follow-up.)
- [x] **F1.3** Refactor `collectGitContext` to return `{ text, hasContent }` (or add `reviewContextHasContent(projectRoot, target, ref): boolean`). `hasContent` is true iff there is a non-empty diff OR resolved file content. Wire `buildReviewPrompt` to consume `text`.
- [x] **F1.4** Add a **fast-fail guard** in `antigravityReview` and `antigravityAdversarialReview` (`review.ts`): before `launchAntigravity`, if `hasContent` is false, return immediately **without launching a job**:
  ```ts
  return { status: "skipped", summary: "Nothing to review: target produced an empty diff and no file content was resolved (is the path untracked or unchanged? stage it or pass target:'file' with a ref).", findings: [], jobId: null, statePath: null };
  ```
  Keep the return shape identical to the success path (same keys) so callers don't break.
- [x] **F1.5** `npm run build` (resolve TS errors).

### ✅ Live verification F1
- [x] **F1-LV1 (untracked file now reviewable):** with Fixture U untracked, call:
  `antigravity_review { target: "file", ref: "bigmotion_pipeline/download_music.py", maxRuntimeMs: 180000 }`
  **Expect:** `status: "completed"` (not `timeout`), `findings` non-empty OR an explicit "no issues" verdict, and the job's `prompt.md` now contains the **file contents** (not `(no diff)`). Inspect `…/artifacts/<job>/prompt.md` to confirm.
- [x] **F1-LV2 (fast-fail path):** call `antigravity_review { target: "working-tree" }` while the tree has only unrelated untracked dirs and no diff/content match.
  **Expect:** immediate `status: "skipped"` with the guidance message — **no 4-minute timeout**, no launched job (or a job that exits in <5s).
- [x] **F1-LV3 (happy path intact):** apply Fixture T (stage the file), then `antigravity_review { target: "staged" }`.
  **Expect:** `completed`, findings reference the staged file. Then `git reset` to unstage.
- [x] **F1-LV4 (adversarial parity):** repeat F1-LV1 with `antigravity_adversarial_review`. **Expect:** same non-timeout behavior.

F1 status note (2026-05-30): Built and live-verified through the compiled MCP stdio server/direct built tool calls. `target:"file"` on the untracked fixture completes with embedded file content, bare `target:"working-tree"` skips immediately, staged review completes after the prompt was tightened to review supplied context only, and adversarial review completes. Host fixture was reset after staged verification. Deep-research follow-up hardening was applied for unsafe path segments, symlink skipping, realpath containment, and broader secret redaction.

---

## Task F2 — Make worktree mode reproduce the user's FULL working state (Bug 2)

**Files:** `server/src/core/worktree.ts`, `server/src/tools/common.ts` (LaunchParams + onExit), `server/src/tools/delegate.ts`, `server/src/tools/tasks.ts`, `server/src/schemas/jobs.ts` (warning field).

> **Why "full working state", not just untracked:** a `git worktree add … HEAD` checkout drops BOTH untracked files AND dirty tracked files (staged + unstaged edits). Fixing only untracked files (the original plan) still gives the agent a stale view of any modified committed file. Reproduce all three layers: HEAD + tracked modifications + untracked-non-ignored.

- [x] **F2.1 (tracked modifications)** After `git worktree add -b <branch> <path> HEAD` succeeds, replay the source's tracked changes into the worktree. Capture the combined diff of staged+unstaged tracked changes against HEAD in the source and apply it in the worktree:
  - `git -C projectRoot diff HEAD --binary` → write to a temp patch file → `git -C worktreePath apply --whitespace=nowarn <patch>`.
  - Guard: if the diff is empty, skip. If `apply` fails, do not abort — record it in `warning` ("could not replay N tracked modifications: …") so the caller knows the worktree may be stale.
  - **Caveat (index fidelity):** `git diff HEAD` collapses staged + unstaged into one patch, so the worktree reproduces the combined *working-tree content* but loses the staged-vs-unstaged distinction. This is fine for an agent that reads/edits files; only matters if the plugin ever needs to preserve the index state separately. Document it as a known limitation rather than solving it here.
- [x] **F2.2 (untracked files)** Enumerate untracked-but-not-ignored files **NUL-delimited** (paths can contain spaces/newlines):
  ```ts
  const others = git(projectRoot, ["ls-files", "-z", "--others", "--exclude-standard"]);
  // split on "\0", drop empties
  ```
  For each path: skip if `pathIsDenied(path)` (reuse `core/safety.ts`); `fs.mkdirSync(dirname, { recursive: true })`; copy `projectRoot/<path>` → `worktreePath/<path>`. **Cross-platform/safety guards:**
  - skip symlinks (or copy as-is per a documented policy) — don't follow them out of the tree;
  - cap per-file size (e.g. skip > 25 MB) and total copied bytes, recording skips in `warning`;
  - use `fs.copyFileSync`; on Windows beware MAX_PATH — prefer extended-length paths if the repo is deep.
- [x] **F2.3 (warning plumbing — NET-NEW code)** `prepareWorktree` returns a `warning` field, but [`delegate.ts:19-24`](server/src/tools/delegate.ts) / [`tasks.ts:17-22`](server/src/tools/tasks.ts) only destructure `executionRoot`/`worktreePath`/`branchName` — they do **not** capture `warning` at all today. Treat the whole chain below as new code, not a partial fix. Thread it end-to-end:
  - add `warning?: string` to `LaunchParams` in [`common.ts:11-21`](server/src/tools/common.ts) and to `JobState` in `jobs.ts`;
  - `delegate`/`execute_tasks` pass `prepared.warning` into `launchAntigravity`;
  - `launchAntigravity` persists it via `store.create`/`update` and includes it in the returned object;
  - confirm it appears in the MCP tool result.
- [x] **F2.4 (anti-fabrication guard)** In the worktree-mode delegate/execute prompt (`prompt-builder.ts`), add: *"If a file referenced by the task does not exist in this worktree, STOP and report it as a blocker — do NOT create it from assumptions."*
- [x] **F2.5 (naming reality — fixes test cleanup)** Note for tests/cleanup: the worktree id is `pending-${Date.now().toString(36)}`, so the branch is `antigravity/pending-…`, **not** `antigravity/<jobId>`. Always read the actual `worktreePath` / `branchName` from the tool result for cleanup — do not derive them from the `ag-…` jobId.
- [x] **F2.6** `npm run build`.

F2 implementation note (2026-05-30): Built on branch `fix/worktree-changedfiles-summary`. `prepareWorktree` now replays tracked dirty state with `git diff --binary --no-ext-diff --no-textconv HEAD --` plus `git apply --check`, copies untracked non-ignored files with safety/size/symlink guards, and returns a warning summary. `delegate` and `execute_tasks` now persist/return the warning. Temp-repo sanity check passed for unstaged tracked, staged tracked, untracked, and ignored files. Live F2 verification remains pending after plugin reload.

### ✅ Live verification F2
- [ ] **F2-LV1 (untracked source now visible):** with Fixture U untracked, run:
  `antigravity_execute_tasks { mode: "worktree", taskListText: "- [ ] Read bigmotion_pipeline/run_all.py and list the exact TOPICS array it defines. Do not modify files." }`
  Wait for completion, then inspect the result. **Expect:** the agent reports the **real 11 topic slugs** from `run_all.py` (`anthropology, art-transformations, bible-stories, explain-like-im-5, fun-facts, interesting-stories, motivational-stories, philosophy, powerful-videos-for-women, pro-tips, urban-legends`). Failure mode (pre-fix) was "file not found" / fabrication.
- [ ] **F2-LV2 (worktree actually contains the file):** check the job's `worktreePath`:
  `ls <worktreePath>/bigmotion_pipeline/run_all.py` → **Expect:** exists.
- [ ] **F2-LV3 (isolation preserved):** confirm `e:/StabilityMatrix_win11/Packages/ComfyUI/bigmotion_pipeline/` is unchanged (no new files, originals intact).
- [ ] **F2-LV4 (warning surfaced):** the tool result (and persisted job state) includes the "Copied N untracked file(s)" warning with N ≥ 12.
- [ ] **F2-LV5 (dirty tracked file replayed):** stage+edit a tracked file in the host repo (Fixture T: `git add bigmotion_pipeline/download_music.py` then make a 1-line edit), run a `worktree` delegate that reads that file, and **expect the agent to see the edited content**, not the HEAD version. Then `git reset` / revert the edit.
- [ ] **F2-LV6 (cleanup — use the RETURNED names, not jobId):** read `worktreePath` and `branchName` from the tool result and run:
  `git -C e:/StabilityMatrix_win11/Packages/ComfyUI worktree remove "<worktreePath>"` then `git -C e:/StabilityMatrix_win11/Packages/ComfyUI branch -D "<branchName>"` (branch is `antigravity/pending-…`, NOT `antigravity/<jobId>`).

---

## Task F3 — `changedFiles` must reflect only this job's changes (Bug 3)

**Files:** `server/src/schemas/jobs.ts`, `server/src/core/output-parser.ts`, `server/src/tools/common.ts`, `server/src/tools/result.ts`.

- [x] **F3.1** Add `baselineStatus?: string[];` to `JobState` in `schemas/jobs.ts`.
- [x] **F3.2** In `common.ts` `launchAntigravity`, capture `const baseline = gitChangedFiles(execRoot)` and persist it as `baselineStatus`. **Ordering (depends on F2):** the baseline must be captured **AFTER** the worktree is prepared and F2 has copied untracked / replayed tracked changes into it — otherwise those copied/replayed files show up as job-created changes. So: in worktree mode capture baseline in the *worktree* (`execRoot === worktreePath`) post-F2; in non-worktree mode capture it in `projectRoot` before launch. Capture before the agent actually runs in both cases.
- [x] **F3.3** Add a helper in `output-parser.ts`: `changedSince(cwd, baseline: string[]): string[]` = `gitChangedFiles(cwd)` minus entries present in `baseline` (set difference on path strings).
- [x] **F3.4** In `common.ts` (both background `onExit` and foreground paths) and `result.ts`, compute `changedFiles` via `changedSince(execRoot, job.baselineStatus ?? [])` instead of raw `gitChangedFiles`.
- [x] **F3.5** Contract guard: if `job.mode === "readonly"`, force `changedFiles = []`.
- [x] **F3.6 (content-change caveat)** `gitChangedFiles` returns **paths only** (status codes are stripped at [`output-parser.ts:97`](server/src/core/output-parser.ts)). Set-difference on paths correctly removes pre-existing untracked **noise**, but will NOT flag a file that was already dirty in the baseline and then *further modified* by the job. This is acceptable for fixing the false-positive bug; if you want true "this job touched it" fidelity, key the baseline on `XY\tpath` (status code + path) or snapshot content hashes. Document whichever you choose; don't silently leave it ambiguous.
- [x] **F3.7 (don't clobber a good record on re-read)** `result.ts` recomputes `changedFiles` on **every** call ([`result.ts:12-15`](server/src/tools/result.ts)). For a finished worktree job whose worktree was later removed, `changedSince` can return `[]` and overwrite a previously-correct stored value. Guard: if the job is in a terminal state AND the execution root no longer exists (`!fs.existsSync(executionRoot)`), return the **stored** `changedFiles`/`summary` instead of recomputing/overwriting.
- [x] **F3.8** `npm run build`.

### ✅ Live verification F3
- [ ] **F3-LV1 (readonly reports nothing):** with Fixture U untracked, run `antigravity_delegate { prompt: "List the .py files in bigmotion_pipeline/. Do not modify anything.", mode: "readonly" }`. After completion call `antigravity_result { jobId }`.
  **Expect:** `changedFiles: []` (pre-fix returned `[".playwright-mcp/","bigmotion_pipeline/"]`).
- [ ] **F3-LV2 (real change detected):** run a `worktree` delegate that creates one new file. **Expect:** `changedFiles` lists exactly that file, not the pre-existing untracked dirs.
- [ ] **F3-LV3 (baseline persisted):** open the job's state JSON and confirm `baselineStatus` is recorded.

---

## Task F4 — `summary` must be the real summary, not the first narration line (Bug 4)

**Files:** `server/src/core/output-parser.ts`, `server/src/tools/common.ts`, `server/src/tools/result.ts`.

- [x] **F4.1** Add `extractSummary(markdown: string): string` to `output-parser.ts`, in priority order:
  1. `extractJsonBlock(markdown)?.summary` (already-existing helper), else
  2. text under a heading matching `/^#{1,6}\s*.*summary\s*$/im` (capture until next heading), else
  3. text after an inline `Summary:` label, else
  4. **last** meaningful paragraph — but **filtered**: when picking the last non-empty block, EXCLUDE the trailing boilerplate sections the prompts mandate (`Files changed`, `Commands run`, `Tests run`, `Remaining risks`, `Human review needed`) and any line starting with `I will `/`I'll `. Otherwise the "last paragraph" is just `Human review needed: None`. Reuse `truncate()` (as `firstMeaningfulParagraph` does at lines 26-29) and strip code fences first.
  - **Log-fallback guard:** `readResult` falls back to the raw **log** when no result file exists ([`output-parser.ts:81-85`](server/src/core/output-parser.ts)). A log tail is bridge noise, not a summary — if extraction is operating on log content (no result file), return a short neutral string (e.g. first non-narration line, capped) rather than a misleading "summary".
- [x] **F4.2** Replace the `result.stdout.split(...).find(line => line.trim())` summary assignment in `common.ts` (lines ~76 and ~108) with `extractSummary(readResult(state.resultPath, state.logPath, true))`.
- [x] **F4.3** Fix the **stale-summary preservation** in `result.ts` (line ~15). It currently does `job.summary || extractSummary(...)`, which **keeps** the bad first-line summary already stored at job completion. Change so a stored summary that is clearly narration (matches `^I will `/`I'll `) is **overwritten** by `extractSummary(resultMarkdown)`; only fall back to the stored value if extraction yields nothing.
- [ ] **F4.4** (Optional polish) strip leading `^I will .*$` / `^I'll .*$` narration lines from delegate/execute `resultMarkdown` before returning, or capture only the final structured section.
- [x] **F4.5** `npm run build`.

### ✅ Live verification F4
- [ ] **F4-LV1:** rerun the delegate from F3-LV1; call `antigravity_result`.
  **Expect:** `summary` is the actual summary sentence (e.g. mentions the pipeline/modules), **not** `"I will list the contents…"`.
- [ ] **F4-LV2:** rerun `antigravity_verify_plan` with a short plan; **Expect:** `summary` reflects the verdict ("Feasible…"), not the opening "I will search for…".

---

## Task F5 — Regression unit tests (no live agent needed)

**Dir:** `server/test/unit/` — these run via `npm test` (`node --test`). Keep them dependency-light; shell out to a temp git repo with `child_process` where needed.

- [ ] **F5.1** `prompt-builder.test.mjs`: temp git repo. Cases: (a) untracked file → `collectGitContext(target:"file")` embeds contents (not `(no diff)`) and `hasContent===true`; (b) clean tracked file (no diff) → embeds contents; (c) **binary** file → NOT dumped, note emitted; (d) **oversize** file → truncated/skipped per cap; (e) bare `working-tree` with only an unrelated untracked dir → `hasContent===false` (drives the fast-fail/skip path).
- [ ] **F5.2** `worktree.test.mjs`: temp git repo with (1) committed file, (2) a committed file with an **unstaged edit**, (3) a **staged** edit, (4) an **untracked** file, (5) an **ignored** file. Call `prepareWorktree`; assert: untracked file present, tracked modifications (2)+(3) replayed, ignored file **absent**, `warning` set with a copied-count. Cover a **rename** in `changed-files` test too. Clean up the worktree + branch.
- [x] **F5.3** `changed-files.test.mjs`: temp repo with a pre-existing untracked file as baseline; assert `changedSince` excludes the baseline entry, includes a newly created file, and handles a **renamed** path (the `old -> new` parsing at `output-parser.ts:97-99`); assert readonly mode yields `[]`; assert the F3.7 guard returns stored value when `executionRoot` is missing.
- [x] **F5.4** `summary.test.mjs`: feed `extractSummary` (a) markdown with a JSON block, (b) markdown with a `## Summary` heading, (c) narration-then-conclusion ending in mandated boilerplate (`Human review needed: None`) → asserts it returns the real conclusion, NOT the boilerplate and NOT the first `"I will…"` line, (d) log-only content → neutral short string.
- [x] **F5.5** `npm test` → all green.

---

## Task F6 — Build, reload, full live regression sweep

- [ ] **F6.1** `cd server && npm run build && npm test` — both green.
- [ ] **F6.2** `npm run smoke` — green.
- [ ] **F6.3** Reload the plugin (restart Claude Code session) so MCP serves the new `dist/`.
- [ ] **F6.4** Re-run the original 10-tool sweep against Fixture U and confirm the matrix in CONNECTOR_FEEDBACK.md is now all ✅:
  - `doctor`, `setup`, `status` — still ✅
  - `delegate` (readonly) — ✅, `changedFiles: []`, real `summary`
  - `result` — ✅, real `summary`, correct `changedFiles`
  - `verify_plan` — ✅, real `summary`
  - `execute_tasks` (worktree) — ✅, sees untracked source, warning surfaced
  - `cancel` — ✅
  - `review` — ✅ **completes** with findings (no timeout)
  - `adversarial_review` — ✅ **completes**
- [ ] **F6.5** Restore the host repo to its original untracked state (unstage Fixture T, remove test worktrees/branches).

---

## Acceptance checklist (definition of done)

- [ ] `review` / `adversarial_review` complete (no timeout) on **untracked** and **unmodified** targets, with real content in the prompt.
- [ ] Empty-context review **fast-fails** with a clear message instead of timing out; `"skipped"` is either added to `JobStatus` or documented as MCP-response-only.
- [ ] `worktree` jobs reproduce the user's full working state — untracked files **and** dirty tracked modifications; isolation of the main tree is preserved; the worktree `warning` is surfaced in the tool result; agents do not fabricate missing files.
- [ ] `changedFiles` excludes pre-existing untracked entries and is `[]` for readonly jobs; the content-change caveat (F3.6) is documented; re-reading a finished job with a removed worktree does not clobber the stored record (F3.7).
- [ ] `summary` reflects the agent's actual summary/verdict — never the first "I will…" narration line and never trailing boilerplate; stale stored narration summaries are overwritten on re-read.
- [ ] `npm run build`, `npm test`, `npm run smoke` all green; new unit tests cover all 4 fixes **and** the edge cases in F5 (binary/oversize, ignored, staged, rename, removed-worktree, log-only).
- [ ] `CHANGELOG.md` updated; PR opened against `master` referencing CONNECTOR_FEEDBACK.md.
