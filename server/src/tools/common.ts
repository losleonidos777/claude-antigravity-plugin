import * as fs from "node:fs";
import * as path from "node:path";
import { buildInvocation, doctor } from "../core/cli-adapter.js";
import { JobStore } from "../core/job-store.js";
import { getProjectRoot, projectPaths } from "../core/paths.js";
import { runBackground, runForeground } from "../core/process-runner.js";
import { gitChangedFiles, writePatchIfAny } from "../core/output-parser.js";
import { maxJobMsFromEnv } from "../schemas/config.js";
import { JobKind, JobMode, JobState } from "../schemas/jobs.js";

export interface LaunchParams {
  kind: JobKind;
  mode: JobMode;
  prompt: string;
  background: boolean;
  maxRuntimeMs?: number;
  executionRoot?: string;
  worktreePath?: string;
  branchName?: string;
  parsedTasks?: JobState["parsedTasks"];
}

export async function launchAntigravity(params: LaunchParams) {
  const projectRoot = getProjectRoot();
  const paths = projectPaths(projectRoot);
  const store = new JobStore(projectRoot);
  const artifactDir = path.join(paths.artifactsDir, "pending");
  fs.mkdirSync(artifactDir, { recursive: true });
  const promptPath = path.join(artifactDir, `prompt-${Date.now()}.md`);
  fs.writeFileSync(promptPath, params.prompt, "utf8");

  const check = doctor(projectRoot, { includeAuthStatus: false });
  if (!check.binary.resolvedPath) throw new Error(check.errors[0] || "Antigravity CLI binary not found.");
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
      cwd: params.executionRoot || projectRoot,
      logPath: state.logPath,
      resultPath: state.resultPath,
      timeoutMs,
      onExit: (result) => {
        const changedFiles = gitChangedFiles(params.executionRoot || projectRoot);
        const patchPath = writePatchIfAny(params.executionRoot || projectRoot, path.join(state.artifactDir, "changes.patch"));
        store.update(state.jobId, {
          status: result.status,
          exitCode: result.exitCode,
          signal: result.signal,
          finishedAt: new Date().toISOString(),
          changedFiles,
          patchPath,
          summary: result.stdout.split(/\r?\n/).find((line) => line.trim()) || result.stderr.split(/\r?\n/).find((line) => line.trim()) || result.status
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
      branchName: updated.branchName
    };
  }

  const running = store.update(state.jobId, { status: "running", startedAt: new Date().toISOString() });
  const result = await runForeground(invocation, {
    cwd: params.executionRoot || projectRoot,
    logPath: running.logPath,
    resultPath: running.resultPath,
    timeoutMs
  });
  const changedFiles = gitChangedFiles(params.executionRoot || projectRoot);
  const patchPath = writePatchIfAny(params.executionRoot || projectRoot, path.join(running.artifactDir, "changes.patch"));
  const done = store.update(running.jobId, {
    status: result.status,
    exitCode: result.exitCode,
    signal: result.signal,
    finishedAt: new Date().toISOString(),
    changedFiles,
    patchPath,
    summary: result.stdout.split(/\r?\n/).find((line) => line.trim()) || result.stderr.split(/\r?\n/).find((line) => line.trim()) || result.status
  });
  return { state: done, run: result };
}
