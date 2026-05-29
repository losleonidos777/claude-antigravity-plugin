import { JobStore } from "../core/job-store.js";
import { getProjectRoot } from "../core/paths.js";
import { killProcessTree } from "../core/process-runner.js";
export async function antigravityCancel(args = {}) {
    const store = new JobStore(getProjectRoot());
    const job = args.jobId ? store.read(String(args.jobId)) : store.list().find((j) => j.status === "running");
    if (!job)
        throw new Error("No matching running Antigravity job found.");
    const previousStatus = job.status;
    const cancelled = job.pid ? killProcessTree(job.pid, args.signal || "SIGTERM") : false;
    store.update(job.jobId, {
        status: "cancelled",
        finishedAt: new Date().toISOString(),
        error: cancelled ? undefined : { code: "cancel_no_pid", message: "No live process id was available; state marked cancelled." }
    });
    return { jobId: job.jobId, cancelled, previousStatus, message: cancelled ? "Cancellation signal sent to Antigravity process tree." : "Job state marked cancelled; no process was found." };
}
