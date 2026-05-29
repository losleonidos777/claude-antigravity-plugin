---
description: Ask Antigravity CLI to verify a plan, tracker, migration proposal, or previous Claude output without editing code. Use for feasibility checks, sequencing risks, missing dependencies, test coverage, rollback paths, and cross-model verification.
disable-model-invocation: true
allowed-tools: Read mcp__antigravity__antigravity_verify_plan
argument-hint: "[plan-file-or-inline-plan]"
---

# Antigravity Verify Plan

Verify a plan or prior output read-only.

Input:

$ARGUMENTS

Procedure:
1. If input is a file path, read it and pass it as `planText` or pass `planPath`.
2. If input is inline text, pass it as `planText`.
3. Call `antigravity_verify_plan`.
4. Summarize blocking risks, non-blocking risks, and suggested plan changes.
5. Do not edit files.
