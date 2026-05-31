import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { nowIso, projectPaths } from "./paths.js";
import { redactSecrets } from "./safety.js";
import { killProcessTree } from "./process-runner.js";
// A job is only reaped once it is past its deadline by this margin, so minor clock
// skew or a freshly-launched job whose clock differs slightly is never killed early.
const REAP_SKEW_MS = 5_000;
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
    // Raw read with no reconcile/side-effects — used to check the currently-persisted status
    // before overwriting it (e.g. so an async onExit cannot clobber a cancel/timeout already
    // written by cancel.ts or the reaper). Returns null if the record is missing/unreadable.
    peek(jobId) {
        const filePath = path.join(this.paths.jobsDir, `${jobId}.json`);
        if (!fs.existsSync(filePath))
            return null;
        try {
            return JSON.parse(fs.readFileSync(filePath, "utf8"));
        }
        catch {
            return null;
        }
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
        if (state.status !== "running")
            return state;
        // Dead PID: infer a terminal status from the log/result artifacts.
        if (!pidIsAlive(state.pid)) {
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
        // Alive but past its persisted deadline: the in-memory setTimeout watchdog was lost
        // (server recycle/reconnect). Every read/list call thus acts as a durable reaper —
        // kill the orphaned process tree and mark the job timed out. Jobs without a
        // deadlineAt (e.g. legacy records) are left untouched.
        if (state.deadlineAt) {
            const deadline = Date.parse(state.deadlineAt);
            if (Number.isFinite(deadline) && Date.now() > deadline + REAP_SKEW_MS) {
                // Accepted limitation: we kill by persisted PID without verifying process identity, so an
                // OS PID-reuse between the liveness check and the kill could target an unrelated process.
                // The window requires the agy child to have died, its PID reused, and the state to still
                // read `running` (server-recycle path). A full fix needs process start-time/handle tracking
                // at launch; tracked as a follow-up rather than solved in this cold-test fix.
                killProcessTree(state.pid, "SIGKILL");
                const merged = {
                    ...state,
                    status: "timeout",
                    finishedAt: state.finishedAt || nowIso(),
                    error: {
                        code: "deadline_exceeded",
                        message: `Job exceeded its ${state.deadlineAt} deadline while still running; the bridge killed the orphaned process tree (pid ${state.pid}).`
                    },
                    updatedAt: nowIso()
                };
                atomicWriteJson(state.statePath, merged);
                return merged;
            }
        }
        return state;
    }
}
