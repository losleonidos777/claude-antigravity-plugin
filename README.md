# Antigravity plugin for Claude Code

Use Google Antigravity CLI from inside Claude Code for read-only reviews, adversarial reviews, delegated background jobs, task-list execution, and plan verification.

This package follows the same mental model as `openai/codex-plugin-cc`, but delegates to the local `agy` / `antigravity` CLI instead of Codex.

## What you get

- `/antigravity:setup`
- `/antigravity:doctor`
- `/antigravity:review`
- `/antigravity:adversarial-review`
- `/antigravity:delegate`
- `/antigravity:execute-tasks`
- `/antigravity:verify-plan`
- `/antigravity:status`
- `/antigravity:result`
- `/antigravity:cancel`

## Architecture

```text
Claude Code slash skill
  -> plugin-bundled stdio MCP server
    -> local Antigravity CLI process
      -> local Google/Antigravity auth state from OS keyring / CLI session
```

This is not an Anthropic-compatible proxy and does not store Google cookies, OAuth tokens, API keys, or browser sessions.

## Requirements

- Claude Code with plugin support
- Node.js 20+
- Antigravity CLI installed as `agy` or `antigravity`
- A local Antigravity/Google login already configured through the official CLI flow
- A non-interactive Antigravity CLI invocation mode
- `node-pty` (auto-installed as a server dependency). On Windows it requires Windows 10
  build 17763+ for ConPTY support; older systems fall back to `winpty`. If the native
  prebuild is missing for your Node version, the plugin transparently falls back to the
  pipe transport.

The bridge auto-detects supported invocation flags by checking:

```bash
agy --version
agy --help
agy run --help
agy auth --help
agy plugin --help
```

Because Antigravity CLI is new and feature parity with Gemini CLI is evolving, the bridge is capability-driven instead of hard-coding one command shape. If your installed CLI does not expose a prompt flag, set the plugin `cli_template` option after verifying the command manually, for example:

```text
run --prompt-file {prompt} --json
```

The template is split into argv tokens and executed without a shell. `{prompt}` is replaced by the generated prompt file path.

## Local development

```bash
cd claude-antigravity-plugin/server
npm run build
npm test
node dist/index.js --doctor
```

Test the plugin in Claude Code:

```bash
claude --plugin-dir ./claude-antigravity-plugin
/plugin validate
/antigravity:setup
/antigravity:doctor
```

Inspect the MCP server directly:

```bash
npx @modelcontextprotocol/inspector node server/dist/index.js
```

## Usage

### Review current diff

```text
/antigravity:review
/antigravity:review focus on auth bypasses and rollback safety
```

The review tool is read-only. It collects git status and diff, marks repository content as untrusted, asks Antigravity for structured findings, and returns parsed findings plus log/artifact paths.

### Adversarial review

```text
/antigravity:adversarial-review look for race conditions and unsafe caching assumptions
```

This uses a stricter prompt that tries to disprove correctness rather than comment on style.

### Delegate work

```text
/antigravity:delegate Investigate why packages/api tests intermittently fail
/antigravity:status
/antigravity:result <job_id>
/antigravity:cancel <job_id>
```

Modes:

- `readonly`: investigation only
- `suggest`: Antigravity may propose a patch artifact; Claude/user applies manually
- `worktree`: Antigravity runs in an isolated git worktree when possible
- `direct-edit`: intentionally unsupported

### Execute a task list

```text
/antigravity:execute-tasks docs/task-list.md
```

The bridge parses markdown checkboxes/headings/numbered items into task states and starts a managed background job.

### Verify a plan

```text
/antigravity:verify-plan plans/refactor-auth.md
```

Antigravity verifies feasibility, missing dependencies, sequencing risks, migration risks, test coverage, and rollback path without editing files.

## Job store

Job state, logs, prompts, patches, and worktrees are stored under `${CLAUDE_PLUGIN_DATA}` when Claude Code provides it, otherwise under:

```text
~/.claude/plugins/data/antigravity/
```

Per-project state is keyed by a hash of `CLAUDE_PROJECT_DIR`.

## Transport selection (PTY vs pipe)

Antigravity CLI 1.0.3 on Windows suppresses stdout when stdio is piped — confirmed by
upstream issues [google-antigravity/antigravity-cli#76](https://github.com/google-antigravity/antigravity-cli/issues/76)
and [#187](https://github.com/google-antigravity/antigravity-cli/issues/187). To capture
the model response, this plugin spawns `agy` under a pseudo-terminal (`node-pty` / ConPTY)
on Windows by default. macOS and Linux use the plain pipe transport. Output is ANSI-stripped
and the final TUI frame extracted before the response is returned to Claude Code.

Overrides:

| Env var                     | Effect                                                    |
|-----------------------------|-----------------------------------------------------------|
| `ANTIGRAVITY_FORCE_PIPE=1`  | Disable PTY transport even on Windows (debugging).        |
| `ANTIGRAVITY_FORCE_PTY=1`   | Enable PTY transport on non-Windows hosts.                |

The transport choice is also visible per job in the log file:
`[antigravity-bridge] transport=pty (node-pty)` or `transport=pipe`.

## Safety model

- No credential storage
- No raw shell passthrough MCP tool
- No direct-edit mode by default
- CLI arguments are passed as arrays, never shell-concatenated
- Logs are redacted for common token/secret patterns
- Denied paths include `.env`, private keys, `.git/`, `node_modules/`, `vendor/`, `dist/`, and `build/`
- Repository files and diffs are labelled as untrusted input in prompts
- Write-capable work happens in `suggest` artifacts or isolated worktrees

## Known limitations

- Antigravity CLI's non-interactive command surface may differ by version. Run `/antigravity:doctor` first.
- If doctor cannot prove non-interactive support, configure `cli_template`.
- Background jobs update state while the MCP server process remains alive. If Claude Code restarts mid-job, `/antigravity:status` reconciles stale running states by checking PID liveness and log/result markers.
- Worktree mode requires a git repository and enough local permissions to create a worktree.

## Repository layout

```text
.claude-plugin/plugin.json
.mcp.json
skills/*/SKILL.md
agents/*.md
hooks/hooks.json
server/src/**
server/dist/**
references/**
scripts/**
```
