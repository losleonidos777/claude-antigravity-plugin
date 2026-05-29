---
description: Cancel a running Antigravity CLI background job and update its persistent job state. Use when the user asks to stop, kill, cancel, abort, or terminate an Antigravity delegated task.
disable-model-invocation: true
allowed-tools: mcp__antigravity__antigravity_cancel
argument-hint: "[job_id] [SIGTERM|SIGKILL]"
---

# Antigravity Cancel

Call `antigravity_cancel`.

If `$ARGUMENTS` contains a job id, pass it as `jobId`. Use `SIGTERM` by default unless the user explicitly asks for force kill, then use `SIGKILL`.

Report whether cancellation signal was sent and the previous status.
