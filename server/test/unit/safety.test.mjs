import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, pathIsDenied } from '../../dist/core/safety.js';

test('redacts common secrets', () => {
  assert.match(redactSecrets('token=abc123 password=hunter2 Bearer secret.jwt'), /REDACTED/);
});

test('denies sensitive paths', () => {
  assert.equal(pathIsDenied('.env'), true);
  assert.equal(pathIsDenied('src/index.ts'), false);
  assert.equal(pathIsDenied('node_modules/pkg/index.js'), true);
});
