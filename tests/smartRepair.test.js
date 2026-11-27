import test from 'node:test';
import assert from 'node:assert/strict';
import * as repairService from '../src/lib/services/smartRepair.js';

const {
  MAX_AGENT_REPAIR_BYTES,
  createRepairSnapshot,
  isRepairSnapshotCurrent,
} = repairService;

test('repair service exposes separate local and Codex operations', () => {
  assert.equal(typeof repairService.runLocalRepair, 'function');
  assert.equal(typeof repairService.runCodexRepair, 'function');
});

test('local repair never needs a Codex dependency', async () => {
  const result = await repairService.runLocalRepair(
    { content: '{ok:true}', indent: 2 },
    {
      isStrictJson: () => false,
      repairLocal: async () => '{"ok":true}',
    },
  );

  assert.deepEqual(result, {
    status: 'repaired',
    source: 'local',
    content: '{"ok":true}',
  });
});

test('local repair reports content it cannot safely repair', async () => {
  const result = await repairService.runLocalRepair(
    { content: '{message:use // as text}', indent: 2 },
    {
      isStrictJson: () => false,
      repairLocal: async () => null,
    },
  );

  assert.deepEqual(result, { status: 'unrepairable' });
});

test('Codex repair calls the agent directly and formats its result', async () => {
  let receivedRequest = null;
  const result = await repairService.runCodexRepair(
    { content: '{ok:true}', indent: 2, requestId: 'r1', codexPath: '/codex' },
    {
      isStrictJson: () => false,
      repairAgent: async request => {
        receivedRequest = request;
        return '{"fixed":true}';
      },
      formatStrict: value => `formatted:${value}`,
      byteLength: value => new TextEncoder().encode(value).byteLength,
    },
  );

  assert.deepEqual(receivedRequest, {
    requestId: 'r1',
    configuredPath: '/codex',
    content: '{ok:true}',
  });
  assert.deepEqual(result, {
    status: 'repaired',
    source: 'codex',
    content: 'formatted:{"fixed":true}',
  });
});

test('valid JSON returns without running either repair engine', async () => {
  let localCalls = 0;
  let agentCalls = 0;

  const localResult = await repairService.runLocalRepair(
    { content: '{"ok":true}', indent: 2 },
    {
      isStrictJson: () => true,
      repairLocal: async () => {
        localCalls += 1;
        return null;
      },
    },
  );
  const codexResult = await repairService.runCodexRepair(
    { content: '{"ok":true}', indent: 2, requestId: 'r2', codexPath: '' },
    {
      isStrictJson: () => true,
      repairAgent: async () => {
        agentCalls += 1;
        return '{}';
      },
      formatStrict: value => value,
      byteLength: value => new TextEncoder().encode(value).byteLength,
    },
  );

  assert.deepEqual(localResult, { status: 'valid' });
  assert.deepEqual(codexResult, { status: 'valid' });
  assert.equal(localCalls, 0);
  assert.equal(agentCalls, 0);
});

test('Codex repair enforces the byte limit before invoking the agent', async () => {
  let agentCalls = 0;

  await assert.rejects(
    repairService.runCodexRepair(
      { content: 'broken', indent: 2, requestId: 'r3', codexPath: '' },
      {
        isStrictJson: () => false,
        repairAgent: async () => {
          agentCalls += 1;
          return '{}';
        },
        formatStrict: value => value,
        byteLength: () => MAX_AGENT_REPAIR_BYTES + 1,
      },
    ),
    { code: 'input_too_large' },
  );
  assert.equal(agentCalls, 0);
});

test('cancelling local repair never calls the Codex cancellation command', async () => {
  let localCancelCalls = 0;
  let agentCancelCalls = 0;

  await repairService.cancelRepair('r4', 'local', {
    cancelLocal: () => {
      localCancelCalls += 1;
    },
    cancelAgent: async () => {
      agentCancelCalls += 1;
    },
  });

  assert.equal(localCancelCalls, 1);
  assert.equal(agentCancelCalls, 0);
});

test('cancelling Codex repair only calls the agent cancellation command', async () => {
  let localCancelCalls = 0;
  let agentCancelCalls = 0;

  await repairService.cancelRepair('r5', 'codex', {
    cancelLocal: () => {
      localCancelCalls += 1;
    },
    cancelAgent: async requestId => {
      assert.equal(requestId, 'r5');
      agentCancelCalls += 1;
    },
  });

  assert.equal(localCancelCalls, 0);
  assert.equal(agentCancelCalls, 1);
});

test('snapshot matching rejects changed content and model versions', () => {
  const snapshot = createRepairSnapshot('tab-1', 'model://tab-1', 4, 'broken');
  assert.equal(isRepairSnapshotCurrent(snapshot, snapshot), true);
  assert.equal(
    isRepairSnapshotCurrent(snapshot, { ...snapshot, modelVersion: 5 }),
    false,
  );
  assert.equal(
    isRepairSnapshotCurrent(snapshot, { ...snapshot, content: 'edited' }),
    false,
  );
});
