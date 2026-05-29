---
description: Retrieve the final stored output, changed files, patch path, log path, and worktree branch for an Antigravity CLI job. Use when the user asks for Antigravity result, logs, output, patch, or completed delegated task details.
disable-model-invocation: true
allowed-tools: mcp__antigravity__antigravity_result
argument-hint: "[job_id] [--raw]"
---

# Antigravity Result

Call `antigravity_result`.

If `$ARGUMENTS` contains a job id, pass it as `jobId`. If it contains `--raw`, set `includeRaw` to true.

Summarize:
- status
- result markdown
- changed files
- patch path if any
- log path
- worktree path and branch if any

Do not apply changes automatically.
