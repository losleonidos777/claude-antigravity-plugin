import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as childProcess from 'node:child_process';

import { gitChangedFiles } from '../../dist/core/output-parser.js';

function makeRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-parser-test-'));
  childProcess.spawnSync('git', ['init', '-q'], { cwd: tmp });
  childProcess.spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init', '-q'], { cwd: tmp });
  return tmp;
}

test('gitChangedFiles preserves first character of modified paths', () => {
  const repo = makeRepo();
  try {
    const sub = path.join(repo, 'apps', 'm');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'rules.ts'), 'x');
    childProcess.spawnSync('git', ['add', '-A'], { cwd: repo });
    childProcess.spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'add', '-q'], { cwd: repo });
    fs.writeFileSync(path.join(sub, 'rules.ts'), 'y'); // now modified, unstaged → " M apps/m/rules.ts"
    fs.writeFileSync(path.join(repo, 'untracked.md'), 'z'); // "?? untracked.md"

    const files = gitChangedFiles(repo);
    assert.ok(
      files.some((f) => f === 'apps/m/rules.ts' || f === 'apps\\m\\rules.ts'),
      `expected full path 'apps/m/rules.ts' in ${JSON.stringify(files)}`
    );
    assert.ok(files.includes('untracked.md'), `expected 'untracked.md' in ${JSON.stringify(files)}`);
    assert.ok(!files.some((f) => /^pps\//.test(f)), 'paths must not have first char stripped');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('gitChangedFiles handles rename (R) entries', () => {
  const repo = makeRepo();
  try {
    fs.writeFileSync(path.join(repo, 'old.md'), 'x');
    childProcess.spawnSync('git', ['add', '-A'], { cwd: repo });
    childProcess.spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'add', '-q'], { cwd: repo });
    childProcess.spawnSync('git', ['mv', 'old.md', 'new.md'], { cwd: repo });

    const files = gitChangedFiles(repo);
    assert.ok(files.includes('new.md'), `expected new.md after rename in ${JSON.stringify(files)}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
