import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

function git(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const res = childProcess.spawnSync("git", args, { cwd, encoding: "utf8", timeout: 15_000, windowsHide: true });
  return { ok: res.status === 0, stdout: String(res.stdout || ""), stderr: String(res.stderr || "") };
}

export function prepareWorktree(projectRoot: string, worktreesDir: string, jobId: string): { executionRoot: string; worktreePath: string; branchName: string; warning?: string } {
  const inside = git(projectRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || !/true/.test(inside.stdout)) {
    throw new Error("worktree mode requires a git repository. Use suggest mode instead.");
  }
  fs.mkdirSync(worktreesDir, { recursive: true });
  const branchName = `antigravity/${jobId}`;
  const worktreePath = path.join(worktreesDir, jobId);
  const add = git(projectRoot, ["worktree", "add", "-b", branchName, worktreePath, "HEAD"]);
  if (!add.ok) {
    throw new Error(`Failed to create isolated worktree: ${add.stderr || add.stdout}`);
  }
  return { executionRoot: worktreePath, worktreePath, branchName };
}
