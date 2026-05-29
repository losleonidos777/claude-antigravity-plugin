---
description: Check whether Antigravity CLI is installed, authenticated, callable from Claude Code, and usable through the local MCP bridge. Use for troubleshooting agy, antigravity, MCP server, auth, config, and capability issues.
disable-model-invocation: true
allowed-tools: mcp__antigravity__antigravity_doctor
argument-hint: "[--include-help]"
---

# Antigravity Doctor

Call `antigravity_doctor`.

Report:
- binary found or missing
- version
- auth state
- project root
- supported invocation capabilities
- warnings and errors
- next action

Never print secrets. If non-interactive mode is unknown, tell the user to inspect `agy --help` and set the plugin `cli_template` option.
