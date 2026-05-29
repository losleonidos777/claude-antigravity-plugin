# Official-source implementation notes

Sources consulted during v0.1 construction:

- Claude Code plugin docs: plugins are directories with `.claude-plugin/plugin.json`; plugin skills are namespaced; plugin roots may include `skills/`, `agents/`, `hooks/`, `.mcp.json`, monitors, and other components.
- Claude Code plugin reference: plugin MCP servers are configured through `.mcp.json` or inline manifest data; `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, and `${CLAUDE_PROJECT_DIR}` are supported path variables; `userConfig` values can be substituted into MCP server config.
- Claude Code skills docs: `SKILL.md` supports YAML frontmatter, `$ARGUMENTS`, tool allowlists, and `disable-model-invocation` for explicit user-triggered workflows.
- MCP Inspector docs: local servers can be inspected with `npx @modelcontextprotocol/inspector node path/to/server/index.js`.
- Google Antigravity CLI official repo and docs links: Antigravity CLI is a terminal-first interface over the shared Antigravity agent engine, authenticates through the system keyring with browser fallback, and carries AI-agent security risks including autonomous code execution, data exfiltration, prompt injection, and supply-chain risks.
- Google Developers migration post: Antigravity CLI became available on May 19, 2026; key Gemini CLI concepts such as Agent Skills, Hooks, Subagents, and Extensions migrate to Antigravity plugins; feature parity was not guaranteed immediately.
- openai/codex-plugin-cc: UX reference for `/review`, `/adversarial-review`, background delegation, `/status`, `/result`, `/cancel`, and reuse of local CLI authentication rather than proxying credentials.

Design consequence: this bridge is capability-driven. It refuses to guess a destructive or interactive command line. If `agy --help` does not expose a non-interactive prompt method, the user must set `cli_template`, e.g. `run --prompt-file {prompt} --json` after verifying it against their installed CLI version.
