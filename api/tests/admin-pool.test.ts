import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  azureDefaultsFromEnv,
  buildAzureCreateCommand,
  buildCloudInit,
  buildJoinScript,
} from '../src/admin-pool.ts';

const JOIN = 'docker swarm join --token SWMTKN-1-abc 10.0.0.4:2377';

test('azureDefaultsFromEnv falls back to the sm4rt fleet defaults', () => {
  const d = azureDefaultsFromEnv({});
  assert.equal(d.resourceGroup, 'SM4RT-DEMO');
  assert.equal(d.location, 'westus2');
  assert.equal(d.size, 'Standard_B2ms');
  assert.equal(d.image, 'Canonical:ubuntu-24_04-lts:server:latest');
  assert.equal(d.vnet, 'sm4rt-vnet');
});

test('azureDefaultsFromEnv honours AZURE_* overrides', () => {
  const d = azureDefaultsFromEnv({ AZURE_VM_SIZE: 'Standard_B4ms', AZURE_LOCATION: 'eastus2' });
  assert.equal(d.size, 'Standard_B4ms');
  assert.equal(d.location, 'eastus2');
  assert.equal(d.resourceGroup, 'SM4RT-DEMO');
});

test('buildJoinScript installs docker, is idempotent and embeds the join command', () => {
  const script = buildJoinScript(JOIN);
  assert.ok(script.startsWith('#!/usr/bin/env bash'));
  assert.ok(script.includes('get.docker.com'));
  assert.ok(script.includes('LocalNodeState'));
  assert.ok(script.includes(JOIN));
});

test('buildCloudInit is valid cloud-config with docker install + join', () => {
  const init = buildCloudInit(JOIN);
  assert.ok(init.startsWith('#cloud-config'));
  assert.ok(init.includes('curl -fsSL https://get.docker.com | sh'));
  assert.ok(init.includes(JOIN));
});

test('buildAzureCreateCommand emits heredoc + az vm create with defaults', () => {
  const cmd = buildAzureCreateCommand({ joinCommand: JOIN, defaults: azureDefaultsFromEnv({}) });
  assert.ok(cmd.includes("cat > /tmp/sm4rt-join.yaml <<'EOF'"));
  assert.ok(cmd.includes('#cloud-config'));
  assert.ok(cmd.includes('az vm create'));
  assert.ok(cmd.includes('--resource-group SM4RT-DEMO'));
  assert.ok(cmd.includes('--name sm4rt-5'));
  assert.ok(cmd.includes('--size Standard_B2ms'));
  assert.ok(cmd.includes('--vnet-name sm4rt-vnet --subnet default'));
  assert.ok(cmd.includes('--custom-data /tmp/sm4rt-join.yaml'));
});

test('buildAzureCreateCommand count > 1 produces numbered names, capped at 10', () => {
  const cmd = buildAzureCreateCommand({
    joinCommand: JOIN,
    defaults: azureDefaultsFromEnv({}),
    name: 'sm4rt-x',
    count: 3,
  });
  assert.equal((cmd.match(/az vm create/g) ?? []).length, 3);
  assert.ok(cmd.includes('--name sm4rt-x\n') || cmd.includes('--name sm4rt-x '));
  assert.ok(cmd.includes('--name sm4rt-x2'));
  assert.ok(cmd.includes('--name sm4rt-x3'));
  const capped = buildAzureCreateCommand({
    joinCommand: JOIN,
    defaults: azureDefaultsFromEnv({}),
    count: 99,
  });
  assert.equal((capped.match(/az vm create/g) ?? []).length, 10);
});

test('buildAzureCreateCommand tolerates blank name and NaN count', () => {
  const cmd = buildAzureCreateCommand({
    joinCommand: JOIN,
    defaults: azureDefaultsFromEnv({}),
    name: '  ',
    count: Number.NaN,
  });
  assert.ok(cmd.includes('--name sm4rt-5'));
  assert.equal((cmd.match(/az vm create/g) ?? []).length, 1);
});
