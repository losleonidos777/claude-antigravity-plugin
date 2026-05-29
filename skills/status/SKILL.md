---
description: Show running and recent Antigravity CLI delegated jobs for the current Claude Code project. Use when the user asks for Antigravity status, progress, background jobs, or whether a delegated task is still running.
disable-model-invocation: true
allowed-tools: mcp__antigravity__antigravity_status
argument-hint: "[job_id]"
---

# Antigravity Status

Call `antigravity_status`.

If `$ARGUMENTS` contains a job id, pass it as `jobId`; otherwise list recent jobs for this repository.

Report job id, kind, status, start/update time, pid if present, and result command.
