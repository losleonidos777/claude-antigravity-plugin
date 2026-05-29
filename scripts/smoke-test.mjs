import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const serverEntry = resolve(root, 'server/dist/index.js');

const child = spawn(process.execPath, [serverEntry], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

let out = '';
let err = '';
child.stdout.on('data', (d) => { out += String(d); });
child.stderr.on('data', (d) => { err += String(d); });

child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }) + '\n');
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');

await new Promise((r) => setTimeout(r, 800));
child.kill('SIGTERM');
await once(child, 'close');

if (!out.includes('antigravity_doctor') || !out.includes('antigravity_review')) {
  console.error('Smoke test FAILED.');
  console.error('--- STDOUT ---\n' + out);
  if (err) console.error('--- STDERR ---\n' + err);
  process.exit(1);
}
console.log('MCP smoke test passed');
