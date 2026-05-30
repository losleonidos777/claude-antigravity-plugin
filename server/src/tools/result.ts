import * as path from "node:path";
import { JobStore } from "../core/job-store.js";
import { getProjectRoot } from "../core/paths.js";
import { gitChangedFiles, readResult, writePatchIfAny } from "../core/output-parser.js";

export async function antigravityResult(args: any = {}) {
  const store = new JobStore(getProjectRoot());
  const jobs = store.list();
  const job = args.jobId ? store.read(String(args.jobId)) : jobs[0];
  if (!job) throw new Error("No Antigravity jobs found for this project.");
  const executionRoot = job.executionRoot || job.projectRoot;
  const changedFiles = gitChangedFiles(executionRoot);
  const patchPath = writePatchIfAny(executionRoot, path.join(job.artifactDir, "changes.patch")) || job.patchPath;
  const resultMarkdown = readResult(job.resultPath, job.logPath, Boolean(args.includeRaw));
  const updated = store.update(job.jobId, { changedFiles, patchPath, summary: job.summary || resultMarkdown.split(/\r?\n/).find((line) => line.trim()) || job.status });
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
