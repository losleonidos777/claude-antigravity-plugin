export type JobKind =
  | "review"
  | "adversarial-review"
  | "delegate"
  | "execute-tasks"
  | "verify-plan";

export type JobStatus =
  | "queued"
  | "running"
  | "skipped"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled"
  | "unknown";

export type JobMode = "readonly" | "suggest" | "worktree";

export interface JobState {
  schemaVersion: 1;
  jobId: string;
  projectRoot: string;
  executionRoot: string;
  projectHash: string;
  kind: JobKind;
  status: JobStatus;
  mode: JobMode;
  promptPath: string;
  logPath: string;
  resultPath?: string;
  patchPath?: string;
  statePath: string;
  artifactDir: string;
  worktreePath?: string;
  branchName?: string;
  pid?: number;
  command: string[];
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  summary?: string;
  warning?: string;
  changedFiles?: string[];
  parsedTasks?: Array<{
    id: string;
    title: string;
    status: "pending" | "running" | "done" | "failed" | "blocked" | "needs-human";
    dependencies: string[];
  }>;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
