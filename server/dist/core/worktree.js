import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathHasUnsafeSegment, pathIsDenied, redactSecrets } from "./safety.js";
const MAX_UNTRACKED_FILE_BYTES = 25 * 1024 * 1024;
const MAX_UNTRACKED_TOTAL_BYTES = 250 * 1024 * 1024;
function git(cwd, args) {
    const res = childProcess.spawnSync("git", args, { cwd, encoding: "utf8", timeout: 15_000, windowsHide: true });
    return { ok: res.status === 0, stdout: String(res.stdout || ""), stderr: String(res.stderr || "") };
}
function gitBuffer(cwd, args) {
    const res = childProcess.spawnSync("git", args, { cwd, encoding: "buffer", timeout: 30_000, windowsHide: true });
    return { ok: res.status === 0, stdout: Buffer.from(res.stdout || ""), stderr: String(res.stderr || "") };
}
function isInside(parent, candidate) {
    const rel = path.relative(parent, candidate);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
function resolveContained(root, relativePath) {
    if (pathHasUnsafeSegment(relativePath) || path.isAbsolute(relativePath))
        return null;
    const resolved = path.resolve(root, relativePath);
    return isInside(path.resolve(root), resolved) ? resolved : null;
}
function realPathContained(root, candidate) {
    const rootReal = fs.realpathSync.native(root);
    const candidateReal = fs.realpathSync.native(candidate);
    return isInside(rootReal, candidateReal);
}
function pushWarning(warnings, message) {
    if (message)
        warnings.push(redactSecrets(message).replace(/\s+/g, " ").trim());
}
function replayTrackedChanges(projectRoot, worktreePath, warnings) {
    const names = git(projectRoot, ["diff", "--name-only", "HEAD", "--"]);
    const trackedCount = names.ok ? names.stdout.split(/\r?\n/).filter(Boolean).length : 0;
    const patch = gitBuffer(projectRoot, ["diff", "--binary", "--no-ext-diff", "--no-textconv", "HEAD", "--"]);
    if (!patch.ok) {
        pushWarning(warnings, `Could not inspect tracked modifications for worktree replay: ${patch.stderr}`);
        return;
    }
    if (patch.stdout.length === 0)
        return;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-patch-"));
    const patchPath = path.join(tmpDir, "tracked.patch");
    try {
        fs.writeFileSync(patchPath, patch.stdout);
        const check = git(worktreePath, ["apply", "--check", "--whitespace=nowarn", patchPath]);
        if (!check.ok) {
            pushWarning(warnings, `Could not replay ${trackedCount || "tracked"} tracked modification(s): git apply --check failed: ${check.stderr || check.stdout}`);
            return;
        }
        const apply = git(worktreePath, ["apply", "--whitespace=nowarn", patchPath]);
        if (!apply.ok) {
            pushWarning(warnings, `Could not replay ${trackedCount || "tracked"} tracked modification(s): ${apply.stderr || apply.stdout}`);
            return;
        }
        pushWarning(warnings, `Replayed ${trackedCount || "tracked"} tracked modification(s) into the isolated worktree.`);
    }
    finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}
function copyUntrackedFiles(projectRoot, worktreePath, warnings) {
    const others = git(projectRoot, ["ls-files", "-z", "--others", "--exclude-standard"]);
    if (!others.ok) {
        pushWarning(warnings, `Could not enumerate untracked files for worktree copy: ${others.stderr || others.stdout}`);
        return;
    }
    const files = others.stdout.split("\0").filter(Boolean);
    let copied = 0;
    let skipped = 0;
    let copiedBytes = 0;
    for (const file of files) {
        const source = resolveContained(projectRoot, file);
        const dest = resolveContained(worktreePath, file);
        if (!source || !dest || pathIsDenied(file)) {
            skipped++;
            continue;
        }
        try {
            const stat = fs.lstatSync(source);
            if (!stat.isFile() || stat.isSymbolicLink()) {
                skipped++;
                continue;
            }
            if (!realPathContained(projectRoot, source)) {
                skipped++;
                continue;
            }
            if (stat.size > MAX_UNTRACKED_FILE_BYTES || copiedBytes + stat.size > MAX_UNTRACKED_TOTAL_BYTES) {
                skipped++;
                continue;
            }
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(path.toNamespacedPath(source), path.toNamespacedPath(dest));
            copied++;
            copiedBytes += stat.size;
        }
        catch (error) {
            skipped++;
        }
    }
    if (copied > 0 || skipped > 0) {
        const parts = [`Copied ${copied} untracked file(s) into the isolated worktree.`];
        if (skipped > 0)
            parts.push(`Skipped ${skipped} untracked item(s) due to safety policy, size caps, or copy errors.`);
        pushWarning(warnings, parts.join(" "));
    }
}
export function prepareWorktree(projectRoot, worktreesDir, jobId) {
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
    const warnings = [];
    replayTrackedChanges(projectRoot, worktreePath, warnings);
    copyUntrackedFiles(projectRoot, worktreePath, warnings);
    return { executionRoot: worktreePath, worktreePath, branchName, warning: warnings.join(" ") || undefined };
}
