import { buildReviewPrompt } from "../core/prompt-builder.js";
import { parseReview, readResult } from "../core/output-parser.js";
import { getProjectRoot } from "../core/paths.js";
import { launchAntigravity } from "./common.js";
export async function antigravityReview(args = {}) {
    const prompt = buildReviewPrompt({
        projectRoot: getProjectRoot(),
        target: args.target || "working-tree",
        ref: args.ref,
        focus: args.focus,
        adversarial: false,
        severityThreshold: args.severityThreshold || "info"
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
    const prompt = buildReviewPrompt({
        projectRoot: getProjectRoot(),
        target: args.target || "working-tree",
        ref: args.ref,
        focus: args.focus,
        adversarial: true,
        severityThreshold: args.severityThreshold || "medium"
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
