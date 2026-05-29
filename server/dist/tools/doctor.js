import { doctor } from "../core/cli-adapter.js";
import { getProjectRoot } from "../core/paths.js";
export async function antigravityDoctor(args = {}) {
    return doctor(getProjectRoot(), {
        includeHelp: Boolean(args.includeHelp),
        includeAuthStatus: args.includeAuthStatus !== false
    });
}
export async function antigravitySetup(args = {}) {
    const result = await antigravityDoctor({ includeHelp: Boolean(args.includeHelp), includeAuthStatus: true });
    const nextActions = [];
    if (!result.binary.resolvedPath)
        nextActions.push("Install Antigravity CLI, then set the plugin agy_bin option to `agy` or the absolute binary path.");
    if (result.auth.status === "not_authenticated")
        nextActions.push("Run `agy` in a terminal and complete Google Sign-In; the bridge never stores Google credentials.");
    if (!result.capabilities.nonInteractivePrompt)
        nextActions.push("Run `agy --help` and `agy run --help`; set plugin cli_template to a verified non-interactive invocation such as `run --prompt-file {prompt} --json`.");
    if (!result.project.gitDetected)
        nextActions.push("Open Claude Code from a git repository for diff review, worktree isolation, and changed-file reporting.");
    if (nextActions.length === 0)
        nextActions.push("Antigravity bridge appears ready. Try `/antigravity:review`.");
    return { ...result, nextActions };
}
