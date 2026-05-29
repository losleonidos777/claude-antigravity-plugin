---
description: Ask Google Antigravity CLI for a read-only second-opinion review of the current git diff. Use when the user asks for Antigravity review, Gemini-style review, cross-model review, or a second opinion on code changes.
disable-model-invocation: true
allowed-tools: mcp__antigravity__antigravity_review Bash(git status *) Bash(git diff *)
argument-hint: "[focus text]"
---

# Antigravity Review

Run a read-only Antigravity review of the current repository changes.

User focus:

$ARGUMENTS

Procedure:
1. Optionally inspect `git status --short` and `git diff --stat` for context.
2. Call `antigravity_review` with target `working-tree` and mode `readonly`.
3. If the user provided focus text, pass it as `focus`.
4. Summarize findings by severity.
5. Do not apply changes automatically.
6. Ask which findings to address.
