import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { prepareWorktree } from '../../dist/core/worktree.js';
import { gitChangedFiles, changedSince } from '../../dist/core/output-parser.js';

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

test('prepareWorktree replays allowed paths literally so a glob-named file cannot re-include a denied file', async () => {
  const root = setupRepo();
  const worktreesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-wt-out-'));
  let result;
  // A file literally named "[.]env" is allowed (pathIsDenied checks for ".env"),
  // but as a raw git pathspec "[.]env" is a glob that matches ".env". Brackets are
  // legal on Windows and POSIX, so this reproduces the metacharacter leak cross-platform.
  const globName = '[.]env';
  try {
    fs.writeFileSync(path.join(root, globName), 'PLACEHOLDER=committed\n');
    git(root, ['add', '-A']); // add by worktree scan; avoids the same pathspec-glob trap
    git(root, ['commit', '-q', '-m', 'add glob-named file']);

    // Dirty both: the allowed glob-named file and the denied .env.
    fs.writeFileSync(path.join(root, globName), 'PLACEHOLDER=dirty\n');
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=leaked-via-glob\n');

    result = prepareWorktree(root, worktreesDir, 'wt-glob');
    const wt = result.worktreePath;

    // Allowed glob-named file IS replayed (matched literally).
    assert.equal(readLF(path.join(wt, globName)), 'PLACEHOLDER=dirty\n');
    // Denied .env is NOT replayed even though "[.]env" would glob-match it.
    assert.equal(readLF(path.join(wt, '.env')), 'SECRET=committed\n');
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

test('Edge C: changedFiles attributes in-place edits to replayed-untracked files', () => {
  const root = setupRepo();
  const worktreesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-wt-out-'));
  let result;
  try {
    // Host has an untracked doc (mirrors the staged-but-uncommitted cold-test fixture).
    fs.writeFileSync(path.join(root, 'API_GUIDE.md'), 'original guide\n');

    result = prepareWorktree(root, worktreesDir, 'wt-edgec');
    const wt = result.worktreePath;
    assert.ok(fs.existsSync(path.join(wt, 'API_GUIDE.md')), 'untracked file should be replayed into the worktree');

    // The baseline-commit means the replayed state is HEAD, so baseline is clean.
    const baseline = gitChangedFiles(wt);

    // The "agent" edits the replayed-untracked file AND creates a new file.
    fs.writeFileSync(path.join(wt, 'API_GUIDE.md'), 'original guide\n\nedited by the agent\n');
    fs.writeFileSync(path.join(wt, 'CLEANUP_NOTES.md'), 'new notes\n');

    const changed = changedSince(wt, baseline);
    assert.ok(changed.includes('API_GUIDE.md'), `in-place edit must be attributed: ${JSON.stringify(changed)}`);
    assert.ok(changed.includes('CLEANUP_NOTES.md'), `new file must be attributed: ${JSON.stringify(changed)}`);
  } finally {
    if (result) {
      try { git(root, ['worktree', 'remove', '--force', result.worktreePath]); } catch {}
      try { git(root, ['branch', '-D', result.branchName]); } catch {}
    }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(worktreesDir, { recursive: true, force: true });
  }
});
