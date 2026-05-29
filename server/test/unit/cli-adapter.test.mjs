import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectCapabilitiesFromHelp,
  buildInvocation,
  argBudget,
  estimateWindowsCmdLine,
  shouldUsePty
} from '../../dist/core/cli-adapter.js';
import { redactInvocationArgs } from '../../dist/core/process-runner.js';

test('detects prompt-file non-interactive support', () => {
  const caps = detectCapabilitiesFromHelp('Usage: agy run', 'Usage: agy run --prompt-file <file> --json', 'auth status');
  assert.equal(caps.nonInteractivePrompt, true);
  assert.equal(caps.promptFile, true);
  assert.equal(caps.jsonOutput, true);
});

test('marks TUI-only run surface as degraded', () => {
  const caps = detectCapabilitiesFromHelp('Commands: run auth plugin', 'Usage: agy run', 'auth login logout');
  assert.equal(caps.nonInteractivePrompt, false);
  assert.equal(caps.degradedTuiOnly, true);
  assert.equal(caps.hasRunSubcommand, true, 'Commands: list with run is a run subcommand');
});

test('agy 1.0.3 shape: no run subcommand, --prompt as global flag', () => {
  const mainHelp = [
    'Usage of agy.exe:',
    '  --prompt    Alias for --print',
    '  --print     Run a single prompt non-interactively and print the response',
    '  -p          Short alias for --print',
    'Available subcommands:',
    '  changelog   Show changelog',
    '  plugin      Manage plugins',
    '  update      Update CLI'
  ].join('\n');
  const caps = detectCapabilitiesFromHelp(mainHelp, mainHelp, '');
  assert.equal(caps.promptFlag, true);
  assert.equal(caps.promptFlagName, '--prompt');
  assert.equal(caps.hasRunSubcommand, false);
  assert.equal(caps.nonInteractivePrompt, true);

  const inv = buildInvocation({
    binary: 'agy',
    capabilities: caps,
    promptPath: '/tmp/prompt.txt',
    promptText: 'hello',
    mode: 'readonly'
  });
  assert.equal(inv.args[0], '--prompt', 'must not prepend run subcommand when CLI does not expose one');
  assert.equal(inv.strategy, 'prompt-flag');
});

test('emits --print when only --print is documented (no --prompt alias)', () => {
  const help = '  --print  Run a single prompt non-interactively\n';
  const caps = detectCapabilitiesFromHelp(help, help, '');
  assert.equal(caps.promptFlagName, '--print');
  const inv = buildInvocation({ binary: 'agy', capabilities: caps, promptPath: '/tmp/p', promptText: 'hi', mode: 'readonly' });
  assert.equal(inv.args[0], '--print');
});

test('emits --message when only --message is documented', () => {
  const help = '  --message <text>  Send a single message non-interactively\n';
  const caps = detectCapabilitiesFromHelp(help, help, '');
  assert.equal(caps.promptFlagName, '--message');
  const inv = buildInvocation({ binary: 'agy', capabilities: caps, promptPath: '/tmp/p', promptText: 'hi', mode: 'readonly' });
  assert.equal(inv.args[0], '--message');
});

test('hasRunSubcommand: detects Usage: agy run shape', () => {
  const caps = detectCapabilitiesFromHelp('Usage: agy run [flags]', '', '');
  assert.equal(caps.hasRunSubcommand, true);
});

test('rejects oversized argv prompt with actionable error', () => {
  const caps = detectCapabilitiesFromHelp(
    '  --prompt    Alias for --print\n',
    '  --prompt    Alias for --print\n',
    ''
  );
  // Use budget+1 to ensure rejection on both win32 (28000) and POSIX (120000).
  const huge = 'x'.repeat(argBudget() + 1);
  assert.throws(
    () => buildInvocation({ binary: 'agy', capabilities: caps, promptPath: '/tmp/p', promptText: huge, mode: 'readonly' }),
    /Narrow the review target/
  );
});

test('estimateWindowsCmdLine inflates with quotes/backslashes', () => {
  if (process.platform !== 'win32') return; // estimator is win32-specific
  const plain = estimateWindowsCmdLine('agy', ['--prompt', 'hello world']);
  const quoted = estimateWindowsCmdLine('agy', ['--prompt', 'he"llo "wor"ld']);
  assert.ok(quoted > plain, 'quoted args should produce larger cmdline estimate');
});

test('redactInvocationArgs replaces prompt value', () => {
  const out = redactInvocationArgs(['--prompt', 'secret token abc123']);
  assert.equal(out[0], '--prompt');
  assert.match(out[1], /<prompt-omitted/);
});

test('redactInvocationArgs leaves non-prompt args untouched', () => {
  const out = redactInvocationArgs(['--add-dir', '/path/to/repo', '--sandbox']);
  assert.deepEqual(out, ['--add-dir', '/path/to/repo', '--sandbox']);
});

test('shouldUsePty: enabled on win32 for agy/antigravity by binary basename', () => {
  if (process.platform !== 'win32') {
    assert.equal(shouldUsePty('C:/Users/x/AppData/Local/agy/bin/agy.EXE'), false);
    return;
  }
  assert.equal(shouldUsePty('C:/Users/x/AppData/Local/agy/bin/agy.EXE'), true);
  assert.equal(shouldUsePty('C:\\Program Files\\Google\\Antigravity\\bin\\antigravity.exe'), true);
  assert.equal(shouldUsePty('agy'), true);
  assert.equal(shouldUsePty('node.exe'), false, 'must not enable PTY for unrelated binaries');
});

test('shouldUsePty: ANTIGRAVITY_FORCE_PIPE=1 overrides win32 default', () => {
  const prev = process.env.ANTIGRAVITY_FORCE_PIPE;
  process.env.ANTIGRAVITY_FORCE_PIPE = '1';
  try {
    assert.equal(shouldUsePty('agy.exe'), false);
  } finally {
    if (prev === undefined) delete process.env.ANTIGRAVITY_FORCE_PIPE;
    else process.env.ANTIGRAVITY_FORCE_PIPE = prev;
  }
});

test('buildInvocation tags Invocation.requiresPty based on shouldUsePty', () => {
  const caps = detectCapabilitiesFromHelp('  --prompt    Alias for --print\n', '', '');
  const inv = buildInvocation({ binary: 'agy', capabilities: caps, promptPath: '/tmp/p', promptText: 'hi', mode: 'readonly' });
  assert.equal(inv.requiresPty, shouldUsePty('agy'));
});

test('buildInvocation forces requiresPty=false for stdin strategy (PTY cannot signal EOF)', () => {
  // Stdin-only CLI: --stdin detected, no --prompt-file, no --prompt.
  const help = '  --stdin    Read prompt from stdin\n';
  const caps = detectCapabilitiesFromHelp(help, help, '');
  assert.equal(caps.stdinPrompt, true);
  assert.equal(caps.promptFlag, false);
  const inv = buildInvocation({ binary: 'agy', capabilities: caps, promptPath: '/tmp/p', promptText: 'hi', mode: 'readonly' });
  assert.equal(inv.strategy.includes('stdin'), true);
  assert.equal(inv.requiresPty, false, 'stdin strategy must never use PTY');
});
