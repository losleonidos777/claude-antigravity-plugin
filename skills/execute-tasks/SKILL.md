---
description: Ask Antigravity CLI to execute a markdown task list from a file or pasted checklist under Claude supervision. Use when the user wants Antigravity to work through TODOs, implementation checklists, migration steps, or task-list documents.
disable-model-invocation: true
allowed-tools: Read mcp__antigravity__antigravity_execute_tasks
argument-hint: "[task-list-file-or-inline-task-list]"
---

# Antigravity Execute Tasks

Use Antigravity to work through a task list under Claude supervision.

Input:

$ARGUMENTS

Procedure:
1. If `$ARGUMENTS` is a file path, read it.
2. If `$ARGUMENTS` is inline text, use it as task list text.
3. Call `antigravity_execute_tasks` with mode `suggest` unless the user explicitly asks for an isolated worktree.
4. Return the job id and parsed tasks.
5. Explain that Claude will review output before changes are accepted.
