import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { JobStore } from '../../dist/core/job-store.js';
import { antigravityResult } from '../../dist/tools/result.js';

test('antigravityResult preserves stored changedFiles when execution root is gone', async () => {
  const oldProject = process.env.CLAUDE_PROJECT_DIR;
  const oldState = process.env.ANTIGRAVITY_STATE_DIR;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-result-project-'));
  const execRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-result-exec-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-result-data-'));
  try {
    process.env.CLAUDE_PROJECT_DIR = root;
    process.env.ANTIGRAVITY_STATE_DIR = data;
    const prompt = path.join(data, 'prompt.md');
    fs.writeFileSync(prompt, 'hello');
    const store = new JobStore(root);
    const job = store.create({
      kind: 'delegate',
      mode: 'worktree',
      promptPath: prompt,
      executionRoot: execRoot,
      baselineStatus: ['before.md']
    });
    fs.writeFileSync(job.resultPath, '## Summary\nStored worktree result.');
    store.update(job.jobId, {
      status: 'completed',
      summary: 'Stored summary',
      changedFiles: ['created-by-job.md'],
      patchPath: path.join(job.artifactDir, 'changes.patch')
    });
    fs.rmSync(execRoot, { recursive: true, force: true });

    const result = await antigravityResult({ jobId: job.jobId });
    assert.deepEqual(result.changedFiles, ['created-by-job.md']);
    assert.equal(result.summary, 'Stored summary');
  } finally {
    if (oldProject === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = oldProject;
    if (oldState === undefined) delete process.env.ANTIGRAVITY_STATE_DIR;
    else process.env.ANTIGRAVITY_STATE_DIR = oldState;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(execRoot, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('antigravityResult forces readonly changedFiles to empty and overwrites narration summary', async () => {
  const childProcess = await import('node:child_process');
  const oldProject = process.env.CLAUDE_PROJECT_DIR;
  const oldState = process.env.ANTIGRAVITY_STATE_DIR;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-result-project-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-result-data-'));
  try {
    childProcess.spawnSync('git', ['init', '-q'], { cwd: root });
    childProcess.spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init', '-q'], { cwd: root });
    process.env.CLAUDE_PROJECT_DIR = root;
    process.env.ANTIGRAVITY_STATE_DIR = data;
    const prompt = path.join(data, 'prompt.md');
    fs.writeFileSync(prompt, 'hello');
    const store = new JobStore(root);
    const job = store.create({
      kind: 'delegate',
      mode: 'readonly',
      promptPath: prompt,
      baselineStatus: ['preexisting.md']
    });
    fs.writeFileSync(path.join(root, 'created.md'), 'should not be reported for readonly');
    fs.writeFileSync(job.resultPath, 'I will inspect the files.\n\n## Summary\nReadonly inspection completed.');
    store.update(job.jobId, {
      status: 'completed',
      summary: 'I will inspect the files.',
      changedFiles: ['stale.md']
    });

    const result = await antigravityResult({ jobId: job.jobId });
    assert.deepEqual(result.changedFiles, []);
    assert.equal(result.summary, 'Readonly inspection completed.');
  } finally {
    if (oldProject === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = oldProject;
    if (oldState === undefined) delete process.env.ANTIGRAVITY_STATE_DIR;
    else process.env.ANTIGRAVITY_STATE_DIR = oldState;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});
