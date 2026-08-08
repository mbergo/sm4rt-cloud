// The /cli route in server.ts rewrites markers inside cli/install-cli.sh.
// These tests pin the contract between the two files so neither drifts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CLI_DIR = path.resolve(import.meta.dirname, '../../cli');
const installer = readFileSync(path.join(CLI_DIR, 'install-cli.sh'), 'utf8');
const wrapper = readFileSync(path.join(CLI_DIR, 'sm4rt'), 'utf8');

test('installer carries the @ENDPOINT@ placeholder for baked-in config', () => {
  assert.match(installer, /@ENDPOINT@/);
  // guarded so the raw GitHub copy (placeholder intact) never writes it as-is
  assert.match(installer, /http:\/\/\*\|https:\/\/\*/);
});

test('installer RAW_BASE line is rewritable by the /cli route regex', () => {
  const re = /^RAW_BASE=.*$/m;
  assert.match(installer, re);
  const rewritten = installer.replace(re, 'RAW_BASE="${SM4RT_CLI_BASE:-https://cloud.example.com/cli/raw}"');
  assert.match(rewritten, /cloud\.example\.com\/cli\/raw/);
});

test('wrapper execs aws with endpoint and test credentials', () => {
  assert.match(wrapper, /exec aws --endpoint-url "\$EP"/);
  assert.match(wrapper, /AWS_ACCESS_KEY_ID="\$\{SM4RT_ACCESS_KEY_ID:-test\}"/);
  assert.match(wrapper, /AWS_SESSION_TOKEN=""/); // real AWS creds must never leak
  assert.match(wrapper, /SM4RT_ENDPOINT/);
});
