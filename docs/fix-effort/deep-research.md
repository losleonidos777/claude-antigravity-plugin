# Deep Research: Antigravity Connector Fixes

The research prompt followed by the GPT-generated report that informed the
fix design (path safety, secret redaction, worktree replay strategy).

# ===== Research prompt =====

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


# ===== Research report (GPT) =====

# Antigravity Connector Fix Strategy Review

## Verdict

**GO WITH CHANGES.** Based on the repository context you supplied, the F1 direction is correct: Git does in fact treat untracked files as a separate state from the tracked diff, and MCP supports stable, structured non-error tool results for cases where a tool ran successfully but had nothing useful to review. The main condition is that the implementation must verify a few sharp edges before merge: if the command literally uses `git diff -- <ref>` for a file review, that is wrong, because Git parses arguments *after* `--` as pathspecs, not revisions; the safe shape is `git diff <ref> -- <path>`. Assuming that is just shorthand in your writeup and not the actual code, I would proceed, but I would not open the PR until F2-F4 are designed as one bundle and F1 has explicit path/symlink/secret/schema guardrails. citeturn34view2turn6view4turn35view0turn13view3

The reason this is **GO WITH CHANGES**, not an unconditional **GO**, is that the remaining bugs are not cosmetic. Worktree replay, changed-files attribution, and summary extraction are all correctness issues that affect what the delegated agent actually sees and what the host reports back to users. MCP’s current tool model is flexible enough to support your approach, but it rewards strong schemas and clear terminal-state semantics, and Git’s worktree/apply behavior has enough edge cases that you should make those choices deliberately rather than “just patching until the tests pass.” citeturn35view0turn12view3turn29view2turn27view0

## Git behavior and what it implies for the bugs

`git diff -- <path>` intentionally omits untracked files. Git’s own documentation defines `git diff` as comparing the working tree, index, and commits; it does not describe untracked files as part of the diff. In contrast, `git status` explicitly reports untracked paths separately as `??`, and `git ls-files -o` explicitly defines `--others` as “show other (i.e. untracked) files.” So the empty diff behavior you saw on untracked files is expected Git behavior, not a corner-case bug in Git. citeturn34view2turn6view4turn7view0

For discovering **untracked, non-ignored** files, the most direct machine-oriented command is `git ls-files -o --exclude-standard -z`. Git documents `-o/--others` as untracked-file discovery and recommends `--exclude-standard` when you want porcelain-like ignore behavior. `git status --porcelain=v2 -z` is also viable, especially if you want one unified snapshot of tracked and untracked state, but `ls-files -o --exclude-standard -z` is the cleanest primitive for the copy-untracked-files part of F2. The `-z` option matters: Git’s docs are explicit that without it, unusual pathnames may be quoted, while with `-z` pathnames are emitted literally and NUL-terminated. citeturn7view0turn7view2turn8view2turn6view2

For **safely copying** those untracked files into an isolated worktree, the safest pattern is: enumerate with Git, parse NUL-terminated paths, resolve each path against the repository root, reject anything that escapes the root, create parent directories explicitly, and treat symlinks as a distinct case rather than blindly dereferencing them. Node’s `path.resolve()` and `path.normalize()` compute canonical-looking paths, but they do not themselves enforce repository containment; Node’s `lstat()` is the right primitive when you need to tell whether a path is a symlink. OWASP’s path traversal guidance is directly relevant here because any feature that reads or copies a path derived from user or model input needs containment checks, not just string normalization. citeturn16view5turn16view6turn16view4turn17search0

For replaying tracked changes into a fresh worktree, `git diff HEAD --binary` is a strong base because Git explicitly says `--binary` emits a binary diff that can be applied with `git apply`. But there are four important edge cases. First, Git also documents that `--textconv` output is for human consumption and “cannot be applied,” so patch generation should disable textconv. Second, Git allows external diff drivers, so patch generation should disable those too. Third, `git apply --check` should be used before the actual apply. Fourth, `git apply --index` is stricter than many people expect: it requires the index and working tree copies to match and errors even when the same patch would apply to each independently. That makes `--index` a poor default if your goal is to reconstruct an isolated worktree’s visible file contents rather than recreate the staging area exactly. citeturn34view2turn23view0turn29view0turn29view2

One subtle but important inference follows from Git’s own definitions: `git diff HEAD` is the diff from **HEAD to the current working tree**, which means it captures the *net* tracked file contents users are looking at, including both staged and unstaged changes, but it does **not** preserve which hunks were staged versus unstaged in partially staged files. For your stated F2 goal — “committed HEAD + tracked dirty changes + untracked non-ignored files” — that is probably acceptable. If you later decide that preserving stage split matters, patch replay alone is not enough. citeturn34view2turn29view2

Submodules are another real edge case, not a hypothetical one. Git documents that diff generation may ignore submodule worktree changes depending on `--ignore-submodules` and configuration, and `git apply` treats submodule patches specially: with `--index`, submodule commits must match exactly; without `--index`, submodule commit changes in the patch are ignored and only directory presence is checked. That means any F2 implementation should surface submodule reproduction as “best effort with warnings,” not silently assume parity. citeturn23view0turn23view2

## MCP behavior and prompt/context design

An immediate tool response with `status: "skipped"` is appropriate for an empty-context tool call **if** you model it as a successful tool invocation that found no reviewable material, rather than as a protocol failure. MCP is clear that protocol errors are for things like unknown tools or malformed requests, while tool-execution problems belong in the tool result. MCP is also clear that tool results may contain `structuredContent`, and servers may define an `outputSchema` for that structure. In other words, a domain-level result like `{ status: "skipped", reason: "no_reviewable_content" }` is a normal MCP pattern. I would keep `isError: false` for this case and reserve `isError: true` for actual invalid input, agent failure, or business-logic failure. citeturn35view0turn13view3

On persistence, I would separate **domain job status** from **MCP task status**. If you have your own internal job table, persisting `skipped` is fine and likely useful for auditability and UX. But if you expose that lifecycle through the MCP Tasks model, the official task statuses are `working`, `input_required`, `completed`, `failed`, and `cancelled`; there is no `skipped` task state. In that model, the right representation is: task status `completed`, final `CallToolResult.structuredContent.status = "skipped"`. That preserves both MCP compliance and your domain semantics. citeturn14view0turn37view0

Return-shape stability matters more than the specific word “skipped.” MCP’s tools spec says that if a tool provides an `outputSchema`, servers **must** return structured results that conform to it, and for backward compatibility a tool that returns structured content **should** also include the serialized JSON in a text block. That argues strongly for formalizing one stable result object across all review tools and all endings — success, skipped, partial, failed — instead of letting these branches drift. citeturn35view0turn12view1

Embedding full file contents for **explicitly scoped file review** when there is no diff is a good strategy. The user has already narrowed the scope to a concrete file, so the tool is not inventing context; it is substituting the only reviewable material available. Anthropic’s own prompt guidance supports this style of explicit context delimiting and recommends structured tags or clearly separated context blocks for complex prompts and long-context tasks. I would keep the fallback limited to explicit file targets, exactly as you described, and I would **not** extend it to bare working-tree or staged review. For those modes, fast-failing when there is no diff is reasonable because Git’s tracked diff semantics do not make the untracked-file set part of the same contract. citeturn20view1turn20view2turn34view2turn6view4

The main guardrails I would insist on before merge are path containment, symlink policy, binary handling, large-file policy, and secret redaction. MCP’s tools spec says servers must validate inputs and sanitize outputs. OWASP’s secrets guidance says secrets should never be logged in plaintext, and its path-traversal guidance remains the right mental model for any file-embedding feature. So when you embed a file in a review prompt, the safe default is: resolve-inside-repo only, redact known-secret patterns before sending to the model or logs, reject or warn on unsupported binary/symlink cases, and make the size cutoff explicit in both code and user-visible warnings. citeturn21view3turn17search1turn17search0

## Worktree strategy

Of the four broad options you listed, the best fit for your goals is **fresh worktree + tracked patch replay + untracked non-ignored file copy**. Git’s own `worktree` documentation presents linked worktrees as the way to avoid disturbing an already messy main tree. That maps closely to your plugin’s responsibility: preserve user expectations while isolating the delegated `agy` run from the primary checkout. citeturn28view0turn28view2

Using **no worktree** would maximize fidelity, but it would do so by letting the delegated agent work inside the user’s main checkout. That is the simplest implementation and, in my judgment, the worst product decision here, because it directly violates the isolation guarantee you appear to want and makes accidental edits or cleanup side effects much more dangerous. Git’s own worktree example exists precisely for the “do not disturb the messy current tree” use case. citeturn28view0turn28view2

Using **stash or temporary commits** can restore state, but they are more invasive than they look. `git stash push -u` does capture untracked files, and `git stash branch` is valuable because Git says it restores the originally stashed state on the commit where the stash was created, often avoiding conflicts. But stash-based workflows still mutate the user’s index/worktree/stash state or create extra history objects and are therefore harder to justify for a background agent tool that should avoid silent main-tree mutation. Temporary commits have the same product smell, plus cleanup complexity. citeturn4view1turn24view1

The mixed strategy avoids that. For tracked files, generate an applyable patch from the launch point with something equivalent to `git diff --binary --no-ext-diff --no-textconv HEAD --`, run `git apply --check` in the fresh worktree, then apply it for real. For untracked files, enumerate with `git ls-files -o --exclude-standard -z` and copy them one by one under path/symlink/size/binary guards. That reproduces **committed HEAD + visible tracked modifications + visible untracked non-ignored files** without altering the main tree. The main caveat, again, is that partially staged paths lose their staged/unstaged split; only the final working-tree content is reproduced. citeturn34view2turn23view0turn29view0turn7view2

Warning semantics should be explicit and machine-readable. I would treat **tracked patch failure** as a hard failure or at least `partial` with a loud warning, because otherwise you risk fabricating a cleaner environment than the user actually had. I would treat **untracked-copy failures** as recoverable but visible: list every skipped/copied-failed path, plus a reason code such as `ignored`, `binary`, `large`, `symlink_external`, `path_outside_repo`, or `copy_failed`. I would also surface a dedicated warning for submodule state not being fully reproduced, since Git makes that behavior special. citeturn29view0turn23view2turn35view0

One more operational recommendation is worth making explicit: if your plugin creates longer-lived worktrees, use Git’s native locking model and be conservative about cleanup. Git says a locked worktree cannot be moved or deleted, and community reports from both Anthropic Claude Code and OpenAI Codex show that untracked-only worktrees are common during active pre-commit development and easy for tooling to misclassify as disposable. That is exactly the kind of silent footgun you want to avoid. citeturn27view0turn27view3turn25view0turn25view1

## Changed-files strategy and summary extraction

For F3, a **path-only launch-baseline set difference** is a legitimate *narrow bug fix*, but it is not a full attribution solution. Git explicitly says the default long `status` output is human-oriented and subject to change, while porcelain v1/v2 are the stable scripting formats. So if you keep a baseline, it should be captured from `git status --porcelain=v2 -z`, not raw human text. citeturn6view1turn6view2turn8view2

If your baseline algorithm is simply “current changed paths minus baseline changed paths,” it will correctly suppress the false positive where a file was already dirty before the job and remained dirty afterward without being touched. But it has a serious **false negative**: if a file was already dirty at launch and the agent modifies it again, the path is present in both snapshots and disappears from the set difference. It also misses paths that were created and then removed during the run, and it can blur rename/source semantics unless you parse Git’s NUL-safe rename records carefully. Git’s porcelain v2 and diff formats provide enough metadata to parse this cleanly, but a path-only end-state diff still cannot answer “was this already-dirty file modified again?” because it does not measure content transitions. citeturn6view2turn8view0turn22view2turn34view1

My recommendation is: if F3’s scope is truly “stop reporting unrelated pre-existing dirty files,” then path-only baseline is acceptable **for this PR** as long as you document the limitation. If `changedFiles` is user-visible, used for follow-on actions, or expected to represent agent-attributed edits, go one step further now. The minimal robust extension is to baseline a **content signature** for all already-dirty tracked files and untracked files at launch. Git’s `hash-object --no-filters` is a good primitive for that because it hashes the content “as is,” without attribute-driven filters changing the result. Porcelain v2 already gives you rich state for tracked entries, but it still does not give you a direct working-tree content hash for the file on disk, which is why an explicit content signature matters for the “dirty before and dirty after” case. citeturn31search0turn6view2

For F4, the first-line heuristic should be retired. Anthropic’s current guidance is unambiguous on the general principle: if you need reliable downstream parsing, specify the output format precisely, and if you need guaranteed schema conformance, use structured outputs rather than relying on prompt-only formatting. The most robust parsing order here is: first consume strict structured output if `agy` can emit it; otherwise parse the **last** complete fenced JSON block that matches your schema; otherwise parse explicit tagged blocks such as `<summary>` / `<verdict>`; otherwise parse the last dedicated markdown section heading from the end of stdout upward; and only then fall back to a synthesized summary, marked in metadata as a fallback. citeturn33view0turn33view1

The important parser pitfalls are the obvious ones that keep breaking agent integrations: the first stdout line is often narration, not the final answer; the first fenced JSON block may be an example or a tool log; naive brace-matching will happily ingest partial JSON from logs or stack traces; and trailing boilerplate can appear after the actual final summary. Structured output or an explicit sentinel block solves most of this. If `agy` cannot guarantee structured output, design the prompt so the machine-readable footer is the **last** artifact emitted and validate it before trusting it. citeturn33view0turn33view1

## Risk-ranked issues in the current F1 strategy

The current F1 design is mostly sound, but I would rank the remaining risks this way:

- **Highest risk — verify the Git command shape.** If the implementation literally places `ref` after `--` in a `git diff` invocation, Git will treat it as a pathspec, not a revision. That is a correctness blocker, not a polish issue. citeturn34view2

- **High risk — file fallback needs containment and redaction guardrails.** Once you move from diff-only context to embedding file contents, you are now reading arbitrary repo paths into prompts and possibly logs. That requires repo-root enforcement, symlink handling, size limits, and secret masking. MCP and OWASP both point in that direction. citeturn21view3turn17search0turn17search1

- **Medium risk — NUL-byte sniffing is useful but heuristic.** Git’s own diff machinery has concepts like textconv, diff drivers, binary patches, and binary/stat reporting; a first-8KB NUL sniff is a reasonable safety gate, but it can disagree with Git’s effective diffability rules. I would keep it, but I would not rely on it as the sole classifier. citeturn23view0turn34view0turn34view2

- **Medium risk — skipped/result-schema semantics are not formalized enough yet.** The strategy is correct in spirit, but without a stable `outputSchema`, skipped, partial, success, and failure can drift into slightly different shapes that break clients later. MCP explicitly rewards schema stability here. citeturn35view0turn13view3

- **Medium risk — bare working-tree review UX may still surprise users.** Failing fast when there is no diff is reasonable, but only if the tool clearly explains that untracked files are outside tracked-diff semantics and points users to explicit file review or worktree mode. Otherwise it will look like the tool “missed files.” citeturn6view4turn7view0

## Concrete recommendations for F2 through F6

For **F2**, implement the mixed replay model deliberately, not implicitly. Capture tracked state with an applyable patch from HEAD using `--binary --no-ext-diff --no-textconv`, validate with `git apply --check`, then apply. Enumerate untracked non-ignored files with `git ls-files -o --exclude-standard -z` and copy them under repo-containment, symlink-aware, size-aware rules. Treat submodules and any failed replay as warnings or partial results, never as silent success. citeturn34view2turn23view0turn29view0turn7view2turn23view2

For **F3**, capture a launch baseline in `--porcelain=v2 -z`, not raw human status output. If you need the narrowest possible fix, use end-state path-set diff and document that it suppresses pre-existing dirty-file false positives but may miss “modified-again” dirty paths. If you want the result to be dependable for users or automation, add content signatures for already-dirty tracked files and untracked files at launch, using something equivalent to `git hash-object --no-filters` or a regular file hash outside Git. citeturn6view1turn6view2turn31search0

For **F4**, change the `agy` contract before changing the parser. Ask for a final machine-readable block with a tiny schema — for example `verdict`, `summary`, `key_findings`, `warnings` — and require it to be the last emitted artifact. If `agy` supports strict structured outputs, use them; if not, force a final fenced JSON block and parse only that validated block. The parser should record where it found the summary, so you can tell “structured” from “fallback” at runtime. citeturn33view0turn33view1

For **F5**, add regression coverage for the cases that motivated the fixes, plus the cases most likely to break later: explicit clean tracked file review, explicit untracked file review, explicit binary file review, explicit very-large-file review, bare working-tree review with only unrelated untracked files, tracked dirty replay, partially staged tracked file replay, rename, delete, path-with-spaces/newlines handling, and submodule state warnings. Git’s stable `-z` and porcelain formats exist specifically to make these cases scriptable. citeturn8view2turn6view2turn34view1

For **F6**, do a live sweep that validates user-visible semantics, not just command success. The acceptance criteria should include: no-reviewable-content returns `skipped` immediately; explicit file fallback never reads outside the repo; worktree jobs see tracked dirty state and untracked non-ignored files; changed-files attribution excludes unrelated pre-existing dirty paths; summaries come from structured output, not narration; and cleanup never force-removes a worktree that is locked or visibly active only because it has untracked files. citeturn35view0turn27view0turn25view1

## Official documentation links used

The most important official sources for this review were Git’s `git-diff`, `git-status`, `git-ls-files`, `git-apply`, `git-worktree`, `git-stash`, `git-hash-object`, and `git-add` documentation. Those sources are what support the analysis of untracked-file omission, patch replay, worktree isolation, stash behavior, machine-parseable status output, and content-signature baselining. citeturn34view2turn6view2turn7view2turn29view0turn27view0turn24view1turn31search0turn30search0

For MCP behavior, I relied on the official MCP Tools specification, Schema reference, 2025-11 Tasks documentation, and the newer Tasks Extension SEP. Those sources support the recommendations on `structuredContent`, `outputSchema`, `isError`, synchronous vs task-backed results, and why `skipped` should remain a domain result instead of a task lifecycle status. citeturn35view0turn13view3turn14view0turn37view0

For prompt and parser design, the official Anthropic docs on prompting best practices, structured outputs, and increasing output consistency were the main references. For filesystem guardrails, I used official Node.js `fs`, `path`, and `child_process` docs, together with OWASP’s Path Traversal and Secrets Management guidance. citeturn20view1turn33view0turn33view1turn16view4turn16view5turn16view0turn17search0turn17search1

## Community evidence and short PR checklist

The most relevant non-authoritative evidence I found was: an Anthropic Claude Code feature request asking for configurable copying of untracked files into worktrees because local config files are often essential in practice; an OpenAI Codex issue showing that worktrees containing only untracked files may still be actively in use and should not be treated as abandoned; and a Stack Overflow thread confirming the practical behavior that `git diff HEAD` shows staged and unstaged tracked changes together but still omits untracked files unless they are first added or marked intent-to-add. Those are not substitutes for Git’s manuals, but they are strong signals about real operator expectations. citeturn25view0turn25view1turn26view0

Before opening the PR, I would apply this checklist:

- Verify the explicit-file ref diff command is `git diff <ref> -- <path>`, not `git diff -- <ref>`. citeturn34view2
- Add an `outputSchema` and return one stable result shape for `ok`, `skipped`, `partial`, and `failed`, with backward-compatible text serialization. citeturn35view0turn12view1
- Implement F2 with applyable tracked patch replay plus `git ls-files -o --exclude-standard -z` for untracked-copy enumeration, and make all skip/failure cases explicit warnings. citeturn29view0turn7view2
- Enforce repo-root containment, symlink-aware handling, size caps, and secret masking before any file-content embedding. citeturn16view4turn16view5turn17search0turn17search1
- Capture F3 baselines from `git status --porcelain=v2 -z`, and decide explicitly whether end-state path diff is enough or whether already-dirty files need content signatures. citeturn6view2turn31search0
- Replace first-line summary extraction with validated structured output or a final fenced JSON footer, and record whether each parsed summary came from structured or fallback extraction. citeturn33view0turn33view1