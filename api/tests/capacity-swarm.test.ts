// Functional test for pool capacity accounting, against a REAL swarm. Gated
// behind RUN_SWARM=1 because it needs a live docker daemon in swarm mode.
//
// Locally:
//   docker swarm init                     # once
//   RUN_SWARM=1 node --test tests/capacity-swarm.test.ts
//
// It exercises SwarmDriver itself rather than a copy of its logic, so it
// catches the thing a mirrored unit test cannot: docker changing the shape of
// what it returns, or the production code drifting from what we assert.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import Docker from 'dockerode';
import { SwarmDriver } from '../src/swarm.ts';

const RUN = process.env.RUN_SWARM === '1';
const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const created: string[] = [];

// A name no real deployment would use, so cleanup can never touch live work.
const PREFIX = 'captest-';
const IMAGE = process.env.CAPACITY_TEST_IMAGE ?? 'alpine:3.20';
const GiB = 1024 ** 3;

function provisioner(): SwarmDriver {
  return new SwarmDriver({ instanceDomain: 'captest.local', flociImage: IMAGE, tls: false });
}

/** A service that sleeps, reserving what we ask for. */
async function createService(
  name: string,
  reservations: { cpuMilli: number; memBytes: number },
  constraints: string[] = [],
): Promise<void> {
  const spec: Docker.CreateServiceOptions = {
    Name: name,
    TaskTemplate: {
      ContainerSpec: { Image: IMAGE, Command: ['sleep', '3600'] },
      Resources: {
        Reservations: {
          NanoCPUs: reservations.cpuMilli * 1e6,
          MemoryBytes: reservations.memBytes,
        },
      },
      RestartPolicy: { Condition: 'none' },
      ...(constraints.length ? { Placement: { Constraints: constraints } } : {}),
    },
    Mode: { Replicated: { Replicas: 1 } },
  };
  await docker.createService(spec);
  created.push(name);
}

/**
 * State of the newest task of a service. Updating a service leaves the old
 * task behind in `shutdown` while the replacement starts, so the newest one is
 * the only meaningful answer — the same reason production sorts by CreatedAt
 * in SwarmDriver.newestTask.
 */
async function taskStateOf(service: string): Promise<string> {
  const tasks = (await docker.listTasks({
    filters: JSON.stringify({ service: [service] }),
  })) as Array<{ CreatedAt?: string; Status?: { State?: string } }>;
  const newest = [...tasks].sort((a, b) =>
    String(b.CreatedAt ?? '').localeCompare(String(a.CreatedAt ?? '')),
  )[0];
  return newest?.Status?.State ?? 'none';
}

async function waitForTaskState(service: string, want: string, ms: number): Promise<string> {
  const deadline = Date.now() + ms;
  let last = 'none';
  while (Date.now() < deadline) {
    last = await taskStateOf(service);
    if (last === want) return last;
    await sleep(500);
  }
  return last;
}

after(async () => {
  for (const name of created) {
    await docker.getService(name).remove().catch(() => {});
  }
});

test('reserved capacity shows up against the node running the task', { skip: !RUN }, async () => {
  const nodesBefore = await provisioner().nodes();
  assert.ok(nodesBefore.length > 0, 'expected at least one swarm node');
  const beforeById = new Map(nodesBefore.map((n) => [n.id, n]));

  const name = `${PREFIX}reserve`;
  await createService(name, { cpuMilli: 250, memBytes: 512 * 1024 * 1024 });
  const state = await waitForTaskState(name, 'running', 60_000);
  assert.equal(state, 'running', 'the task should have been scheduled');

  const nodesAfter = await provisioner().nodes();
  // Exactly one node should have grown, and by exactly what we reserved.
  const grew = nodesAfter.filter((n) => {
    const before = beforeById.get(n.id);
    return before && n.cpuUsedMilli !== null && (n.cpuUsedMilli ?? 0) > (before.cpuUsedMilli ?? 0);
  });
  assert.equal(grew.length, 1, 'one node should account for the new reservation');

  const node = grew[0]!;
  const before = beforeById.get(node.id)!;
  assert.equal((node.cpuUsedMilli ?? 0) - (before.cpuUsedMilli ?? 0), 250);
  assert.equal((node.memUsedBytes ?? 0) - (before.memUsedBytes ?? 0), 512 * 1024 * 1024);
});

test('used never exceeds the node total it is reported against', { skip: !RUN }, async () => {
  // The admin view divides one by the other; a ratio above 1 would mean the
  // two numbers are measured against different things.
  for (const node of await provisioner().nodes()) {
    assert.ok(node.cpuUsedMilli !== null, `${node.hostname} should report cpu usage`);
    assert.ok(node.memUsedBytes !== null, `${node.hostname} should report memory usage`);
    assert.ok(
      (node.cpuUsedMilli ?? 0) <= node.cpuTotalMilli,
      `${node.hostname}: used cpu ${node.cpuUsedMilli} > total ${node.cpuTotalMilli}`,
    );
    assert.ok(
      (node.memUsedBytes ?? 0) <= node.memTotalBytes,
      `${node.hostname}: used mem ${node.memUsedBytes} > total ${node.memTotalBytes}`,
    );
  }
});

test('a task the pool cannot fit stays pending and is not charged to any node', { skip: !RUN }, async () => {
  // Reserve more memory than any machine has. Swarm keeps the task pending
  // rather than failing it — this is the case that used to be reported as
  // "provisioning" forever.
  const nodes = await provisioner().nodes();
  const biggest = Math.max(...nodes.map((n) => n.memTotalBytes));
  const impossible = biggest + 64 * GiB;

  const name = `${PREFIX}toobig`;
  await createService(name, { cpuMilli: 100, memBytes: impossible });

  const state = await waitForTaskState(name, 'pending', 30_000);
  assert.equal(state, 'pending', 'swarm should hold an unplaceable task as pending');

  // Pending tasks have no node, so nothing may absorb that reservation.
  const after = await provisioner().nodes();
  for (const node of after) {
    assert.ok(
      (node.memUsedBytes ?? 0) < impossible,
      `${node.hostname} absorbed a reservation that was never placed`,
    );
    assert.ok((node.memUsedBytes ?? 0) <= node.memTotalBytes);
  }
});

test('a pending task becomes running once it fits', { skip: !RUN }, async () => {
  // The whole premise of reporting it as queued instead of failed: nobody has
  // to retry. Placement is blocked with an unsatisfiable constraint, then the
  // constraint is lifted and the task should schedule itself.
  const name = `${PREFIX}unblock`;
  await createService(name, { cpuMilli: 100, memBytes: 64 * 1024 * 1024 }, [
    'node.labels.captest_absent==yes',
  ]);
  assert.equal(await waitForTaskState(name, 'pending', 30_000), 'pending');

  await docker.getService(name).update({
    ...(await docker.getService(name).inspect().then((i: { Spec: object; Version: { Index: number } }) => ({
      ...i.Spec,
      version: i.Version.Index,
    }))),
    TaskTemplate: {
      ContainerSpec: { Image: IMAGE, Command: ['sleep', '3600'] },
      Resources: { Reservations: { NanoCPUs: 100 * 1e6, MemoryBytes: 64 * 1024 * 1024 } },
      RestartPolicy: { Condition: 'none' },
      Placement: {},
    },
  } as Parameters<ReturnType<typeof docker.getService>['update']>[0]);

  assert.equal(
    await waitForTaskState(name, 'running', 60_000),
    'running',
    'the task should have scheduled itself once placement was possible',
  );
});
