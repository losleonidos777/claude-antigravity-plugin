import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import { truncate } from "./safety.js";
export function extractJsonBlock(markdown) {
    const matches = Array.from(markdown.matchAll(/```json\s*([\s\S]*?)```/gi));
    for (let i = matches.length - 1; i >= 0; i--) {
        try {
            return JSON.parse(matches[i][1]);
        }
        catch {
            // Keep walking backward; earlier fences may still contain the final valid payload.
        }
    }
    return null;
}
export function firstMeaningfulParagraph(markdown) {
    const cleaned = markdown.replace(/```[\s\S]*?```/g, "").trim();
    const para = cleaned.split(/\n\s*\n/).find((p) => p.trim().length > 0) || cleaned.slice(0, 500);
    return truncate(para.replace(/\s+/g, " ").trim(), 1200);
}
function compactText(text, limit = 1200) {
    return truncate(text.replace(/\s+/g, " ").trim(), limit);
}
function stripFences(markdown) {
    return markdown.replace(/```[\s\S]*?```/g, "").trim();
}
function isNarration(line) {
    return /^(?:I will|I'll)\b/i.test(line.trim());
}
function isBoilerplateHeading(line) {
    return /^(?:#{1,6}\s*)?(?:[-*]\s*)?(?:files changed|commands run|tests run|remaining risks|human review needed)\s*:?\s*$/i.test(line.trim());
}
function isBridgeLog(line) {
    return /^\[antigravity-bridge\]/i.test(line.trim());
}
function neutralLogSummary(markdown) {
    const cleaned = stripFences(markdown);
    const line = cleaned
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find((entry) => entry && !isBridgeLog(entry) && !isNarration(entry)) || "";
    return line ? compactText(line, 240) : "Result output is available in the raw log.";
}
function looksLogOnly(markdown) {
    const normalized = normalizeMarkdownHeadings(markdown);
    const lines = markdown
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    return lines.length > 0 && lines.some(isBridgeLog) && !extractJsonBlock(markdown) && !/^#{1,6}\s*.*(?:summary|verdict)\s*$/im.test(normalized);
}
function normalizeMarkdownHeadings(markdown) {
    return markdown.replace(/([^\r\n#])(#{1,6}\s+)/g, "$1\n$2");
}
function isSummaryHeading(line) {
    return /^#{1,6}\s*.*(?:summary|verdict)\s*$/i.test(line.trim());
}
function extractSummaryHeading(cleaned) {
    const lines = normalizeMarkdownHeadings(cleaned).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        if (!isSummaryHeading(lines[i]))
            continue;
        const section = [];
        for (let j = i + 1; j < lines.length; j++) {
            if (/^#{1,6}\s+\S/.test(lines[j]))
                break;
            section.push(lines[j]);
        }
        const text = section.join("\n").trim();
        if (text)
            return compactText(text);
    }
    return "";
}
function extractInlineSummary(cleaned) {
    const match = cleaned.match(/(?:^|\n)\s*summary\s*:\s*([\s\S]*?)(?=\n\s*(?:#{1,6}\s+\S|[A-Z][A-Za-z ]{2,40}\s*:)|$)/i);
    return match ? compactText(match[1]) : "";
}
function lastMeaningfulParagraph(cleaned) {
    const blocks = cleaned
        .split(/\n\s*\n/)
        .map((block) => block
        .split(/\r?\n/)
        .filter((line) => !isNarration(line) && !isBridgeLog(line))
        .join("\n")
        .trim())
        .filter(Boolean)
        .filter((block) => !isBoilerplateHeading(block.split(/\r?\n/)[0] || ""))
        .filter((block) => !/^(?:none|n\/a)$/i.test(block.trim()));
    return blocks.length ? compactText(blocks[blocks.length - 1]) : "";
}
export function extractSummary(markdown) {
    const json = extractJsonBlock(markdown);
    if (json && typeof json.summary === "string" && json.summary.trim()) {
        return compactText(json.summary);
    }
    if (looksLogOnly(markdown))
        return neutralLogSummary(markdown);
    const cleaned = stripFences(markdown);
    return (extractSummaryHeading(cleaned) ||
        extractInlineSummary(cleaned) ||
        lastMeaningfulParagraph(cleaned) ||
        neutralLogSummary(markdown));
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
        const res = childProcess.spawnSync("git", ["status", "--porcelain=v2", "--untracked-files=all", "-z"], {
            cwd,
            encoding: "buffer",
            timeout: 5000,
            windowsHide: true
        });
        return parsePorcelainV2Paths(res.stdout || Buffer.alloc(0));
    }
    catch {
        return [];
    }
}
function pathAfterFields(record, fieldCountBeforePath) {
    let idx = -1;
    for (let i = 0; i < fieldCountBeforePath; i++) {
        idx = record.indexOf(" ", idx + 1);
        if (idx === -1)
            return "";
    }
    return record.slice(idx + 1);
}
function parsePorcelainV2Paths(stdout) {
    const records = stdout.toString().split("\0");
    const paths = [];
    for (let i = 0; i < records.length; i++) {
        const record = records[i];
        if (!record)
            continue;
        const type = record[0];
        if (type === "?" || type === "!") {
            const filePath = record.slice(2);
            if (filePath)
                paths.push(filePath);
            continue;
        }
        if (type === "1" || type === "u") {
            const filePath = pathAfterFields(record, type === "1" ? 8 : 10);
            if (filePath)
                paths.push(filePath);
            continue;
        }
        if (type === "2") {
            const filePath = pathAfterFields(record, 9);
            if (filePath)
                paths.push(filePath);
            i += 1;
        }
    }
    return paths;
}
export function changedSince(cwd, baseline) {
    const before = new Set(baseline);
    // Path-only attribution removes launch-time dirty noise, but it can miss a baseline-dirty file
    // that the job edits again. Content signatures would be needed for that stronger contract.
    return gitChangedFiles(cwd).filter((filePath) => !before.has(filePath));
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
