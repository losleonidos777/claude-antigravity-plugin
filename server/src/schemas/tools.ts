export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const modeEnum = ["readonly", "suggest", "worktree"];
const targetEnum = ["working-tree", "staged", "branch", "commit-range", "file"];

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "antigravity_doctor",
    description: "Check whether the local Antigravity CLI is installed, callable non-interactively, authenticated enough to run, and safe to use from this Claude Code project.",
    inputSchema: {
      type: "object",
      properties: {
        includeHelp: { type: "boolean", default: false },
        includeAuthStatus: { type: "boolean", default: true }
      },
      additionalProperties: false
    }
  },
  {
    name: "antigravity_setup",
    description: "Run setup diagnostics and return installation, authentication, and non-interactive CLI configuration instructions.",
    inputSchema: {
      type: "object",
      properties: {
        includeHelp: { type: "boolean", default: false }
      },
      additionalProperties: false
    }
  },
  {
    name: "antigravity_review",
    description: "Ask Antigravity CLI for a read-only review of the current diff, staged changes, branch diff, commit range, or file. Never applies code changes.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", enum: targetEnum, default: "working-tree" },
        ref: { type: "string" },
        focus: { type: "string" },
        severityThreshold: { type: "string", enum: ["info", "low", "medium", "high", "critical"], default: "info" },
        mode: { type: "string", enum: ["readonly"], default: "readonly" },
        background: { type: "boolean", default: false },
        maxRuntimeMs: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "antigravity_adversarial_review",
    description: "Ask Antigravity CLI for a skeptical, adversarial, read-only review that pressure-tests correctness, security, race conditions, design assumptions, and rollback risks.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", enum: targetEnum, default: "working-tree" },
        ref: { type: "string" },
        focus: { type: "string" },
        severityThreshold: { type: "string", enum: ["info", "low", "medium", "high", "critical"], default: "medium" },
        background: { type: "boolean", default: false },
        maxRuntimeMs: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "antigravity_delegate",
    description: "Delegate an investigation or implementation task to Antigravity CLI as a managed background job. Uses readonly, suggest, or isolated worktree mode; never direct-edits by default.",
    inputSchema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string" },
        mode: { type: "string", enum: modeEnum, default: "readonly" },
        fresh: { type: "boolean", default: false },
        maxRuntimeMs: { type: "number" },
        allowedPaths: { type: "array", items: { type: "string" } },
        deniedPaths: { type: "array", items: { type: "string" } }
      },
      additionalProperties: false
    }
  },
  {
    name: "antigravity_execute_tasks",
    description: "Ask Antigravity CLI to execute a markdown task list under Claude supervision as a managed background job.",
    inputSchema: {
      type: "object",
      properties: {
        taskListPath: { type: "string" },
        taskListText: { type: "string" },
        mode: { type: "string", enum: ["suggest", "worktree"], default: "suggest" },
        strategy: { type: "string", enum: ["sequential", "batch-readonly-plan-then-execute"], default: "sequential" },
        stopOnFailure: { type: "boolean", default: true },
        maxRuntimeMs: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "antigravity_verify_plan",
    description: "Ask Antigravity CLI to verify a plan or previous output read-only for feasibility, sequencing, migration risks, test coverage, rollback path, and missing dependencies.",
    inputSchema: {
      type: "object",
      properties: {
        planPath: { type: "string" },
        planText: { type: "string" },
        focus: { type: "string" },
        background: { type: "boolean", default: false },
        maxRuntimeMs: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "antigravity_status",
    description: "List running and recent Antigravity jobs for the current repository, reconciling stale running states with OS process liveness.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        allProjects: { type: "boolean", default: false }
      },
      additionalProperties: false
    }
  },
  {
    name: "antigravity_result",
    description: "Return the stored result, log path, changed files, patch path, and resumability hints for a finished Antigravity job.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        includeRaw: { type: "boolean", default: false }
      },
      additionalProperties: false
    }
  },
  {
    name: "antigravity_cancel",
    description: "Cancel a running Antigravity background job by terminating its process tree and updating persistent state.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        signal: { type: "string", enum: ["SIGTERM", "SIGKILL"], default: "SIGTERM" }
      },
      additionalProperties: false
    }
  }
];
