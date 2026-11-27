import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('settings panel registers an independent smart repair tab', async () => {
  const source = await readFile('src/lib/components/SettingsPanel.svelte', 'utf8');
  assert.match(source, /type SettingsTab =[\s\S]*'smartRepair'/);
  assert.match(source, /settings\.smartRepair/);
  assert.match(source, /<SmartRepairSettings/);
});

test('smart repair settings expose status, path, refresh, and enable controls', async () => {
  const source = await readFile('src/lib/components/SmartRepairSettings.svelte', 'utf8');
  assert.match(source, /detectCodexCli/);
  assert.match(source, /selectCodexCli/);
  assert.match(source, /role="switch"/);
  assert.match(source, /ConfirmDialog/);
  assert.match(source, /smartRepairPrivacyAccepted/);
});

test('toolbar places local repair before optional smart repair after fold controls', async () => {
  const source = await readFile('src/lib/components/editor/JsonEditorToolbar.svelte', 'utf8');
  const foldIndex = source.indexOf("$t('toolbar.foldAll')");
  const localRepairIndex = source.indexOf("$t('toolbar.localRepair')");
  const smartRepairIndex = source.indexOf("$t('toolbar.smartRepair')");
  assert.ok(foldIndex >= 0);
  assert.ok(localRepairIndex > foldIndex);
  assert.ok(smartRepairIndex > localRepairIndex);
  assert.match(source, /onCancelRepair/);
});

test('repair preview is read only and exposes apply and discard', async () => {
  const source = await readFile('src/lib/components/editor/SmartRepairDiffView.svelte', 'utf8');
  assert.match(source, /readOnly=\{true\}/);
  assert.match(source, /onApply/);
  assert.match(source, /onDiscard/);
  assert.match(source, /repair\.apply/);
  assert.match(source, /repair\.discard/);
});

test('main editor owns repair snapshot cancellation and undo-safe apply', async () => {
  const source = await readFile('src/lib/components/editor/JsonEditor.svelte', 'utf8');
  assert.match(source, /createRepairSnapshot/);
  assert.match(source, /isRepairSnapshotCurrent/);
  assert.match(source, /cancelRepair/);
  assert.match(source, /monacoEditor\?\.setValue\(repairPreview\.content\)/);
  assert.match(source, /repair\.localExecutionFailed/);
});
