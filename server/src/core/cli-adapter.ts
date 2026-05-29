import * as childProcess from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { truncate } from "./safety.js";

export interface BinaryResolution {
  command: string | null;
  version: string | null;
  error?: string;
}

export interface CliCapabilities {
  nonInteractivePrompt: boolean;
  stdinPrompt: boolean;
  promptFlag: boolean;
  /** Exact flag name to emit for argv-style prompts (e.g. "--prompt", "--print", "--message"). null if not detected. */
  promptFlagName: string | null;
  promptFile: boolean;
  jsonOutput: boolean;
  backgroundJobs: boolean;
  worktreeSafe: boolean;
  authStatus: boolean;
  commandTemplate: boolean;
  degradedTuiOnly: boolean;
  hasRunSubcommand: boolean;
}

const WIN_ARG_BUDGET = 28000;
const POSIX_ARG_BUDGET = 120000;
export function argBudget(): number {
  return process.platform === "win32" ? WIN_ARG_BUDGET : POSIX_ARG_BUDGET;
}

/**
 * Estimate the effective Windows command-line length after Node-style argv quoting.
 * Each arg becomes ~ `"<escaped>"` when it contains whitespace or quotes.
 * Backslashes before quotes are doubled. We approximate by counting quotes/backslashes.
 */
export function estimateWindowsCmdLine(command: string, args: readonly string[]): number {
  if (process.platform !== "win32") {
    return command.length + args.reduce((acc, a) => acc + a.length + 1, 0);
  }
  let total = command.length + 2;
  for (const arg of args) {
    let escaped = arg.length;
    let quotes = 0;
    let backslashes = 0;
    for (let i = 0; i < arg.length; i++) {
      const ch = arg.charCodeAt(i);
      if (ch === 34) quotes++;
      else if (ch === 92) backslashes++;
    }
    escaped += quotes;
    escaped += backslashes;
    if (/\s|"/.test(arg) || arg.length === 0) escaped += 2;
    total += 1 + escaped;
  }
  return total;
}

/** Hard Windows command-line ceiling per CreateProcess; leave headroom. */
const WIN_CMDLINE_HARD_LIMIT = 32000;

export interface DoctorResult {
  ok: boolean;
  binary: {
    resolvedPath: string | null;
    version: string | null;
    helpHash: string | null;
  };
  auth: {
    status: "unknown" | "authenticated" | "not_authenticated" | "error";
    accountHint?: string;
    planHint?: string;
  };
  project: {
    root: string;
    gitDetected: boolean;
    cleanWorktree: boolean;
  };
  capabilities: CliCapabilities;
  warnings: string[];
  errors: string[];
  help?: {
    main?: string;
    run?: string;
    auth?: string;
    plugin?: string;
  };
}

export interface Invocation {
  command: string;
  args: string[];
  stdinText?: string;
  stdinFile?: string;
  strategy: string;
  /** Spawn under a pseudo-TTY (node-pty) instead of pipes.
   *  Needed for CLIs that suppress stdout when stdio is redirected (agy 1.0.3 on Windows). */
  requiresPty?: boolean;
}

function pathExts(): string[] {
  if (process.platform !== "win32") return [""];
  return String(process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";");
}

function executableExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveFromPath(command: string): string | null {
  if (!command) return null;
  if (command.includes(path.sep) || (process.platform === "win32" && command.includes("\\"))) {
    return executableExists(command) ? path.resolve(command) : command;
  }
  const dirs = String(process.env.PATH || "").split(path.delimiter);
  for (const dir of dirs) {
    for (const ext of pathExts()) {
      const candidate = path.join(dir, command + ext);
      if (executableExists(candidate)) return candidate;
    }
  }
  return command;
}

function runSync(command: string, args: string[], cwd?: string, timeoutMs = 4000): { status: number | null; stdout: string; stderr: string; error?: string } {
  try {
    const res = childProcess.spawnSync(command, args, {
      cwd,
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
      env: { ...process.env, AGY_CLI_HIDE_ACCOUNT_INFO: process.env.AGY_CLI_HIDE_ACCOUNT_INFO || "1" }
    });
    return {
      status: res.status,
      stdout: String(res.stdout || ""),
      stderr: String(res.stderr || ""),
      error: res.error ? String(res.error.message || res.error) : undefined
    };
  } catch (error: any) {
    return { status: null, stdout: "", stderr: "", error: String(error?.message || error) };
  }
}

export function resolveBinary(): BinaryResolution {
  const configured = String(process.env.AGY_BIN || "").trim();
  const candidates = Array.from(new Set([configured, "agy", "antigravity"].filter(Boolean)));
  const errors: string[] = [];
  for (const candidate of candidates) {
    const resolved = resolveFromPath(candidate);
    if (!resolved) continue;
    const version = runSync(resolved, ["--version"], undefined, 5000);
    if (!version.error || !/ENOENT|not found/i.test(version.error)) {
      if (version.status === 0 || version.stdout || version.stderr) {
        return {
          command: resolved,
          version: truncate(`${version.stdout}${version.stderr}`.trim(), 2000) || null
        };
      }
      errors.push(`${candidate}: ${version.error || `exit ${version.status}`}`);
    }
  }
  return {
    command: null,
    version: null,
    error: errors.length ? errors.join("; ") : "Antigravity CLI binary not found. Install agy or set AGY_BIN."
  };
}

export function detectCapabilitiesFromHelp(mainHelp: string, runHelp: string, authHelp: string): CliCapabilities {
  const all = `${mainHelp}\n${runHelp}\n${authHelp}`.toLowerCase();
  const run = runHelp.toLowerCase();
  const template = Boolean(String(process.env.ANTIGRAVITY_CLI_TEMPLATE || "").trim());
  const promptFile = /--prompt-file|--file|--input-file/.test(run) || /--prompt-file/.test(all);

  let promptFlagName: string | null = null;
  for (const candidate of ["--prompt", "--print", "--message"]) {
    if (new RegExp(`${candidate}\\b`).test(all)) {
      promptFlagName = candidate;
      break;
    }
  }
  const promptFlag = promptFlagName !== null;

  const stdinPrompt = /--stdin|--input.*stdin|read.*stdin/.test(all);
  const hasRunSubcommand =
    /^\s*run\s/m.test(mainHelp) ||
    /\bsubcommands?\b[^\n]*\brun\b/i.test(mainHelp) ||
    /\bcommands?\b[^\n]*\brun\b/i.test(mainHelp) ||
    /\busage:\s+\S+\s+run\b/i.test(mainHelp);
  const hasRunLike = /\brun\b|\bexec\b|\bask\b/.test(all);
  return {
    nonInteractivePrompt: template || promptFile || promptFlag || stdinPrompt,
    stdinPrompt,
    promptFlag,
    promptFlagName,
    promptFile,
    jsonOutput: /--json|json output|output.*json/.test(all),
    backgroundJobs: /background|async|job|resume/.test(all),
    worktreeSafe: /sandbox|permission|approval|worktree/.test(all),
    authStatus: /status|whoami|login|logout/.test(authHelp.toLowerCase()),
    commandTemplate: template,
    degradedTuiOnly: hasRunLike && !(template || promptFile || promptFlag || stdinPrompt),
    hasRunSubcommand
  };
}

function safeSplitTemplate(template: string, promptPath: string, mode: string): string[] {
  const replaced = template.replaceAll("{prompt}", promptPath).replaceAll("{mode}", mode);
  const args: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaping = false;
  for (const ch of replaced) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) args.push(current);
  return args;
}

export function buildInvocation(params: {
  binary: string;
  capabilities: CliCapabilities;
  promptPath: string;
  promptText: string;
  mode: string;
  jsonPreferred?: boolean;
}): Invocation {
  const requiresPty = shouldUsePty(params.binary);
  const template = String(process.env.ANTIGRAVITY_CLI_TEMPLATE || "").trim();
  if (template) {
    return {
      command: params.binary,
      args: safeSplitTemplate(template, params.promptPath, params.mode),
      strategy: "env-template",
      requiresPty
    };
  }

  const jsonArgs = params.capabilities.jsonOutput && params.jsonPreferred !== false ? ["--json"] : [];
  const prefix: string[] = params.capabilities.hasRunSubcommand ? ["run"] : [];
  if (params.capabilities.promptFile) {
    return {
      command: params.binary,
      args: [...prefix, "--prompt-file", params.promptPath, ...jsonArgs],
      strategy: prefix.length ? "run-prompt-file" : "prompt-file",
      requiresPty
    };
  }
  if (params.capabilities.stdinPrompt) {
    // PTY transport cannot reliably signal EOF on stdin (no documented way to close ConPTY's
    // input stream cleanly), so stdin-driven prompts must use the pipe transport. The CLI
    // suppressing stdout under pipes only affects argv-driven prompt invocations.
    return {
      command: params.binary,
      args: [...prefix, "--stdin", ...jsonArgs],
      stdinFile: params.promptPath,
      strategy: prefix.length ? "run-stdin" : "stdin",
      requiresPty: false
    };
  }
  if (params.capabilities.promptFlag) {
    const flagName = params.capabilities.promptFlagName || "--prompt";
    const candidateArgs = [...prefix, flagName, params.promptText, ...jsonArgs];
    const budget = argBudget();
    if (params.promptText.length > budget) {
      throw new Error(
        `Prompt is ${params.promptText.length} chars but argv-only Antigravity CLI cannot accept more than ~${budget} on ${process.platform}. ` +
          `Narrow the review target (focus / file / commit-range) or upgrade Antigravity CLI to a version that exposes --prompt-file or --stdin.`
      );
    }
    if (process.platform === "win32") {
      const projected = estimateWindowsCmdLine(params.binary, candidateArgs);
      if (projected > WIN_CMDLINE_HARD_LIMIT) {
        throw new Error(
          `Projected Windows command line is ${projected} chars (limit ~${WIN_CMDLINE_HARD_LIMIT}) once quoting overhead is included. ` +
            `Narrow the review target or upgrade Antigravity CLI to a version that exposes --prompt-file or --stdin.`
        );
      }
    }
    return {
      command: params.binary,
      args: candidateArgs,
      strategy: prefix.length ? "run-prompt-flag" : "prompt-flag",
      requiresPty
    };
  }

  throw new Error(
    "Binary found but non-interactive prompt mode is unsupported or unknown. Run `agy --help` and set plugin option cli_template, for example: --prompt-file {prompt}"
  );
}

/**
 * Antigravity CLI 1.0.3 on Windows suppresses stdout when stdio is piped — confirmed by
 * upstream GitHub issues #76 and #187. Spawning under a pseudo-TTY (node-pty) makes the
 * binary write its model response normally. Restricted to win32 + agy/antigravity by default;
 * users can override via env vars.
 */
export function shouldUsePty(binaryPath: string): boolean {
  if (process.env.ANTIGRAVITY_FORCE_PIPE === "1") return false;
  if (process.env.ANTIGRAVITY_FORCE_PTY === "1") return true;
  if (process.platform !== "win32") return false;
  const base = (binaryPath.split(/[\\/]/).pop() || "").toLowerCase().replace(/\.exe$/, "");
  return base === "agy" || base === "antigravity";
}

function inspectAuth(command: string, cwd: string): DoctorResult["auth"] {
  const candidates = [
    ["auth", "status"],
    ["account"],
    ["whoami"]
  ];
  for (const args of candidates) {
    const res = runSync(command, args, cwd, 5000);
    const text = `${res.stdout}\n${res.stderr}`.trim();
    if (res.status === 0 && text) {
      return { status: "authenticated", accountHint: text.split("\n").slice(0, 2).join(" | ") };
    }
    if (/not.*login|not.*auth|sign in|login required|unauth/i.test(text)) {
      return { status: "not_authenticated" };
    }
  }
  return { status: "unknown" };
}

function gitProject(cwd: string): { gitDetected: boolean; cleanWorktree: boolean } {
  const rev = runSync("git", ["rev-parse", "--is-inside-work-tree"], cwd, 3000);
  if (rev.status !== 0 || !/true/.test(rev.stdout)) return { gitDetected: false, cleanWorktree: false };
  const status = runSync("git", ["status", "--porcelain"], cwd, 3000);
  return { gitDetected: true, cleanWorktree: status.stdout.trim().length === 0 };
}

export function doctor(projectRoot: string, opts: { includeHelp?: boolean; includeAuthStatus?: boolean } = {}): DoctorResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const binary = resolveBinary();
  const project = { root: projectRoot, ...gitProject(projectRoot) };
  if (!binary.command) {
    errors.push(binary.error || "Antigravity CLI binary not found.");
    return {
      ok: false,
      binary: { resolvedPath: null, version: null, helpHash: null },
      auth: { status: "unknown" },
      project,
      capabilities: {
        nonInteractivePrompt: false,
        stdinPrompt: false,
        promptFlag: false,
        promptFlagName: null,
        promptFile: false,
        jsonOutput: false,
        backgroundJobs: false,
        worktreeSafe: false,
        authStatus: false,
        commandTemplate: false,
        degradedTuiOnly: false,
        hasRunSubcommand: false
      },
      warnings,
      errors
    };
  }

  const main = runSync(binary.command, ["--help"], projectRoot, 5000);
  const run = runSync(binary.command, ["run", "--help"], projectRoot, 5000);
  const auth = runSync(binary.command, ["auth", "--help"], projectRoot, 5000);
  const plugin = runSync(binary.command, ["plugin", "--help"], projectRoot, 5000);
  const mainHelp = `${main.stdout}\n${main.stderr}`;
  const runHelp = `${run.stdout}\n${run.stderr}`;
  const authHelp = `${auth.stdout}\n${auth.stderr}`;
  const pluginHelp = `${plugin.stdout}\n${plugin.stderr}`;
  const capabilities = detectCapabilitiesFromHelp(mainHelp, runHelp, authHelp);
  const helpHash = crypto.createHash("sha256").update(`${mainHelp}\n${runHelp}\n${authHelp}\n${pluginHelp}`).digest("hex").slice(0, 16);

  if (!capabilities.nonInteractivePrompt) {
    warnings.push("Could not prove non-interactive Antigravity CLI invocation from --help output. Configure cli_template after checking `agy --help`.");
  }
  if (!project.gitDetected) warnings.push("Current project is not a git work tree; review target selection will be limited.");
  const authStatus = opts.includeAuthStatus === false ? { status: "unknown" as const } : inspectAuth(binary.command, projectRoot);
  if (authStatus.status === "not_authenticated") warnings.push("Antigravity CLI is installed but not authenticated. Run `agy` or the documented login flow from a terminal.");

  return {
    ok: Boolean(binary.command && capabilities.nonInteractivePrompt && errors.length === 0),
    binary: { resolvedPath: binary.command, version: binary.version, helpHash },
    auth: authStatus,
    project,
    capabilities,
    warnings,
    errors,
    help: opts.includeHelp ? { main: truncate(mainHelp, 20_000), run: truncate(runHelp, 20_000), auth: truncate(authHelp, 20_000), plugin: truncate(pluginHelp, 20_000) } : undefined
  };
}
