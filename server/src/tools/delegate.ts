import { buildDelegatePrompt } from "../core/prompt-builder.js";
import { projectPaths, getProjectRoot } from "../core/paths.js";
import { assertNoDirectEditMode, validatePathPolicy } from "../core/safety.js";
import { defaultModeFromEnv } from "../schemas/config.js";
import { prepareWorktree } from "../core/worktree.js";
import { launchAntigravity } from "./common.js";

export async function antigravityDelegate(args: any = {}) {
  if (!args.prompt || !String(args.prompt).trim()) throw new Error("prompt is required");
  const projectRoot = getProjectRoot();
  const mode = String(args.mode || defaultModeFromEnv()) as "readonly" | "suggest" | "worktree";
  assertNoDirectEditMode(mode);
  const policy = validatePathPolicy([...(args.allowedPaths || []), ...(args.deniedPaths || [])], args.deniedPaths || []);
  if (!policy.ok) throw new Error(`Denied path in delegate request: ${policy.denied.join(", ")}`);

  let executionRoot = projectRoot;
  let worktreePath: string | undefined;
  let branchName: string | undefined;
  let warning: string | undefined;
  if (mode === "worktree") {
    const prepared = prepareWorktree(projectRoot, projectPaths(projectRoot).worktreesDir, `pending-${Date.now().toString(36)}`);
    executionRoot = prepared.executionRoot;
    worktreePath = prepared.worktreePath;
    branchName = prepared.branchName;
    warning = prepared.warning;
  }

  const prompt = buildDelegatePrompt({ projectRoot: executionRoot, task: String(args.prompt), mode, allowedPaths: args.allowedPaths, deniedPaths: args.deniedPaths });
  return launchAntigravity({
    kind: "delegate",
    mode,
    prompt,
    background: true,
    maxRuntimeMs: args.maxRuntimeMs,
    executionRoot,
    worktreePath,
    branchName,
    warning
  });
}
