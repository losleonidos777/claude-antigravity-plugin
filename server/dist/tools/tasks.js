import { buildExecuteTasksPrompt, buildVerifyPlanPrompt, readProjectTextFile } from "../core/prompt-builder.js";
import { getProjectRoot, projectPaths } from "../core/paths.js";
import { assertNoDirectEditMode } from "../core/safety.js";
import { prepareWorktree } from "../core/worktree.js";
import { launchAntigravity } from "./common.js";
export async function antigravityExecuteTasks(args = {}) {
    const projectRoot = getProjectRoot();
    const mode = String(args.mode || "suggest");
    assertNoDirectEditMode(mode);
    const taskList = args.taskListText ? String(args.taskListText) : args.taskListPath ? readProjectTextFile(projectRoot, String(args.taskListPath)) : "";
    if (!taskList.trim())
        throw new Error("taskListPath or taskListText is required");
    let executionRoot = projectRoot;
    let worktreePath;
    let branchName;
    if (mode === "worktree") {
        const prepared = prepareWorktree(projectRoot, projectPaths(projectRoot).worktreesDir, `pending-${Date.now().toString(36)}`);
        executionRoot = prepared.executionRoot;
        worktreePath = prepared.worktreePath;
        branchName = prepared.branchName;
    }
    const built = buildExecuteTasksPrompt({
        projectRoot: executionRoot,
        taskList,
        mode,
        strategy: args.strategy || "sequential",
        stopOnFailure: args.stopOnFailure !== false
    });
    const launched = await launchAntigravity({
        kind: "execute-tasks",
        mode,
        prompt: built.prompt,
        background: true,
        maxRuntimeMs: args.maxRuntimeMs,
        executionRoot,
        worktreePath,
        branchName,
        parsedTasks: built.parsedTasks
    });
    return { ...launched, parsedTasks: built.parsedTasks };
}
export async function antigravityVerifyPlan(args = {}) {
    const projectRoot = getProjectRoot();
    const plan = args.planText ? String(args.planText) : args.planPath ? readProjectTextFile(projectRoot, String(args.planPath)) : "";
    if (!plan.trim())
        throw new Error("planPath or planText is required");
    const prompt = buildVerifyPlanPrompt({ projectRoot, plan, focus: args.focus });
    return launchAntigravity({
        kind: "verify-plan",
        mode: "readonly",
        prompt,
        background: args.background !== false,
        maxRuntimeMs: args.maxRuntimeMs
    });
}
