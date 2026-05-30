# Deep Research Prompt: Antigravity Connector Fix Strategy Review

Use this prompt in OpenAI GPT deep research and Gemini deep research.

## Role

You are a senior TypeScript/Node.js engineer and MCP integration reviewer. Validate the fix strategy for a Claude Code MCP plugin that delegates code review and coding tasks to a local `agy` CLI. Use official documentation first, then high-quality community experience where official docs are silent.

## Repository Context

Project: `claude-antigravity-plugin`

The server is a TypeScript stdio MCP server. Source lives in `server/src/**`; compiled runtime lives in `server/dist/**`.

Important files:

- `server/src/core/prompt-builder.ts`
- `server/src/tools/review.ts`
- `server/src/schemas/jobs.ts`
- `server/src/core/worktree.ts`
- `server/src/core/output-parser.ts`
- `server/src/tools/common.ts`
- `server/src/tools/result.ts`

Current F1 fix:

- `collectGitContext(projectRoot, target, ref)` now returns `{ text, hasContent }`.
- For `target:"file"` with `ref`, it runs `git diff -- <ref>`.
- If the diff is empty, it reads the actual file contents and embeds them under `## File contents (no diff; reviewing full file)`.
- File embedding is scoped only to explicit file targets, not bare working-tree/staged targets.
- It sniffs the first 8KB for NUL bytes and refuses binary files.
- It refuses very large files rather than dumping them.
- `hasContent` is true only for successful non-empty diff stdout or resolved file content, not git stderr.
- `antigravity_review` and `antigravity_adversarial_review` fast-fail with `status:"skipped"` when no reviewable content exists.
- Review prompts instruct the agent to review supplied context only and not search the filesystem for reviewed files.

Remaining planned fixes:

- F2: worktree mode must reproduce full user working state: committed HEAD + tracked dirty changes + untracked non-ignored files; warnings must be surfaced.
- F3: `changedFiles` must be computed from a launch baseline, not raw `git status --short`.
- F4: summary extraction must parse structured summary/verdict instead of using the first stdout line.
- F5: add regression tests.
- F6: full live sweep and acceptance checklist.

## Bugs Being Fixed

1. Review/adversarial review timed out on untracked or clean files because `git diff` was empty and no file content was supplied.
2. Worktree jobs were blind to untracked files and dirty tracked files because `git worktree add ... HEAD` creates a clean committed checkout.
3. `changedFiles` reported pre-existing dirty files because it used raw `git status --short` without a baseline.
4. `summary` used the first agent narration line instead of the real final summary/verdict.

## Research Questions

Please research and answer:

1. Git behavior:
   - Does `git diff -- <path>` intentionally omit untracked files?
   - What is the recommended way to discover untracked non-ignored files?
   - What are best practices for safely copying untracked files into an isolated worktree?
   - What are the edge cases for `git diff HEAD --binary` and `git apply` when replaying staged plus unstaged tracked changes?

2. MCP/tool design:
   - Is an immediate tool response with `status:"skipped"` appropriate for an empty-context tool call?
   - Should skipped be a persisted job status, a response-only status, or both?
   - What return-shape stability expectations should MCP tools follow?

3. Prompt/context strategy:
   - Is embedding full file contents for explicitly scoped file review a good strategy when no diff exists?
   - What guardrails are recommended for binary files, large files, path traversal, and secret redaction?
   - Is it reasonable to fast-fail bare working-tree review when there is no diff and only unrelated untracked files?

4. Worktree strategy:
   - Compare options: copying untracked files, applying `git diff HEAD --binary`, using temporary commits/stash, or not using worktrees.
   - Which approach best preserves user expectations while avoiding silent fabrication or modification of the main tree?
   - What warning semantics should be exposed if copying/applying fails or skips files?

5. Changed-files strategy:
   - Evaluate path-only baseline set difference from `git status --short`.
   - Identify false negatives/false positives, especially already-dirty files modified again, renames, ignored files, deleted files, and removed worktrees.
   - Recommend whether path-only is acceptable for this bug fix or whether status-code/content-hash baselines are needed.

6. Summary extraction:
   - Recommend robust parsing order for agent output containing markdown, fenced JSON, headings, trailing boilerplate, and logs.
   - Identify pitfalls with JSON block extraction and LLM narration.

## Requested Output

Return:

1. Verdict: GO, GO WITH CHANGES, or STOP.
2. A risk-ranked list of issues in the current F1 strategy.
3. Concrete recommendations for F2-F6 before implementation.
4. Any official documentation links used.
5. Any community evidence links used, clearly marked as community/non-authoritative.
6. A short checklist we can apply to this repo before opening the PR.

Please cite sources with links. Prioritize official Git, Node.js, MCP, and TypeScript documentation when possible.
