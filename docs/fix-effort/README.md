# Connector Fix Effort — Archive

Working documents from the effort that fixed the four Antigravity-connector bugs
(review/adversarial empty context, worktree stale working state, `changedFiles`
over-reporting, and bad `summary` extraction). Shipped via PR #1 on branch
`fix/worktree-changedfiles-summary`.

These are kept for provenance. The authoritative record of *what changed* lives in
[`../../CHANGELOG.md`](../../CHANGELOG.md) and git history; this directory explains
*why* and *how it was verified*.

| File | What it is |
|------|------------|
| [CONNECTOR_FEEDBACK.md](CONNECTOR_FEEDBACK.md) | Root-cause analysis with `file:line` evidence for the four bugs. Start here. |
| [FIX_TASKLIST.md](FIX_TASKLIST.md) | Task-by-task fix plan (F1–F6) with per-task live-verification status. |
| [TEST_FEEDBACK.md](TEST_FEEDBACK.md) | Consolidated live MCP test results (was `F1/F2/F3_F4_TEST_FEEDBACK.md`). |
| [SESSION_ARCHIVE.md](SESSION_ARCHIVE.md) | Chronological work log + obsolete Codex session-onboarding prompts. |
| [deep-research.md](deep-research.md) | Research prompt + GPT report that informed path-safety / redaction / replay design. |
| Antigravity Connector Fix Strategy Review.docx | Original strategy review (binary). |

> Note: `../../server/...` paths in these documents are relative to the repository root.
