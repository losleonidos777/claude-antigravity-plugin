import * as fs from "node:fs";
import * as path from "node:path";
import { buildInvocation, doctor } from "../core/cli-adapter.js";
import { JobStore } from "../core/job-store.js";
import { getProjectRoot, projectPaths } from "../core/paths.js";
import { runBackground, runForeground } from "../core/process-runner.js";
import { changedSince, extractSummary, gitChangedFiles, readResult, writePatchIfAny } from "../core/output-parser.js";
import { maxJobMsFromEnv } from "../schemas/config.js";
export async function launchAntigravity(params) {
    const projectRoot = getProjectRoot();
    const paths = projectPaths(projectRoot);
    const store = new JobStore(projectRoot);
    const artifactDir = path.join(paths.artifactsDir, "pending");
    fs.mkdirSync(artifactDir, { recursive: true });
    const promptPath = path.join(artifactDir, `prompt-${Date.now()}.md`);
    fs.writeFileSync(promptPath, params.prompt, "utf8");
    const check = doctor(projectRoot, { includeAuthStatus: false });
    if (!check.binary.resolvedPath)
        throw new Error(check.errors[0] || "Antigravity CLI binary not found.");
    const execRoot = params.executionRoot || projectRoot;
    const baselineStatus = gitChangedFiles(execRoot);
    const invocation = buildInvocation({
        binary: check.binary.resolvedPath,
        capabilities: check.capabilities,
        promptPath,
        promptText: params.prompt,
        mode: params.mode,
        jsonPreferred: true
    });
    const state = store.create({
        kind: params.kind,
        mode: params.mode,
        promptPath,
        command: [invocation.command, ...invocation.args],
        executionRoot: params.executionRoot || projectRoot,
        worktreePath: params.worktreePath,
        branchName: params.branchName,
        warning: params.warning,
        baselineStatus,
        parsedTasks: params.parsedTasks
    });
    const finalPromptPath = path.join(state.artifactDir, "prompt.md");
    fs.renameSync(promptPath, finalPromptPath);
    store.update(state.jobId, { promptPath: finalPromptPath });
    invocation.stdinFile = invocation.stdinFile === promptPath ? finalPromptPath : invocation.stdinFile;
    invocation.args = invocation.args.map((arg) => (arg === promptPath ? finalPromptPath : arg));
    const timeoutMs = Number(params.maxRuntimeMs || 0) > 0 ? Number(params.maxRuntimeMs) : maxJobMsFromEnv();
    if (params.background) {
        const child = runBackground(invocation, {
            cwd: execRoot,
            logPath: state.logPath,
            resultPath: state.resultPath,
            timeoutMs,
            onExit: (result) => {
                const changedFiles = state.mode === "readonly" ? [] : changedSince(execRoot, state.baselineStatus ?? []);
                const patchPath = writePatchIfAny(execRoot, path.join(state.artifactDir, "changes.patch"));
                const summary = extractSummary(readResult(state.resultPath, state.logPath, true)) || result.status;
                store.update(state.jobId, {
                    status: result.status,
                    exitCode: result.exitCode,
                    signal: result.signal,
                    finishedAt: new Date().toISOString(),
                    changedFiles,
                    patchPath,
                    summary
                });
            }
        });
        const updated = store.update(state.jobId, { status: "running", pid: child.pid, startedAt: new Date().toISOString() });
        return {
            jobId: updated.jobId,
            status: updated.status,
            statePath: updated.statePath,
            logPath: updated.logPath,
            resultHint: `Use /antigravity:status ${updated.jobId} and /antigravity:result ${updated.jobId}`,
            worktreePath: updated.worktreePath,
            branchName: updated.branchName,
            warning: updated.warning
        };
    }
    const running = store.update(state.jobId, { status: "running", startedAt: new Date().toISOString() });
    const result = await runForeground(invocation, {
        cwd: execRoot,
        logPath: running.logPath,
        resultPath: running.resultPath,
        timeoutMs
    });
    const changedFiles = running.mode === "readonly" ? [] : changedSince(execRoot, running.baselineStatus ?? []);
    const patchPath = writePatchIfAny(execRoot, path.join(running.artifactDir, "changes.patch"));
    const summary = extractSummary(readResult(running.resultPath, running.logPath, true)) || result.status;
    const done = store.update(running.jobId, {
        status: result.status,
        exitCode: result.exitCode,
        signal: result.signal,
        finishedAt: new Date().toISOString(),
        changedFiles,
        patchPath,
        summary
    });
    return { state: done, run: result, warning: done.warning };
}
