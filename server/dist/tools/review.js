import { buildReviewPrompt, collectGitContext } from "../core/prompt-builder.js";
import { parseReview, readResult } from "../core/output-parser.js";
import { getProjectRoot } from "../core/paths.js";
import { launchAntigravity } from "./common.js";
function skippedReviewResponse() {
    return {
        status: "skipped",
        summary: "Nothing to review: target produced an empty diff and no file content was resolved (is the path untracked or unchanged? stage it or pass target:'file' with a ref).",
        findings: [],
        rawLogPath: null,
        artifacts: [],
        jobId: null,
        statePath: null
    };
}
export async function antigravityReview(args = {}) {
    const projectRoot = getProjectRoot();
    const target = args.target || "working-tree";
    const context = collectGitContext(projectRoot, target, args.ref);
    if (!context.hasContent)
        return skippedReviewResponse();
    const prompt = buildReviewPrompt({
        projectRoot,
        target,
        ref: args.ref,
        focus: args.focus,
        adversarial: false,
        severityThreshold: args.severityThreshold || "info",
        context
    });
    const launched = await launchAntigravity({ kind: "review", mode: "readonly", prompt, background: Boolean(args.background), maxRuntimeMs: args.maxRuntimeMs });
    if (args.background)
        return launched;
    const markdown = readResult(launched.state.resultPath, launched.state.logPath, true);
    const parsed = parseReview(markdown);
    return {
        status: launched.state.status,
        summary: parsed.summary,
        findings: parsed.findings,
        rawLogPath: launched.state.logPath,
        artifacts: [launched.state.artifactDir].filter(Boolean),
        jobId: launched.state.jobId,
        statePath: launched.state.statePath
    };
}
export async function antigravityAdversarialReview(args = {}) {
    const projectRoot = getProjectRoot();
    const target = args.target || "working-tree";
    const context = collectGitContext(projectRoot, target, args.ref);
    if (!context.hasContent)
        return skippedReviewResponse();
    const prompt = buildReviewPrompt({
        projectRoot,
        target,
        ref: args.ref,
        focus: args.focus,
        adversarial: true,
        severityThreshold: args.severityThreshold || "medium",
        context
    });
    const launched = await launchAntigravity({ kind: "adversarial-review", mode: "readonly", prompt, background: Boolean(args.background), maxRuntimeMs: args.maxRuntimeMs });
    if (args.background)
        return launched;
    const markdown = readResult(launched.state.resultPath, launched.state.logPath, true);
    const parsed = parseReview(markdown);
    return {
        status: launched.state.status,
        summary: parsed.summary,
        findings: parsed.findings,
        rawLogPath: launched.state.logPath,
        artifacts: [launched.state.artifactDir].filter(Boolean),
        jobId: launched.state.jobId,
        statePath: launched.state.statePath
    };
}
