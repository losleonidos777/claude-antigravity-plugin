import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { safeLogLine, truncate } from "./safety.js";
import { stripAnsi, extractFinalTuiFrame } from "./ansi.js";
// node-pty is a native CommonJS module loaded lazily via createRequire so ESM builds work,
// and so the plugin still loads on platforms where the native prebuild is missing.
const cjsRequire = createRequire(import.meta.url);
let cachedPty;
function loadPty() {
    if (cachedPty !== undefined)
        return cachedPty;
    try {
        cachedPty = cjsRequire("node-pty");
    }
    catch (error) {
        cachedPty = null;
    }
    return cachedPty;
}
function append(filePath, text) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, text, "utf8");
}
const PROMPT_FLAGS_FOR_REDACTION = new Set(["--prompt", "--print", "--message", "-p"]);
export function redactInvocationArgs(args) {
    const out = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        out.push(arg);
        if (PROMPT_FLAGS_FOR_REDACTION.has(arg) && i + 1 < args.length) {
            const next = args[i + 1];
            out.push(`<prompt-omitted ${next.length} chars; see prompt.md>`);
            i++;
        }
    }
    return out;
}
function openLog(logPath, invocation, cwd) {
    const safeArgs = redactInvocationArgs(invocation.args);
    fs.writeFileSync(logPath, `[antigravity-bridge] cwd=${cwd}\n[antigravity-bridge] strategy=${invocation.strategy}\n[antigravity-bridge] command=${[invocation.command, ...safeArgs].join(" ")}\n`, "utf8");
}
export function killProcessTree(pid, signal = "SIGTERM") {
    if (!pid || pid <= 0)
        return false;
    try {
        if (process.platform === "win32") {
            const res = childProcess.spawnSync("taskkill", ["/PID", String(pid), "/T", signal === "SIGKILL" ? "/F" : ""].filter(Boolean), { windowsHide: true, encoding: "utf8" });
            return res.status === 0;
        }
        try {
            process.kill(-pid, signal);
        }
        catch {
            process.kill(pid, signal);
        }
        return true;
    }
    catch {
        return false;
    }
}
// Cross-platform liveness probe. Signal 0 performs the permission/existence check
// without delivering a signal; ESRCH means gone, EPERM means alive but not ours.
export function processIsAlive(pid) {
    if (!pid || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error?.code === "EPERM";
    }
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// Send a signal, then VERIFY the process actually died rather than trusting taskkill's
// "signal sent" exit code (a spinning Windows console CLI ignores /T without /F yet
// taskkill still exits 0). On a surviving SIGTERM we escalate to a forced SIGKILL.
export async function killProcessTreeConfirmed(pid, signal = "SIGTERM", graceMs = 2500) {
    if (!pid || pid <= 0)
        return { killed: false, escalated: false };
    killProcessTree(pid, signal);
    if (signal === "SIGKILL") {
        await delay(Math.min(graceMs, 800));
        return { killed: !processIsAlive(pid), escalated: false };
    }
    // SIGTERM ladder: give the process the grace period, then force-kill if it survives.
    await delay(graceMs);
    if (!processIsAlive(pid))
        return { killed: true, escalated: false };
    killProcessTree(pid, "SIGKILL");
    await delay(800);
    return { killed: !processIsAlive(pid), escalated: true };
}
export async function runForeground(invocation, options) {
    if (invocation.requiresPty) {
        return runForegroundPty(invocation, options);
    }
    return runForegroundPipe(invocation, options);
}
async function runForegroundPipe(invocation, options) {
    openLog(options.logPath, invocation, options.cwd);
    return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const child = childProcess.spawn(invocation.command, invocation.args, {
            cwd: options.cwd,
            env: { ...process.env, ...(options.env || {}) },
            detached: process.platform !== "win32",
            windowsHide: true,
            stdio: [invocation.stdinFile || invocation.stdinText ? "pipe" : "ignore", "pipe", "pipe"]
        });
        let killTimer = null;
        const timer = setTimeout(() => {
            timedOut = true;
            append(options.logPath, `\n[antigravity-bridge] timeout after ${options.timeoutMs}ms; terminating process tree\n`);
            killProcessTree(child.pid, "SIGTERM");
            killTimer = setTimeout(() => killProcessTree(child.pid, "SIGKILL"), 2500);
        }, options.timeoutMs);
        if (invocation.stdinFile && child.stdin) {
            fs.createReadStream(invocation.stdinFile).pipe(child.stdin);
        }
        else if (invocation.stdinText && child.stdin) {
            child.stdin.write(invocation.stdinText);
            child.stdin.end();
        }
        child.stdout.on("data", (chunk) => {
            const text = safeLogLine(String(chunk));
            stdout += text;
            stdout = truncate(stdout, options.maxResultChars || 500_000);
            append(options.logPath, text);
        });
        child.stderr.on("data", (chunk) => {
            const text = safeLogLine(String(chunk));
            stderr += text;
            stderr = truncate(stderr, options.maxResultChars || 200_000);
            append(options.logPath, text);
        });
        child.on("error", (error) => {
            stderr += String(error?.message || error);
            append(options.logPath, `\n[antigravity-bridge] spawn error: ${safeLogLine(String(error?.message || error))}\n`);
        });
        child.on("close", (exitCode, signal) => {
            clearTimeout(timer);
            if (killTimer)
                clearTimeout(killTimer);
            const status = timedOut ? "timeout" : exitCode === 0 ? "completed" : "failed";
            const result = { status, exitCode, signal, stdout, stderr, pid: child.pid };
            append(options.logPath, `\n[antigravity-bridge] done exitCode=${exitCode} signal=${signal || ""} status=${status}\n`);
            if (options.resultPath) {
                fs.writeFileSync(options.resultPath, truncate(stdout || stderr || "", options.maxResultChars || 500_000), "utf8");
            }
            resolve(result);
        });
    });
}
export function runBackground(invocation, options) {
    if (invocation.requiresPty) {
        return runBackgroundPty(invocation, options);
    }
    return runBackgroundPipe(invocation, options);
}
function runBackgroundPipe(invocation, options) {
    openLog(options.logPath, invocation, options.cwd);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = childProcess.spawn(invocation.command, invocation.args, {
        cwd: options.cwd,
        env: { ...process.env, ...(options.env || {}) },
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: [invocation.stdinFile || invocation.stdinText ? "pipe" : "ignore", "pipe", "pipe"]
    });
    let killTimer = null;
    const timer = setTimeout(() => {
        timedOut = true;
        append(options.logPath, `\n[antigravity-bridge] timeout after ${options.timeoutMs}ms; terminating process tree\n`);
        killProcessTree(child.pid, "SIGTERM");
        killTimer = setTimeout(() => killProcessTree(child.pid, "SIGKILL"), 2500);
    }, options.timeoutMs);
    if (invocation.stdinFile && child.stdin) {
        fs.createReadStream(invocation.stdinFile).pipe(child.stdin);
    }
    else if (invocation.stdinText && child.stdin) {
        child.stdin.write(invocation.stdinText);
        child.stdin.end();
    }
    child.stdout.on("data", (chunk) => {
        const text = safeLogLine(String(chunk));
        stdout += text;
        stdout = truncate(stdout, options.maxResultChars || 500_000);
        append(options.logPath, text);
    });
    child.stderr.on("data", (chunk) => {
        const text = safeLogLine(String(chunk));
        stderr += text;
        stderr = truncate(stderr, options.maxResultChars || 200_000);
        append(options.logPath, text);
    });
    child.on("close", (exitCode, signal) => {
        clearTimeout(timer);
        if (killTimer)
            clearTimeout(killTimer);
        const status = timedOut ? "timeout" : exitCode === 0 ? "completed" : "failed";
        const result = { status, exitCode, signal, stdout, stderr, pid: child.pid };
        append(options.logPath, `\n[antigravity-bridge] done exitCode=${exitCode} signal=${signal || ""} status=${status}\n`);
        if (options.resultPath) {
            fs.writeFileSync(options.resultPath, truncate(stdout || stderr || "", options.maxResultChars || 500_000), "utf8");
        }
        options.onExit?.(result);
    });
    child.on("error", (error) => {
        append(options.logPath, `\n[antigravity-bridge] spawn error: ${safeLogLine(String(error?.message || error))}\n`);
    });
    return { pid: child.pid };
}
function readStdinText(invocation) {
    if (invocation.stdinText)
        return invocation.stdinText;
    if (invocation.stdinFile) {
        try {
            return fs.readFileSync(invocation.stdinFile, "utf8");
        }
        catch {
            return null;
        }
    }
    return null;
}
function spawnPty(invocation, options, callbacks) {
    const pty = loadPty();
    if (!pty) {
        const message = "PTY-mode requested but node-pty native module failed to load. Reinstall the plugin server (npm install) or set ANTIGRAVITY_FORCE_PIPE=1 to bypass.";
        append(options.logPath, `\n[antigravity-bridge] ${message}\n`);
        const result = { status: "failed", exitCode: null, signal: null, stdout: "", stderr: message };
        if (options.resultPath)
            fs.writeFileSync(options.resultPath, message, "utf8");
        setImmediate(() => callbacks.onResult(result));
        return { pid: 0, cancel: () => { } };
    }
    openLog(options.logPath, invocation, options.cwd);
    append(options.logPath, `[antigravity-bridge] transport=pty (node-pty)\n`);
    let raw = "";
    let timedOut = false;
    let killTimer = null;
    const env = { ...process.env, ...(options.env || {}) };
    let child;
    try {
        // Tame TUI rendering: a wide virtual terminal keeps long lines on one row.
        child = pty.spawn(invocation.command, invocation.args, {
            name: "xterm-256color",
            cols: 220,
            rows: 60,
            cwd: options.cwd,
            env
        });
    }
    catch (error) {
        const message = `pty spawn failed: ${error?.message || String(error)}`;
        append(options.logPath, `\n[antigravity-bridge] ${safeLogLine(message)}\n`);
        if (options.resultPath) {
            try {
                fs.writeFileSync(options.resultPath, message, "utf8");
            }
            catch { }
        }
        const result = { status: "failed", exitCode: null, signal: null, stdout: "", stderr: message };
        setImmediate(() => callbacks.onResult(result));
        return { pid: 0, cancel: () => { } };
    }
    const stdinText = readStdinText(invocation);
    if (stdinText) {
        try {
            child.write(stdinText);
        }
        catch (error) {
            append(options.logPath, `\n[antigravity-bridge] pty stdin write failed: ${safeLogLine(String(error?.message || error))}\n`);
        }
    }
    const timer = setTimeout(() => {
        timedOut = true;
        append(options.logPath, `\n[antigravity-bridge] pty timeout after ${options.timeoutMs}ms; sending SIGTERM\n`);
        try {
            child.kill("SIGTERM");
        }
        catch { }
        killTimer = setTimeout(() => {
            try {
                child.kill("SIGKILL");
            }
            catch { }
            killProcessTree(child.pid, "SIGKILL");
        }, 2500);
    }, options.timeoutMs);
    const maxRaw = (options.maxResultChars || 500_000) * 2; // raw TUI stream is ~2x final text after stripping
    child.onData((chunk) => {
        raw += chunk;
        if (raw.length > maxRaw)
            raw = raw.slice(raw.length - maxRaw);
    });
    child.onExit(({ exitCode, signal }) => {
        clearTimeout(timer);
        if (killTimer)
            clearTimeout(killTimer);
        const stdout = stripAnsi(raw);
        const final = extractFinalTuiFrame(raw);
        const status = timedOut ? "timeout" : exitCode === 0 ? "completed" : "failed";
        const cleanedForLog = safeLogLine(stdout).slice(0, options.maxResultChars || 500_000);
        append(options.logPath, `\n[antigravity-bridge] pty-output-bytes-raw=${raw.length} cleaned-bytes=${stdout.length} final-frame-bytes=${final.length}\n`);
        append(options.logPath, `\n[antigravity-bridge] cleaned-stdout-preview:\n${cleanedForLog.slice(0, 8000)}\n`);
        append(options.logPath, `\n[antigravity-bridge] done exitCode=${exitCode} signal=${signal ?? ""} status=${status}\n`);
        const resultText = final || stdout;
        if (options.resultPath) {
            fs.writeFileSync(options.resultPath, truncate(resultText, options.maxResultChars || 500_000), "utf8");
        }
        callbacks.onResult({
            status,
            exitCode: exitCode ?? null,
            signal: signal ? String(signal) : null,
            stdout: resultText,
            stderr: "",
            pid: child.pid
        });
    });
    return {
        pid: child.pid,
        cancel: () => {
            try {
                child.kill("SIGTERM");
            }
            catch { }
        }
    };
}
async function runForegroundPty(invocation, options) {
    return new Promise((resolve) => {
        spawnPty(invocation, options, { onResult: resolve });
    });
}
function runBackgroundPty(invocation, options) {
    const handle = spawnPty(invocation, options, {
        onResult: (result) => {
            options.onExit?.(result);
        }
    });
    return { pid: handle.pid };
}
