---
description: Delegate a coding investigation or implementation task to Google Antigravity CLI as an external managed background agent. Use when the user asks Antigravity to investigate, fix, implement, compare, rescue, or continue work from Claude Code.
disable-model-invocation: true
allowed-tools: mcp__antigravity__antigravity_delegate
argument-hint: "<task prompt>"
---

# Antigravity Delegate

Delegate the following task to Antigravity:

$ARGUMENTS

Call `antigravity_delegate` with:
- `prompt`: the user's task
- `mode`: `readonly` for investigation only, `suggest` for patch proposals, or `worktree` only when code changes are expected and isolation is desired

Return:
- job id
- initial status
- log path
- how to check status and result

Claude remains the reviewer/merger. Do not apply Antigravity changes automatically.
