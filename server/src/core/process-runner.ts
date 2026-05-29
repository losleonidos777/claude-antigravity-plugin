import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { Invocation } from "./cli-adapter.js";
import { safeLogLine, truncate } from "./safety.js";
import { stripAnsi, extractFinalTuiFrame } from "./ansi.js";

// node-pty is a native CommonJS module loaded lazily via createRequire so ESM builds work,
// and so the plugin still loads on platforms where the native prebuild is missing.
const cjsRequire = createRequire(import.meta.url);
type PtyModule = typeof import("node-pty");
let cachedPty: PtyModule | null | undefined;
function loadPty(): PtyModule | null {
  if (cachedPty !== undefined) return cachedPty;
  try {
    cachedPty = cjsRequire("node-pty") as PtyModule;
  } catch (error: any) {
    cachedPty = null;
  }
  return cachedPty;
}

export interface RunOptions {
  cwd: string;
  logPath: string;
  resultPath?: string;
  timeoutMs: number;
  env?: Record<string, string>;
  onExit?: (result: RunResult) => void;
  maxResultChars?: number;
}

export interface RunResult {
  status: "completed" | "failed" | "timeout" | "cancelled";
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  pid?: number;
}

function append(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, text, "utf8");
}

const PROMPT_FLAGS_FOR_REDACTION = new Set(["--prompt", "--print", "--message", "-p"]);

export function redactInvocationArgs(args: readonly string[]): string[] {
  const out: string[] = [];
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

function openLog(logPath: string, invocation: Invocation, cwd: string): void {
  const safeArgs = redactInvocationArgs(invocation.args);
  fs.writeFileSync(
    logPath,
    `[antigravity-bridge] cwd=${cwd}\n[antigravity-bridge] strategy=${invocation.strategy}\n[antigravity-bridge] command=${[invocation.command, ...safeArgs].join(" ")}\n`,
    "utf8"
  );
}

export function killProcessTree(pid: number, signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): boolean {
  if (!pid || pid <= 0) return false;
  try {
    if (process.platform === "win32") {
      const res = childProcess.spawnSync(
        "taskkill",
        ["/PID", String(pid), "/T", signal === "SIGKILL" ? "/F" : ""].filter(Boolean),
        { windowsHide: true, encoding: "utf8" }
      );
      return res.status === 0;
    }
    try {
      process.kill(-pid, signal);
    } catch {
      process.kill(pid, signal);
    }
    return true;
  } catch {
    return false;
  }
}

export async function runForeground(invocation: Invocation, options: RunOptions): Promise<RunResult> {
  if (invocation.requiresPty) {
    return runForegroundPty(invocation, options);
  }
  return runForegroundPipe(invocation, options);
}

async function runForegroundPipe(invocation: Invocation, options: RunOptions): Promise<RunResult> {
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

    let killTimer: NodeJS.Timeout | null = null;
    const timer = setTimeout(() => {
      timedOut = true;
      append(options.logPath, `\n[antigravity-bridge] timeout after ${options.timeoutMs}ms; terminating process tree\n`);
      killProcessTree(child.pid, "SIGTERM");
      killTimer = setTimeout(() => killProcessTree(child.pid, "SIGKILL"), 2500);
    }, options.timeoutMs);

    if (invocation.stdinFile && child.stdin) {
      fs.createReadStream(invocation.stdinFile).pipe(child.stdin);
    } else if (invocation.stdinText && child.stdin) {
      child.stdin.write(invocation.stdinText);
      child.stdin.end();
    }

    child.stdout.on("data", (chunk: any) => {
      const text = safeLogLine(String(chunk));
      stdout += text;
      stdout = truncate(stdout, options.maxResultChars || 500_000);
      append(options.logPath, text);
    });
    child.stderr.on("data", (chunk: any) => {
      const text = safeLogLine(String(chunk));
      stderr += text;
      stderr = truncate(stderr, options.maxResultChars || 200_000);
      append(options.logPath, text);
    });
    child.on("error", (error: any) => {
      stderr += String(error?.message || error);
      append(options.logPath, `\n[antigravity-bridge] spawn error: ${safeLogLine(String(error?.message || error))}\n`);
    });
    child.on("close", (exitCode: number | null, signal: string | null) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      const status: RunResult["status"] = timedOut ? "timeout" : exitCode === 0 ? "completed" : "failed";
      const result: RunResult = { status, exitCode, signal, stdout, stderr, pid: child.pid };
      append(options.logPath, `\n[antigravity-bridge] done exitCode=${exitCode} signal=${signal || ""} status=${status}\n`);
      if (options.resultPath) {
        fs.writeFileSync(options.resultPath, truncate(stdout || stderr || "", options.maxResultChars || 500_000), "utf8");
      }
      resolve(result);
    });
  });
}

export function runBackground(invocation: Invocation, options: RunOptions): { pid: number } {
  if (invocation.requiresPty) {
    return runBackgroundPty(invocation, options);
  }
  return runBackgroundPipe(invocation, options);
}

function runBackgroundPipe(invocation: Invocation, options: RunOptions): { pid: number } {
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

  let killTimer: NodeJS.Timeout | null = null;
  const timer = setTimeout(() => {
    timedOut = true;
    append(options.logPath, `\n[antigravity-bridge] timeout after ${options.timeoutMs}ms; terminating process tree\n`);
    killProcessTree(child.pid, "SIGTERM");
    killTimer = setTimeout(() => killProcessTree(child.pid, "SIGKILL"), 2500);
  }, options.timeoutMs);

  if (invocation.stdinFile && child.stdin) {
    fs.createReadStream(invocation.stdinFile).pipe(child.stdin);
  } else if (invocation.stdinText && child.stdin) {
    child.stdin.write(invocation.stdinText);
    child.stdin.end();
  }

  child.stdout.on("data", (chunk: any) => {
    const text = safeLogLine(String(chunk));
    stdout += text;
    stdout = truncate(stdout, options.maxResultChars || 500_000);
    append(options.logPath, text);
  });
  child.stderr.on("data", (chunk: any) => {
    const text = safeLogLine(String(chunk));
    stderr += text;
    stderr = truncate(stderr, options.maxResultChars || 200_000);
    append(options.logPath, text);
  });
  child.on("close", (exitCode: number | null, signal: string | null) => {
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    const status: RunResult["status"] = timedOut ? "timeout" : exitCode === 0 ? "completed" : "failed";
    const result: RunResult = { status, exitCode, signal, stdout, stderr, pid: child.pid };
    append(options.logPath, `\n[antigravity-bridge] done exitCode=${exitCode} signal=${signal || ""} status=${status}\n`);
    if (options.resultPath) {
      fs.writeFileSync(options.resultPath, truncate(stdout || stderr || "", options.maxResultChars || 500_000), "utf8");
    }
    options.onExit?.(result);
  });
  child.on("error", (error: any) => {
    append(options.logPath, `\n[antigravity-bridge] spawn error: ${safeLogLine(String(error?.message || error))}\n`);
  });
  return { pid: child.pid };
}

// ---------- PTY-mode runners (for CLIs that suppress stdout under pipe stdio) ----------

interface PtyRunCallbacks {
  onResult: (result: RunResult) => void;
}

function readStdinText(invocation: Invocation): string | null {
  if (invocation.stdinText) return invocation.stdinText;
  if (invocation.stdinFile) {
    try {
      return fs.readFileSync(invocation.stdinFile, "utf8");
    } catch {
      return null;
    }
  }
  return null;
}

function spawnPty(invocation: Invocation, options: RunOptions, callbacks: PtyRunCallbacks): { pid: number; cancel: () => void } {
  const pty = loadPty();
  if (!pty) {
    const message = "PTY-mode requested but node-pty native module failed to load. Reinstall the plugin server (npm install) or set ANTIGRAVITY_FORCE_PIPE=1 to bypass.";
    append(options.logPath, `\n[antigravity-bridge] ${message}\n`);
    const result: RunResult = { status: "failed", exitCode: null, signal: null, stdout: "", stderr: message };
    if (options.resultPath) fs.writeFileSync(options.resultPath, message, "utf8");
    setImmediate(() => callbacks.onResult(result));
    return { pid: 0, cancel: () => {} };
  }

  openLog(options.logPath, invocation, options.cwd);
  append(options.logPath, `[antigravity-bridge] transport=pty (node-pty)\n`);

  let raw = "";
  let timedOut = false;
  let killTimer: NodeJS.Timeout | null = null;

  const env: Record<string, string> = { ...(process.env as Record<string, string>), ...(options.env || {}) };
  let child: ReturnType<NonNullable<PtyModule>["spawn"]>;
  try {
    // Tame TUI rendering: a wide virtual terminal keeps long lines on one row.
    child = pty.spawn(invocation.command, invocation.args, {
      name: "xterm-256color",
      cols: 220,
      rows: 60,
      cwd: options.cwd,
      env
    });
  } catch (error: any) {
    const message = `pty spawn failed: ${error?.message || String(error)}`;
    append(options.logPath, `\n[antigravity-bridge] ${safeLogLine(message)}\n`);
    if (options.resultPath) {
      try {
        fs.writeFileSync(options.resultPath, message, "utf8");
      } catch {}
    }
    const result: RunResult = { status: "failed", exitCode: null, signal: null, stdout: "", stderr: message };
    setImmediate(() => callbacks.onResult(result));
    return { pid: 0, cancel: () => {} };
  }

  const stdinText = readStdinText(invocation);
  if (stdinText) {
    try {
      child.write(stdinText);
    } catch (error: any) {
      append(options.logPath, `\n[antigravity-bridge] pty stdin write failed: ${safeLogLine(String(error?.message || error))}\n`);
    }
  }

  const timer = setTimeout(() => {
    timedOut = true;
    append(options.logPath, `\n[antigravity-bridge] pty timeout after ${options.timeoutMs}ms; sending SIGTERM\n`);
    try {
      child.kill("SIGTERM");
    } catch {}
    killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      killProcessTree(child.pid, "SIGKILL");
    }, 2500);
  }, options.timeoutMs);

  const maxRaw = (options.maxResultChars || 500_000) * 2; // raw TUI stream is ~2x final text after stripping
  child.onData((chunk: string) => {
    raw += chunk;
    if (raw.length > maxRaw) raw = raw.slice(raw.length - maxRaw);
  });

  child.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);

    const stdout = stripAnsi(raw);
    const final = extractFinalTuiFrame(raw);
    const status: RunResult["status"] = timedOut ? "timeout" : exitCode === 0 ? "completed" : "failed";
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
      } catch {}
    }
  };
}

async function runForegroundPty(invocation: Invocation, options: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    spawnPty(invocation, options, { onResult: resolve });
  });
}

function runBackgroundPty(invocation: Invocation, options: RunOptions): { pid: number } {
  const handle = spawnPty(invocation, options, {
    onResult: (result) => {
      options.onExit?.(result);
    }
  });
  return { pid: handle.pid };
}
