import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { processIsAlive, killProcessTreeConfirmed } from '../../dist/core/process-runner.js';
import { JobStore } from '../../dist/core/job-store.js';
import { antigravityCancel } from '../../dist/tools/cancel.js';

function spawnSpinner(ignoreSigterm = true) {
  const code = ignoreSigterm
    ? "process.on('SIGTERM',()=>{});setInterval(()=>{},1e9)"
    : 'setInterval(()=>{},1e9)';
  const child = spawn(process.execPath, ['-e', code], { stdio: 'ignore' });
  child.unref();
  return child;
}

async function waitGone(pid, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!processIsAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !processIsAlive(pid);
}

test('processIsAlive tracks real process liveness', async () => {
  const child = spawnSpinner(false);
  try {
    assert.equal(processIsAlive(child.pid), true);
    assert.equal(processIsAlive(0), false);
    assert.equal(processIsAlive(-1), false);
  } finally {
    try { process.kill(child.pid, 'SIGKILL'); } catch {}
  }
  await waitGone(child.pid);
  assert.equal(processIsAlive(child.pid), false);
});

test('killProcessTreeConfirmed escalates to SIGKILL when the process ignores SIGTERM', async () => {
  const child = spawnSpinner(true);
  try {
    const outcome = await killProcessTreeConfirmed(child.pid, 'SIGTERM', 250);
    assert.equal(outcome.killed, true, 'process must actually be dead');
    assert.equal(outcome.escalated, true, 'SIGTERM was ignored, so it must have escalated to SIGKILL');
    assert.equal(processIsAlive(child.pid), false);
  } finally {
    try { process.kill(child.pid, 'SIGKILL'); } catch {}
  }
});

test('killProcessTreeConfirmed reports gone for an already-dead pid and refuses invalid pids', async () => {
  const child = spawnSpinner(false);
  process.kill(child.pid, 'SIGKILL');
  await waitGone(child.pid);
  const outcome = await killProcessTreeConfirmed(child.pid, 'SIGKILL', 100);
  assert.equal(outcome.killed, true);
  assert.deepEqual(await killProcessTreeConfirmed(0, 'SIGTERM', 50), { killed: false, escalated: false });
});

function setupJobStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cancel-project-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cancel-data-'));
  process.env.CLAUDE_PROJECT_DIR = root;
  process.env.ANTIGRAVITY_STATE_DIR = data;
  const prompt = path.join(data, 'prompt.md');
  fs.writeFileSync(prompt, 'hello');
  const store = new JobStore(root);
  return { store, prompt };
}

test('antigravityCancel reports cancelled:true only after the process is confirmed gone', async () => {
  const child = spawnSpinner(true);
  const { store, prompt } = setupJobStore();
  const job = store.create({ kind: 'delegate', mode: 'readonly', promptPath: prompt, command: ['agy', 'run'] });
  store.update(job.jobId, { status: 'running', pid: child.pid });
  try {
    const res = await antigravityCancel({ jobId: job.jobId, signal: 'SIGKILL' });
    assert.equal(res.cancelled, true);
    assert.equal(res.previousStatus, 'running');
    assert.equal(processIsAlive(child.pid), false, 'process must be gone before reporting success');
    const reread = store.read(job.jobId);
    assert.equal(reread.status, 'cancelled');
    assert.ok(reread.finishedAt);
  } finally {
    try { process.kill(child.pid, 'SIGKILL'); } catch {}
  }
});

test('antigravityCancel is a no-op on an already-terminal job (does not flip completed -> cancelled)', async () => {
  const { store, prompt } = setupJobStore();
  const job = store.create({ kind: 'review', mode: 'readonly', promptPath: prompt, command: ['agy', 'run'] });
  // Stale PID from a finished job; must NOT be killed nor the status flipped.
  store.update(job.jobId, { status: 'completed', pid: 999999999, finishedAt: new Date().toISOString() });
  const res = await antigravityCancel({ jobId: job.jobId });
  assert.equal(res.cancelled, false);
  assert.match(res.message, /already in terminal state 'completed'/);
  assert.equal(store.read(job.jobId).status, 'completed');
});

test('antigravityCancel on a queued job (no pid) reports cancelled:false and records cancel_no_pid', async () => {
  const { store, prompt } = setupJobStore();
  // A queued job has no pid yet and is not terminal, so it reaches the no-pid branch.
  // (A *running* job with no live pid would instead be reconciled to "unknown" on read.)
  const job = store.create({ kind: 'delegate', mode: 'readonly', promptPath: prompt, command: ['agy', 'run'] });
  assert.equal(job.status, 'queued');
  const res = await antigravityCancel({ jobId: job.jobId });
  assert.equal(res.cancelled, false);
  const reread = store.read(job.jobId);
  assert.equal(reread.status, 'cancelled');
  assert.equal(reread.error?.code, 'cancel_no_pid');
});

test('antigravityCancel reconciles a running-but-dead-pid job to unknown (no false cancel)', async () => {
  const { store, prompt } = setupJobStore();
  const job = store.create({ kind: 'delegate', mode: 'readonly', promptPath: prompt, command: ['agy', 'run'] });
  store.update(job.jobId, { status: 'running', pid: 999999999 }); // dead pid
  const res = await antigravityCancel({ jobId: job.jobId });
  assert.equal(res.cancelled, false);
  assert.match(res.message, /terminal state 'unknown'/);
  assert.equal(store.read(job.jobId).status, 'unknown');
});
