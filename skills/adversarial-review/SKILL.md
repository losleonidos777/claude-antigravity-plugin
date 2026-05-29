---
description: Ask Google Antigravity CLI for a skeptical, adversarial, read-only challenge review. Use when the user wants pressure-testing around race conditions, auth bypasses, data loss, rollback, architecture, hidden assumptions, or high-risk release review.
disable-model-invocation: true
allowed-tools: mcp__antigravity__antigravity_adversarial_review Bash(git status *) Bash(git diff *)
argument-hint: "[risk focus]"
---

# Antigravity Adversarial Review

Run a read-only adversarial Antigravity review.

Risk focus:

$ARGUMENTS

Procedure:
1. Call `antigravity_adversarial_review` with target `working-tree`.
2. Pass any user focus text as `focus`.
3. Emphasize blocker-level defects, unsafe assumptions, security risks, concurrency, data loss, rollback, and simpler safer alternatives.
4. Do not apply changes automatically.
