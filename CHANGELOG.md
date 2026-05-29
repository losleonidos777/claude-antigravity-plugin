# Changelog

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
