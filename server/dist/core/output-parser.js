import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import { truncate } from "./safety.js";
export function extractJsonBlock(markdown) {
    const match = markdown.match(/```json\s*([\s\S]*?)```/i);
    if (!match)
        return null;
    try {
        return JSON.parse(match[1]);
    }
    catch {
        return null;
    }
}
export function firstMeaningfulParagraph(markdown) {
    const cleaned = markdown.replace(/```[\s\S]*?```/g, "").trim();
    const para = cleaned.split(/\n\s*\n/).find((p) => p.trim().length > 0) || cleaned.slice(0, 500);
    return truncate(para.replace(/\s+/g, " ").trim(), 1200);
}
function normalizeSeverity(value) {
    const v = String(value || "info").toLowerCase();
    if (["critical", "high", "medium", "low", "info"].includes(v))
        return v;
    return "info";
}
function normalizeConfidence(value) {
    const v = String(value || "medium").toLowerCase();
    if (["low", "medium", "high"].includes(v))
        return v;
    return "medium";
}
export function parseReview(markdown) {
    const json = extractJsonBlock(markdown);
    if (json && Array.isArray(json.findings)) {
        return {
            summary: String(json.summary || firstMeaningfulParagraph(markdown)),
            findings: json.findings.map((f, idx) => ({
                id: String(f.id || `AGY-${idx + 1}`),
                severity: normalizeSeverity(f.severity),
                file: f.file ? String(f.file) : undefined,
                line: Number.isFinite(Number(f.line)) ? Number(f.line) : undefined,
                title: String(f.title || "Finding"),
                explanation: String(f.explanation || f.details || ""),
                recommendation: String(f.recommendation || f.fix || ""),
                confidence: normalizeConfidence(f.confidence)
            }))
        };
    }
    const findings = [];
    const lines = markdown.split(/\r?\n/);
    let id = 1;
    for (const line of lines) {
        const match = line.match(/^(?:[-*]\s*)?(critical|high|medium|low|info)\s*[:\-]\s*(.+)$/i);
        if (match) {
            findings.push({
                id: `AGY-${id++}`,
                severity: normalizeSeverity(match[1]),
                title: match[2].trim(),
                explanation: "See raw result markdown for details.",
                recommendation: "Review the associated section and decide whether Claude should address it.",
                confidence: "medium"
            });
        }
    }
    return { summary: firstMeaningfulParagraph(markdown), findings };
}
export function readResult(resultPath, logPath, includeRaw = false) {
    const candidate = resultPath && fs.existsSync(resultPath) ? resultPath : logPath;
    if (!candidate || !fs.existsSync(candidate))
        return "";
    const text = fs.readFileSync(candidate, "utf8");
    return includeRaw ? truncate(text, 800_000) : truncate(text, 120_000);
}
export function gitChangedFiles(cwd) {
    try {
        const res = childProcess.spawnSync("git", ["status", "--short"], { cwd, encoding: "utf8", timeout: 5000, windowsHide: true });
        return String(res.stdout || "")
            .split(/\r?\n/)
            .filter((line) => line.length > 0)
            .map((line) => {
            // git status --short format is "XY filename" (X and Y are status codes, always 2 chars; column 3 is space).
            // For renames the path is "old -> new" — keep the full segment after column 3 and let the consumer parse.
            const path = line.slice(3).replace(/\s+$/, "");
            const renameSplit = path.indexOf(" -> ");
            return renameSplit === -1 ? path : path.slice(renameSplit + 4);
        })
            .filter(Boolean);
    }
    catch {
        return [];
    }
}
export function writePatchIfAny(cwd, patchPath) {
    try {
        const res = childProcess.spawnSync("git", ["diff", "--no-ext-diff"], { cwd, encoding: "utf8", timeout: 10_000, windowsHide: true });
        const diff = String(res.stdout || "");
        if (!diff.trim())
            return undefined;
        fs.writeFileSync(patchPath, diff, "utf8");
        return patchPath;
    }
    catch {
        return undefined;
    }
}
