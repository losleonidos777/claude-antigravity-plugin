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

## File review fallback

Explicit file reviews can embed file contents when Git has no diff for the path,
which makes clean and untracked files reviewable. The fallback is limited to
explicit `target:file` requests and is guarded before content reaches the prompt:

- the path must resolve inside the project root;
- null-byte paths and Windows reserved device names are rejected;
- symlinks are not embedded;
- paths whose real path escapes the project root are rejected;
- binary-looking and oversized files are skipped;
- common token and credential patterns are redacted.

If a broad working-tree or staged review has no diff, the tool returns
`status: "skipped"` instead of dumping unrelated untracked files.

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
