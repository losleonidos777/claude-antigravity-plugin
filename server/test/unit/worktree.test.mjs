import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { prepareWorktree } from '../../dist/core/worktree.js';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function readLF(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function setupRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-wt-repo-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  // Committed baseline files.
  fs.writeFileSync(path.join(root, 'app.js'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=committed\n');
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.txt\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'init']);
  return root;
}

test('prepareWorktree replays allowed tracked edits but skips denied tracked edits', async () => {
  const root = setupRepo();
  const worktreesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-wt-out-'));
  let result;
  try {
    // Dirty tracked edit on an allowed file (unstaged).
    fs.writeFileSync(path.join(root, 'app.js'), 'export const x = 42;\n');
    // Dirty tracked edit on a DENIED file (.env) — must NOT be replayed.
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=leaked-dirty-value\n');
    // Untracked non-ignored file — should be copied.
    fs.writeFileSync(path.join(root, 'new.txt'), 'fresh\n');
    // Ignored file — must be absent.
    fs.writeFileSync(path.join(root, 'ignored.txt'), 'noise\n');

    result = prepareWorktree(root, worktreesDir, 'wt-test');
    const wt = result.worktreePath;

    // Allowed tracked edit replayed.
    assert.equal(readLF(path.join(wt, 'app.js')), 'export const x = 42;\n');
    // Denied tracked edit NOT replayed — worktree keeps the committed value.
    assert.equal(readLF(path.join(wt, '.env')), 'SECRET=committed\n');
    // Untracked non-ignored file copied.
    assert.equal(readLF(path.join(wt, 'new.txt')), 'fresh\n');
    // Ignored file absent.
    assert.equal(fs.existsSync(path.join(wt, 'ignored.txt')), false);
    // Warning surfaces both the replay and the denied skip + the untracked copy count.
    assert.match(result.warning, /Replayed 1 tracked modification/);
    assert.match(result.warning, /Skipped 1 under denied paths/);
    assert.match(result.warning, /Copied 1 untracked file/);
  } finally {
    if (result) {
      try {
        git(root, ['worktree', 'remove', '--force', result.worktreePath]);
      } catch {}
      try {
        git(root, ['branch', '-D', result.branchName]);
      } catch {}
    }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(worktreesDir, { recursive: true, force: true });
  }
});

test('prepareWorktree skips replay entirely when every dirty tracked file is denied', async () => {
  const root = setupRepo();
  const worktreesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-wt-out-'));
  let result;
  try {
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=leaked\n');
    result = prepareWorktree(root, worktreesDir, 'wt-denied-only');
    assert.equal(readLF(path.join(result.worktreePath, '.env')), 'SECRET=committed\n');
    assert.match(result.warning ?? '', /Skipped 1 tracked modification\(s\) under denied paths/);
  } finally {
    if (result) {
      try {
        git(root, ['worktree', 'remove', '--force', result.worktreePath]);
      } catch {}
      try {
        git(root, ['branch', '-D', result.branchName]);
      } catch {}
    }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(worktreesDir, { recursive: true, force: true });
  }
});
