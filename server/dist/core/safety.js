const SECRET_PATTERNS = [
    [/AIza[0-9A-Za-z_\-]{20,}/g, "[REDACTED_GOOGLE_API_KEY]"],
    [/ya29\.[0-9A-Za-z_\-.]+/g, "[REDACTED_GOOGLE_OAUTH_TOKEN]"],
    [/sk-[A-Za-z0-9_\-]{20,}/g, "[REDACTED_API_KEY]"],
    [/AKIA[0-9A-Z]{16}/g, "[REDACTED_AWS_ACCESS_KEY_ID]"],
    [/(aws_access_key_id|aws_secret_access_key|aws_session_token)\s*[:=]\s*[^\s'\"]+/gi, "$1=[REDACTED]"],
    [/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]"],
    [/(password|passwd|pwd|token|secret|api[_-]?key|credential)\s*[:=]\s*[^\s'\"]+/gi, "$1=[REDACTED]"],
    [/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
    [/(client_secret|refresh_token|access_token)\"?\s*[:=]\s*\"?[^\"\s,}]+/gi, "$1=[REDACTED]"]
];
const DEFAULT_DENYLIST = [
    ".env",
    ".env.",
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    "id_rsa",
    "id_ed25519",
    ".git/",
    "node_modules/",
    "vendor/",
    "dist/",
    "build/"
];
export function redactSecrets(input) {
    let text = typeof input === "string" ? input : JSON.stringify(input, null, 2);
    for (const [pattern, replacement] of SECRET_PATTERNS) {
        text = text.replace(pattern, replacement);
    }
    return text;
}
export function truncate(text, maxChars = 500_000) {
    if (text.length <= maxChars)
        return text;
    const head = text.slice(0, Math.floor(maxChars * 0.7));
    const tail = text.slice(text.length - Math.floor(maxChars * 0.2));
    return `${head}\n\n[antigravity-bridge: truncated ${text.length - head.length - tail.length} chars]\n\n${tail}`;
}
export function normalizeRelativePath(candidate) {
    return candidate.replace(/\\/g, "/").replace(/^\.\//, "");
}
export function pathHasUnsafeSegment(candidate) {
    if (candidate.includes("\0"))
        return true;
    return normalizeRelativePath(candidate)
        .split("/")
        .some((segment) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(segment));
}
export function pathIsDenied(candidate, extraDenied = []) {
    if (pathHasUnsafeSegment(candidate))
        return true;
    const p = normalizeRelativePath(candidate).toLowerCase();
    const rules = [...DEFAULT_DENYLIST, ...extraDenied.map((v) => v.toLowerCase())];
    return rules.some((rule) => {
        const r = rule.replace(/\\/g, "/");
        if (!r)
            return false;
        if (r.endsWith("/"))
            return p === r.slice(0, -1) || p.startsWith(r);
        if (r.startsWith("*"))
            return p.endsWith(r.slice(1));
        if (r.startsWith("."))
            return p === r || p.endsWith(r) || p.includes(`/${r}`);
        return p === r || p.endsWith(`/${r}`) || p.startsWith(`${r}/`);
    });
}
export function validatePathPolicy(paths, deniedPaths = []) {
    const denied = (paths || []).filter((p) => pathIsDenied(p, deniedPaths));
    return { ok: denied.length === 0, denied };
}
export function safeLogLine(line) {
    return redactSecrets(line).replace(/\r/g, "");
}
export function assertNoDirectEditMode(mode) {
    if (mode === "direct-edit") {
        throw new Error("direct-edit mode is intentionally unsupported. Use readonly, suggest, or worktree.");
    }
}
