import { JobStore } from "../core/job-store.js";
import { getProjectRoot } from "../core/paths.js";
import { killProcessTreeConfirmed } from "../core/process-runner.js";
const TERMINAL_STATUSES = new Set(["skipped", "completed", "failed", "timeout", "cancelled", "unknown"]);
export async function antigravityCancel(args = {}) {
    const store = new JobStore(getProjectRoot());
    const job = args.jobId ? store.read(String(args.jobId)) : store.list().find((j) => j.status === "running");
    if (!job)
        throw new Error("No matching running Antigravity job found.");
    const previousStatus = job.status;
    const requestedSignal = args.signal === "SIGKILL" ? "SIGKILL" : "SIGTERM";
    // store.read/list already reconciled; if the job has finished, do not kill a possibly
    // reused stale PID nor flip a terminal status (e.g. completed) to cancelled.
    if (TERMINAL_STATUSES.has(job.status)) {
        return { jobId: job.jobId, cancelled: false, previousStatus, escalated: false, message: `Job is already in terminal state '${job.status}'; nothing to cancel.` };
    }
    // No live PID: there is nothing to kill, so record the intent and report honestly.
    if (!job.pid) {
        store.update(job.jobId, {
            status: "cancelled",
            finishedAt: new Date().toISOString(),
            error: { code: "cancel_no_pid", message: "No live process id was available; state marked cancelled." }
        });
        return { jobId: job.jobId, cancelled: false, previousStatus, escalated: false, message: "Job state marked cancelled; no process id was recorded." };
    }
    // Send the signal and VERIFY death (escalating SIGTERM -> SIGKILL). taskkill's exit
    // code only means "signal sent", so we never trust it as proof the process is gone.
    // Accepted limitation: the PID is not identity-checked, so an OS PID-reuse between read
    // and kill could target an unrelated process (tracked as a follow-up; see job-store reaper).
    const outcome = await killProcessTreeConfirmed(job.pid, requestedSignal);
    if (outcome.killed) {
        store.update(job.jobId, { status: "cancelled", finishedAt: new Date().toISOString() });
        const escalationNote = outcome.escalated ? " (SIGTERM ignored; escalated to a forced SIGKILL)" : "";
        return {
            jobId: job.jobId,
            cancelled: true,
            previousStatus,
            escalated: outcome.escalated,
            message: `Antigravity process tree (pid ${job.pid}) confirmed terminated${escalationNote}.`
        };
    }
    // The process refused to die even after a forced kill. Do NOT mark cancelled — leave the
    // job running so the deadline reaper or a later cancel can retry, and report the truth.
    store.update(job.jobId, {
        error: { code: "cancel_failed", message: `Process tree (pid ${job.pid}) was still alive after a forced SIGKILL.` }
    });
    return {
        jobId: job.jobId,
        cancelled: false,
        previousStatus,
        escalated: outcome.escalated,
        message: `Could not confirm termination of pid ${job.pid} after escalating to SIGKILL; job left in '${job.status}' state. Inspect the process manually.`
    };
}
