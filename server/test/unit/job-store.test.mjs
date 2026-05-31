import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { JobStore } from '../../dist/core/job-store.js';

function spawnLiveChild() {
  // A throwaway process the reaper is allowed to kill; ignores SIGTERM so only SIGKILL ends it.
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1e9)"], {
    stdio: 'ignore'
  });
  child.unref();
  return child;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === 'EPERM';
  }
}

async function waitGone(pid, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !isAlive(pid);
}

function setupJob(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-reaper-project-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-reaper-data-'));
  process.env.ANTIGRAVITY_STATE_DIR = data;
  const prompt = path.join(data, 'prompt.md');
  fs.writeFileSync(prompt, 'hello');
  const store = new JobStore(root);
  const job = store.create({ kind: 'verify-plan', mode: 'readonly', promptPath: prompt, command: ['agy', 'run'] });
  store.update(job.jobId, { status: 'running', ...extra });
  return { store, jobId: job.jobId, root, data };
}

test('creates and updates job state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-project-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-data-'));
  process.env.ANTIGRAVITY_STATE_DIR = data;
  const prompt = path.join(data, 'prompt.md');
  fs.writeFileSync(prompt, 'hello');
  const store = new JobStore(root);
  const job = store.create({ kind: 'delegate', mode: 'readonly', promptPath: prompt, command: ['agy', 'run'] });
  assert.equal(job.status, 'queued');
  const updated = store.update(job.jobId, { status: 'running', pid: 99999999 });
  assert.equal(updated.status, 'running');
  const reconciled = store.read(job.jobId);
  assert.equal(reconciled.status, 'unknown');
});

test('reconcile reaps an alive job past its deadline and marks it timeout', async () => {
  const child = spawnLiveChild();
  try {
    assert.ok(isAlive(child.pid), 'child should be alive at start');
    const { store, jobId } = setupJob({
      pid: child.pid,
      startedAt: new Date(Date.now() - 3_600_000).toISOString(),
      deadlineAt: new Date(Date.now() - 1_800_000).toISOString() // 30 min past deadline
    });
    const reconciled = store.read(jobId);
    assert.equal(reconciled.status, 'timeout');
    assert.equal(reconciled.error?.code, 'deadline_exceeded');
    assert.ok(reconciled.finishedAt, 'finishedAt should be set');
    assert.ok(await waitGone(child.pid), 'reaper must actually kill the orphaned process');
  } finally {
    try { process.kill(child.pid, 'SIGKILL'); } catch {}
  }
});

test('reconcile leaves an alive job that is within its deadline untouched', async () => {
  const child = spawnLiveChild();
  try {
    const { store, jobId } = setupJob({
      pid: child.pid,
      startedAt: new Date().toISOString(),
      deadlineAt: new Date(Date.now() + 600_000).toISOString() // 10 min in the future
    });
    const reconciled = store.read(jobId);
    assert.equal(reconciled.status, 'running');
    assert.ok(isAlive(child.pid), 'process within deadline must not be killed');
  } finally {
    try { process.kill(child.pid, 'SIGKILL'); } catch {}
  }
});

test('reconcile honours the clock-skew margin (just-past-deadline is not reaped)', async () => {
  const child = spawnLiveChild();
  try {
    const { store, jobId } = setupJob({
      pid: child.pid,
      startedAt: new Date(Date.now() - 1000).toISOString(),
      deadlineAt: new Date(Date.now() - 1000).toISOString() // 1s past, inside the 5s skew margin
    });
    const reconciled = store.read(jobId);
    assert.equal(reconciled.status, 'running');
    assert.ok(isAlive(child.pid), 'process within the skew margin must not be killed');
  } finally {
    try { process.kill(child.pid, 'SIGKILL'); } catch {}
  }
});

test('peek returns the raw persisted status without reconciling (no side effects)', () => {
  const { store, jobId } = setupJob({ pid: 999999999, startedAt: new Date().toISOString() }); // dead pid, running
  const peeked = store.peek(jobId);
  assert.equal(peeked.status, 'running', 'peek must not reconcile a dead-pid running job to unknown');
  // read() (which reconciles) would have flipped it; confirm peek left the file untouched.
  assert.equal(store.peek(jobId).status, 'running');
  assert.equal(store.peek('does-not-exist'), null);
});

test('reconcile does not reap a running job that has no deadlineAt', async () => {
  const child = spawnLiveChild();
  try {
    const { store, jobId } = setupJob({ pid: child.pid, startedAt: new Date(Date.now() - 3_600_000).toISOString() });
    const reconciled = store.read(jobId);
    assert.equal(reconciled.status, 'running');
    assert.ok(isAlive(child.pid), 'a job without a deadline must never be reaped');
  } finally {
    try { process.kill(child.pid, 'SIGKILL'); } catch {}
  }
});
