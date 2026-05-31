# Changelog

## Unreleased

## 0.3.0 — 2026-05-31

### Fixed

- **Background-job timeouts are now durably enforced (cold-test Bug A).** Each job
  persists a `deadlineAt` (`startedAt + timeoutMs`) at launch, and
  `JobStore.reconcile` — run by every `status`/`result` call — now kills any
  `running` job whose PID is alive but past its deadline (with a 5 s clock-skew
  margin) and marks it `timeout`. This survives MCP-server recycles that drop the
  in-memory `setTimeout` watchdog; previously an orphaned `agy` could spin
  unbounded. Jobs without a `deadlineAt` are never reaped.
- **`cancel` no longer reports success while the process survives (cold-test
  Bug B).** `antigravityCancel` now sends the requested signal, waits a grace
  period, and re-verifies liveness via a new `killProcessTreeConfirmed` helper —
  escalating SIGTERM to a forced SIGKILL (`taskkill /F /T`) when a spinning
  Windows console process ignores the polite signal. It reports `cancelled:true`
  only after the process tree is confirmed gone; otherwise `cancelled:false` and
  the job is left running for the reaper/retry. `taskkill`'s "signal sent" exit
  code is no longer trusted as proof of death.
- **Worktree `changedFiles` now captures in-place edits to replayed files
  (cold-test Edge C).** After replaying untracked/dirty files, `prepareWorktree`
  creates a throwaway baseline commit so the replayed state is the worktree HEAD;
  an edit to a replayed-untracked file is then attributed instead of cancelling
  out against the baseline status snapshot.
- **Review `summary` no longer picks the "Areas Reviewed" file list (cold-test
  Nit D).** `extractSummary` treats `Areas Reviewed` / `Areas of review` /
  `Scope of review` as non-summary boilerplate, so the JSON-footer verdict (or a
  Summary/Verdict heading) wins.
- `antigravity_review` and `antigravity_adversarial_review` no longer time out
  on explicitly scoped clean or untracked file targets. When `git diff` is empty
  for `target:file`, the bridge embeds the file contents in a labelled untrusted
  prompt section.
- Empty broad review targets now fast-fail with `status: "skipped"` instead of
  launching a doomed long-running review.
- Review prompts now tell Antigravity to review the supplied context rather than
  searching the filesystem for reviewed files.
- **Worktree jobs now reproduce the user's full working state.** `prepareWorktree`
  copies untracked-but-not-ignored files
  (`git ls-files -z --others --exclude-standard`, with denied-path / symlink /
  per-file-size / total-bytes guards) and replays dirty tracked edits
  (`git diff --binary --no-ext-diff --no-textconv HEAD --` validated with
  `git apply --check`). A `warning` summarising the copied count / replay issues
  is now threaded through `delegate`, `execute_tasks`, and `result`. The
  worktree-mode prompt instructs the agent to STOP and report (not fabricate) a
  task-referenced file that is missing from the worktree. Known caveat:
  `git diff HEAD` collapses staged vs. unstaged edits, so the worktree reproduces
  the combined working-tree content but not the separate index state.
- **`changedFiles` now reflects only the job's own changes.** Attribution is
  baseline-relative: `baselineStatus` is captured after the worktree is prepared
  (so copied/replayed files are not counted as job-created), and
  `gitChangedFiles` runs `git status --porcelain=v2 --untracked-files=all -z` so
  files created inside an already-untracked directory are detected instead of
  being masked by a collapsed directory entry. Readonly jobs are forced to
  `changedFiles: []`. Re-reading a finished job whose worktree has since been
  removed no longer clobbers the stored record with an empty list. Caveat:
  set-difference is on paths only, so a file already dirty in the baseline and
  further modified by the job is not re-flagged.
- **`summary` now reflects the agent's real summary/verdict, never the first
  "I will…" narration line.** `extractSummary` prefers the validated JSON footer,
  then a `## Summary` / `Verdict` / `Executive Verdict` heading (tolerant of a
  heading glued to preceding *or* following text — e.g. `server.## SummaryThe…`
  is split, while a legitimate `## Summary of changes` title is left intact),
  then a boilerplate-filtered last paragraph, with a neutral fallback when only
  bridge-log content is available. A stored summary that is clearly narration is
  overwritten on re-read.

### Security

- File-content fallback now rejects unsafe path segments, symlinks, paths whose
  real path escapes the project root, binary-looking files, and oversized files.
- Secret redaction now covers additional AWS credential patterns.

### Documentation

- Added best-practice guidance for explicit file review, skipped reviews,
  worktree caveats, and artifact inspection.

## 0.2.0

End-to-end live-verified release. Adds a PTY transport that bypasses the
upstream `agy --print` stdout-suppression bug
([antigravity-cli#76](https://github.com/google-antigravity/antigravity-cli/issues/76),
[#187](https://github.com/google-antigravity/antigravity-cli/issues/187)).

### Added

- **PTY transport via node-pty** for win32 `agy`/`antigravity` invocations.
  Captures the model response that gets suppressed when stdio is piped.
  Pipe transport remains the default on macOS/Linux.
- **`Invocation.requiresPty`** flag plus `shouldUsePty(binary)` helper with
  `ANTIGRAVITY_FORCE_PIPE=1` / `ANTIGRAVITY_FORCE_PTY=1` env overrides.
- **`server/src/core/ansi.ts`** — `stripAnsi` covers CSI, OSC, SS3,
  single-ESC, DCS, APC, PM, SOS, and C0 control bytes; `extractFinalTuiFrame`
  slices on the strongest `\x1b[2J\x1b[H` reset with cursor-home fallback,
  reverts to the full cleaned stream when a trailing status repaint would
  otherwise truncate the final answer.
- New `runForeground` / `runBackground` dispatchers route to pipe or PTY
  runners based on `invocation.requiresPty`. Pipe path preserved as
  internal `runForegroundPipe` / `runBackgroundPipe`.
- Output-parser tests covering modified-path and rename-target cases.
- ANSI unit tests including a real `agy --print PONG` capture.

### Fixed

- `cli-adapter.ts`: emit the exact detected prompt flag
  (`--prompt` / `--print` / `--message`) instead of hardcoded `--prompt`.
- `process-runner.ts`: redact the prompt value in command-line log output so
  log files no longer contain diff/secret payloads.
- `cli-adapter.ts`: oversized-argv guard now uses `argBudget()` so the test
  rejects on both win32 (28000) and POSIX (120000); the prompt-flag branch
  also rejects under the Windows `CreateProcess` 32k cap with
  quoting-overhead-aware projection.
- `cli-adapter.ts`: `hasRunSubcommand` regex now recognises
  `Commands: run …` and `Usage: agy run …` shapes.
- `process-runner.ts`: secondary SIGKILL timer is cleared on child close to
  prevent PID-reuse races.
- `process-runner.ts`: `killProcessTree` returns the actual
  `taskkill` exit status on Windows.
- `process-runner.ts`: `append()` uses `path.dirname` instead of a
  POSIX-only regex; fixes a latent directory-as-file bug on Windows.
- `output-parser.ts`: `gitChangedFiles` no longer strips the first character
  of modified paths (`pps/...` → `apps/...`). Added rename support.
- PTY+stdin path forces `requiresPty: false` because ConPTY cannot signal
  stdin EOF — stdin-driven prompts stay on pipe transport.
- `extractFinalTuiFrame` falls back to the full stripped output when the
  tail after the last `\x1b[H` is suspiciously empty, defending against
  trailing status-line repaints.
- `pty.spawn` is wrapped in `try/catch`; sync spawn failures surface as a
  failed `RunResult` instead of throwing through the promise chain.

### Notes

- `node-pty` is required for the PTY transport. The plugin lazy-loads it
  and falls back to pipe transport with a clear log message if the native
  prebuild is missing.
- Two `agy` 1.0.3 limitations remain upstream: encrypted conversation `.pb`
  files (cannot be parsed without Google's keys) and no Windows wheel for
  the official `google-antigravity` Python SDK.

## 0.1.0

- Initial Antigravity inside Claude Code plugin.
- Added namespaced slash skills.
- Added dependency-light stdio MCP server.
- Added doctor/setup, review, adversarial review, delegate, execute-tasks,
  verify-plan, status, result, and cancel tools.
- Added local job store, logs, artifacts, timeout, cancellation,
  redaction, and worktree isolation support.
