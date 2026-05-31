import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as childProcess from 'node:child_process';

import { changedSince, extractSummary, gitChangedFiles } from '../../dist/core/output-parser.js';

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

test('changedSince excludes baseline entries and includes new files', () => {
  const repo = makeRepo();
  try {
    fs.writeFileSync(path.join(repo, 'preexisting.md'), 'before');
    const baseline = gitChangedFiles(repo);
    fs.writeFileSync(path.join(repo, 'created.md'), 'after');

    const files = changedSince(repo, baseline);
    assert.deepEqual(files, ['created.md']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('changedSince detects files created inside an already-untracked directory', () => {
  const repo = makeRepo();
  try {
    fs.mkdirSync(path.join(repo, 'untracked-dir'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'untracked-dir', 'existing.txt'), 'before');
    const baseline = gitChangedFiles(repo);
    assert.ok(baseline.includes('untracked-dir/existing.txt'), `expected per-file baseline in ${JSON.stringify(baseline)}`);
    assert.ok(!baseline.includes('untracked-dir/'), `baseline must not collapse the directory: ${JSON.stringify(baseline)}`);

    fs.writeFileSync(path.join(repo, 'untracked-dir', 'created.txt'), 'after');
    assert.deepEqual(changedSince(repo, baseline), ['untracked-dir/created.txt']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('changedSince reports renamed target path', () => {
  const repo = makeRepo();
  try {
    fs.writeFileSync(path.join(repo, 'old.md'), 'x');
    childProcess.spawnSync('git', ['add', '-A'], { cwd: repo });
    childProcess.spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'add', '-q'], { cwd: repo });
    const baseline = gitChangedFiles(repo);
    childProcess.spawnSync('git', ['mv', 'old.md', 'new.md'], { cwd: repo });

    assert.deepEqual(changedSince(repo, baseline), ['new.md']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('gitChangedFiles preserves spaces in porcelain v2 paths', () => {
  const repo = makeRepo();
  try {
    fs.writeFileSync(path.join(repo, 'file with spaces.md'), 'x');
    childProcess.spawnSync('git', ['add', '-A'], { cwd: repo });
    childProcess.spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'add', '-q'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'file with spaces.md'), 'y');

    assert.ok(gitChangedFiles(repo).includes('file with spaces.md'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('extractSummary prefers JSON summary footer', () => {
  const markdown = [
    '# Code Review Report',
    '',
    'Opening text.',
    '',
    '```json',
    '{"summary":"Use the validated JSON footer.","findings":[]}',
    '```'
  ].join('\n');
  assert.equal(extractSummary(markdown), 'Use the validated JSON footer.');
});

test('extractSummary uses the last valid JSON block', () => {
  const markdown = [
    '```json',
    '{"summary":"Example summary","findings":[]}',
    '```',
    '',
    '## Summary',
    'Markdown fallback should lose to the final footer.',
    '',
    '```json',
    '{"summary":"Final footer summary","findings":[]}',
    '```'
  ].join('\n');
  assert.equal(extractSummary(markdown), 'Final footer summary');
});

test('extractSummary reads markdown summary section', () => {
  const markdown = [
    '# Result',
    '',
    '## Summary',
    'The pipeline modules were inspected successfully.',
    '',
    '## Files changed',
    'None'
  ].join('\n');
  assert.equal(extractSummary(markdown), 'The pipeline modules were inspected successfully.');
});

test('extractSummary reads verdict before trailing questions', () => {
  const markdown = [
    '# Plan Verification',
    '',
    '### Verdict',
    'PASS WITH RECOMMENDATIONS: the plan is feasible with minor sequencing changes.',
    '',
    '### Unanswered Questions',
    'Confirm deployment timing.'
  ].join('\n');
  assert.equal(extractSummary(markdown), 'PASS WITH RECOMMENDATIONS: the plan is feasible with minor sequencing changes.');
});

test('extractSummary tolerates headings glued to preceding text', () => {
  const markdown = 'Completed the work done:### Summary\nThe bigmotion_pipeline directory contains 12 Python scripts.\n\n### Files changed\nNone';
  assert.equal(extractSummary(markdown), 'The bigmotion_pipeline directory contains 12 Python scripts.');
});

test('extractSummary tolerates summary heading glued to following text', () => {
  const markdown = [
    'Verbose intro about files and the ComfyUI server.## SummaryThe bigmotion_pipeline directory contains 12 files.',
    '### Files changed',
    '- None'
  ].join('\n');
  assert.equal(extractSummary(markdown), 'The bigmotion_pipeline directory contains 12 files.');
});

test('extractSummary does not split legitimate multi-word summary headings', () => {
  const markdown = [
    '## Summary of changes',
    'The parser now handles edge-case markdown headings.',
    '',
    'Final answer paragraph.'
  ].join('\n');
  assert.equal(extractSummary(markdown), 'Final answer paragraph.');
});

test('extractSummary skips narration and trailing boilerplate', () => {
  const markdown = [
    'I will inspect the repository before answering.',
    '',
    'The task is feasible after adding validation around baseline state.',
    '',
    'Files changed',
    'None',
    '',
    'Commands run',
    'npm test',
    '',
    'Human review needed',
    'None'
  ].join('\n');
  assert.equal(extractSummary(markdown), 'The task is feasible after adding validation around baseline state.');
});

test('extractSummary does not pick the Areas Reviewed file-list as the summary', () => {
  // Adversarial/review output with no JSON footer and no Summary/Verdict heading: the
  // last meaningful block is the "Areas Reviewed" bullet list, which is NOT the verdict.
  const markdown = [
    '# Adversarial Review',
    '',
    'REJECTED: the migration plan drops referential integrity for orphaned records.',
    '',
    '## Areas Reviewed',
    '- API_GUIDE.md',
    '- migration-plan.md',
    '- task-list.md'
  ].join('\n');
  const summary = extractSummary(markdown);
  assert.ok(!/API_GUIDE\.md/.test(summary), `summary must not be the Areas Reviewed list: ${summary}`);
  assert.equal(summary, 'REJECTED: the migration plan drops referential integrity for orphaned records.');
});

test('extractSummary still prefers the JSON footer verdict for reviews', () => {
  const markdown = [
    '## Areas Reviewed',
    '- a.md',
    '- b.md',
    '',
    '```json',
    '{"summary":"REJECTED: unsafe destructive migration.","findings":[]}',
    '```'
  ].join('\n');
  assert.equal(extractSummary(markdown), 'REJECTED: unsafe destructive migration.');
});

test('extractSummary returns neutral fallback for bridge-only logs', () => {
  const markdown = [
    '[antigravity-bridge] start',
    "I'll inspect the repo.",
    '[antigravity-bridge] done exitCode=0'
  ].join('\n');
  assert.equal(extractSummary(markdown), 'Result output is available in the raw log.');
});
