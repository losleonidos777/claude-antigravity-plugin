import * as path from "node:path";
import * as fs from "node:fs";
import { JobStore } from "../core/job-store.js";
import { getProjectRoot } from "../core/paths.js";
import { changedSince, extractSummary, readResult, writePatchIfAny } from "../core/output-parser.js";
function isTerminal(status) {
    return ["skipped", "completed", "failed", "timeout", "cancelled", "unknown"].includes(status);
}
function isNarrationSummary(summary) {
    return Boolean(summary && /^(?:I will|I'll)\b/i.test(summary.trim()));
}
export async function antigravityResult(args = {}) {
    const store = new JobStore(getProjectRoot());
    const jobs = store.list();
    const job = args.jobId ? store.read(String(args.jobId)) : jobs[0];
    if (!job)
        throw new Error("No Antigravity jobs found for this project.");
    const executionRoot = job.executionRoot || job.projectRoot;
    const resultMarkdown = readResult(job.resultPath, job.logPath, Boolean(args.includeRaw));
    if (isTerminal(job.status) && !fs.existsSync(executionRoot)) {
        return {
            jobId: job.jobId,
            status: job.status,
            summary: job.summary || "",
            resultMarkdown,
            changedFiles: job.changedFiles || [],
            patchPath: job.patchPath,
            rawLogPath: job.logPath,
            statePath: job.statePath,
            worktreePath: job.worktreePath,
            branchName: job.branchName,
            warning: job.warning
        };
    }
    const changedFiles = job.mode === "readonly" ? [] : changedSince(executionRoot, job.baselineStatus ?? []);
    const patchPath = writePatchIfAny(executionRoot, path.join(job.artifactDir, "changes.patch")) || job.patchPath;
    const extractedSummary = extractSummary(resultMarkdown);
    const summary = extractedSummary && (isNarrationSummary(job.summary) || !job.summary) ? extractedSummary : job.summary || extractedSummary || job.status;
    const updated = store.update(job.jobId, { changedFiles, patchPath, summary });
    return {
        jobId: updated.jobId,
        status: updated.status,
        summary: updated.summary || "",
        resultMarkdown,
        changedFiles,
        patchPath,
        rawLogPath: updated.logPath,
        statePath: updated.statePath,
        worktreePath: updated.worktreePath,
        branchName: updated.branchName,
        warning: updated.warning
    };
}
