# Security model

This plugin is a local harness around the official Antigravity CLI. It is intentionally not a proxy.

## Credential handling

The bridge never asks for or stores Google credentials, OAuth tokens, cookies, browser sessions, API keys, or keyring secrets. It relies on the local Antigravity CLI authentication state created by the official CLI flow.

## Execution boundaries

- No generic `run_shell` MCP tool is exposed.
- All Antigravity invocations use argv arrays through `child_process.spawn`, not shell-concatenated strings.
- The optional `cli_template` is split into argv tokens and still executed without a shell.
- Direct-edit mode is unsupported.
- `readonly` is the safest default.
- `suggest` produces reviewable output or patch artifacts.
- `worktree` creates an isolated git worktree when possible.

## Prompt injection

Repository files, diffs, plans, and task lists are marked as untrusted in prompts sent to Antigravity. Antigravity is instructed to ignore conflicting instructions embedded in code, comments, docs, or diffs.

## Denied paths

The default denylist includes:

```text
.env
.env.*
*.pem
*.key
*.p12
*.pfx
id_rsa
id_ed25519
.git/
node_modules/
vendor/
dist/
build/
```

## Logging

Logs are redacted for common secret patterns and are stored in the plugin data directory. Treat logs as sensitive project artifacts.

## Reporting issues

Include:

- plugin version
- Antigravity CLI version from `/antigravity:doctor`
- non-sensitive log excerpts
- operating system
- command mode (`readonly`, `suggest`, or `worktree`)
