import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { nowIso, projectPaths } from "./paths.js";
import { redactSecrets } from "./safety.js";
function atomicWriteJson(filePath, data) {
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, redactSecrets(JSON.stringify(data, null, 2)) + "\n", "utf8");
    fs.renameSync(tmp, filePath);
}
function pidIsAlive(pid) {
    if (!pid || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
export class JobStore {
    projectRoot;
    paths;
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
        this.paths = projectPaths(projectRoot);
    }
    newJobId(prefix = "ag") {
        return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
    }
    create(params) {
        const jobId = this.newJobId();
        const artifactDir = path.join(this.paths.artifactsDir, jobId);
        fs.mkdirSync(artifactDir, { recursive: true });
        const logPath = path.join(this.paths.logsDir, `${jobId}.log`);
        const resultPath = path.join(artifactDir, "result.md");
        const statePath = path.join(this.paths.jobsDir, `${jobId}.json`);
        const now = nowIso();
        const state = {
            schemaVersion: 1,
            jobId,
            projectRoot: this.projectRoot,
            executionRoot: params.executionRoot || this.projectRoot,
            projectHash: this.paths.projectHash,
            kind: params.kind,
            status: "queued",
            mode: params.mode,
            promptPath: params.promptPath,
            logPath,
            resultPath,
            statePath,
            artifactDir,
            worktreePath: params.worktreePath,
            branchName: params.branchName,
            warning: params.warning,
            baselineStatus: params.baselineStatus,
            command: params.command || [],
            createdAt: now,
            updatedAt: now,
            parsedTasks: params.parsedTasks
        };
        atomicWriteJson(statePath, state);
        return state;
    }
    read(jobId) {
        const filePath = path.join(this.paths.jobsDir, `${jobId}.json`);
        if (!fs.existsSync(filePath))
            throw new Error(`Unknown Antigravity job: ${jobId}`);
        const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return this.reconcile(state);
    }
    update(jobId, patch) {
        const filePath = path.join(this.paths.jobsDir, `${jobId}.json`);
        if (!fs.existsSync(filePath))
            throw new Error(`Unknown Antigravity job: ${jobId}`);
        const existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const merged = { ...existing, ...patch, updatedAt: nowIso() };
        atomicWriteJson(filePath, merged);
        return merged;
    }
    list() {
        if (!fs.existsSync(this.paths.jobsDir))
            return [];
        return fs
            .readdirSync(this.paths.jobsDir)
            .filter((name) => name.endsWith(".json"))
            .map((name) => {
            try {
                const state = JSON.parse(fs.readFileSync(path.join(this.paths.jobsDir, name), "utf8"));
                return this.reconcile(state);
            }
            catch {
                return undefined;
            }
        })
            .filter(Boolean)
            .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    }
    reconcile(state) {
        if (state.status === "running" && !pidIsAlive(state.pid)) {
            const log = state.logPath && fs.existsSync(state.logPath) ? fs.readFileSync(state.logPath, "utf8") : "";
            const resultExists = Boolean(state.resultPath && fs.existsSync(state.resultPath));
            const inferredStatus = log.includes("[antigravity-bridge] done exitCode=0") || resultExists ? "completed" : "unknown";
            const patch = {
                status: inferredStatus,
                finishedAt: state.finishedAt || nowIso(),
                error: inferredStatus === "unknown"
                    ? { code: "pid_gone", message: "Job was marked running but its process is no longer alive. Inspect logPath." }
                    : state.error
            };
            const merged = { ...state, ...patch, updatedAt: nowIso() };
            atomicWriteJson(state.statePath, merged);
            return merged;
        }
        return state;
    }
}
