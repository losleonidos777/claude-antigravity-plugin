---
description: Set up and validate the Antigravity CLI bridge inside Claude Code. Use when the user asks to configure Antigravity, check installation, login, non-interactive invocation, MCP connectivity, or first-run setup.
disable-model-invocation: true
allowed-tools: mcp__antigravity__antigravity_setup
argument-hint: "[--include-help]"
---

# Antigravity Setup

Call `antigravity_setup`.

Report:
- binary path and version
- authentication state without printing credentials
- project root and git state
- non-interactive capability status
- exact next actions

Do not store Google credentials or ask the user to paste tokens.
