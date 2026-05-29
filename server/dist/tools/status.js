import { JobStore } from "../core/job-store.js";
import { getProjectRoot } from "../core/paths.js";
export async function antigravityStatus(args = {}) {
    const store = new JobStore(getProjectRoot());
    if (args.jobId)
        return { jobs: [store.read(String(args.jobId))] };
    return { jobs: store.list().slice(0, 25) };
}
