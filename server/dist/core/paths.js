import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
export function getProjectRoot() {
    return path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}
export function getDataRoot() {
    return path.resolve(process.env.ANTIGRAVITY_STATE_DIR ||
        process.env.CLAUDE_PLUGIN_DATA ||
        path.join(os.homedir(), ".claude", "plugins", "data", "antigravity"));
}
export function projectHash(projectRoot = getProjectRoot()) {
    return crypto.createHash("sha256").update(path.resolve(projectRoot)).digest("hex").slice(0, 16);
}
export function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
export function projectPaths(projectRoot = getProjectRoot()) {
    const root = getDataRoot();
    const hash = projectHash(projectRoot);
    return {
        dataRoot: ensureDir(root),
        projectHash: hash,
        jobsDir: ensureDir(path.join(root, "jobs", hash)),
        logsDir: ensureDir(path.join(root, "logs", hash)),
        artifactsDir: ensureDir(path.join(root, "artifacts", hash)),
        worktreesDir: ensureDir(path.join(root, "worktrees", hash))
    };
}
export function nowIso() {
    return new Date().toISOString();
}
export function resolveProjectPath(projectRoot, maybeRelative) {
    const resolved = path.isAbsolute(maybeRelative) ? maybeRelative : path.join(projectRoot, maybeRelative);
    const normalized = path.resolve(resolved);
    const normalizedRoot = path.resolve(projectRoot);
    if (!normalized.startsWith(normalizedRoot + path.sep) && normalized !== normalizedRoot) {
        throw new Error(`Path escapes project root: ${maybeRelative}`);
    }
    return normalized;
}
export function relativeToProject(projectRoot, absolutePath) {
    return path.relative(projectRoot, absolutePath).replace(/\\/g, "/");
}
