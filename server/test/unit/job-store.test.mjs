import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JobStore } from '../../dist/core/job-store.js';

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
