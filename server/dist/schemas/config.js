export function maxJobMsFromEnv() {
    const minutes = Number(process.env.ANTIGRAVITY_MAX_JOB_MINUTES || "20");
    const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 240) : 20;
    return safeMinutes * 60_000;
}
export function defaultModeFromEnv() {
    const raw = String(process.env.ANTIGRAVITY_DEFAULT_MODE || "readonly").toLowerCase();
    if (raw === "suggest" || raw === "worktree")
        return raw;
    return "readonly";
}
