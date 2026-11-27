import { expect, test } from '@playwright/test';
import { installTauriEditorHarness } from './helpers/editorHarness.js';

const LOCAL_SOURCE = '{"name":"JsonStudio" "enabled":true}';
const WHOLE_DOCUMENT_REPAIR_SOURCE = '{name:"JsonStudio" enabled:true}';
const NESTED_FRAGMENT_SOURCE = '{"segmentIds":[fbd4d2a6-5da2-4dcf-80f7-a9193379ce3a],"memberIds":[1582833131]}';
const CODEX_SOURCE = '{message:use // as text}';
const REPAIRED_BY_CODEX = '{\n  "message": "use // as text"\n}';

const enabledSettings = {
  smartRepairEnabled: true,
  smartRepairPrivacyAccepted: true,
  codexCliPath: '',
};

const disabledSettings = {
  smartRepairEnabled: false,
  smartRepairPrivacyAccepted: false,
  codexCliPath: '',
};

const detectedCodex = {
  available: true,
  path: '/usr/local/bin/codex',
  version: 'codex-cli 1.2.3',
  source: 'path',
  error: null,
};

async function getMainEditorValue(page) {
  return page.evaluate(async () => {
    const { initMonaco } = await import('/src/lib/services/monaco.ts');
    return (await initMonaco()).editor.getEditors()[0]?.getValue() ?? '';
  });
}

async function setMainEditorValue(page, value) {
  await page.evaluate(async (nextValue) => {
    const { initMonaco } = await import('/src/lib/services/monaco.ts');
    (await initMonaco()).editor.getEditors()[0]?.setValue(nextValue);
  }, value);
}

async function getSmartRepairCalls(page) {
  return page.evaluate(() => window.__SMART_REPAIR_CALLS__ ?? []);
}

async function openSmartRepairSettings(page) {
  await page.getByRole('button', { name: 'Open settings and shortcuts', exact: true }).click();
  await page.locator('.settings-tabs').getByRole('button', {
    name: 'Smart Repair',
    exact: true,
  }).click();
}

test('settings detect Codex and remember the privacy confirmation', async ({ page }) => {
  await installTauriEditorHarness(page, '{"ready":true}', {
    isTauri: true,
    settings: {
      smartRepairEnabled: false,
      smartRepairPrivacyAccepted: false,
      codexCliPath: '',
    },
    agentScenario: { detectStatus: detectedCodex },
  });
  await page.goto('/');
  await openSmartRepairSettings(page);

  await expect(page.getByText('Codex CLI detected', { exact: true })).toBeVisible();
  await expect(page.getByText('/usr/local/bin/codex', { exact: true })).toBeVisible();
  await expect(page.getByText('codex-cli 1.2.3', { exact: true })).toBeVisible();

  const enabledSwitch = page.getByRole('switch', { name: 'Enable smart repair' });
  await enabledSwitch.click();
  const privacyDialog = page.getByRole('dialog', { name: 'Allow Codex smart repair?' });
  await expect(privacyDialog).toBeVisible();
  await privacyDialog.getByRole('button', { name: 'Enable smart repair' }).click();
  await expect(enabledSwitch).toHaveAttribute('aria-checked', 'true');

  await enabledSwitch.click();
  await expect(enabledSwitch).toHaveAttribute('aria-checked', 'false');
  await enabledSwitch.click();
  await expect(enabledSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(privacyDialog).toHaveCount(0);
});

test('local repair opens a read-only preview and discard keeps the source', async ({ page }) => {
  await installTauriEditorHarness(page, LOCAL_SOURCE, {
    settings: disabledSettings,
    agentScenario: { detectStatus: detectedCodex },
  });
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Local repair', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Smart repair', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Local repair', exact: true }).click();
  const preview = page.getByTestId('smart-repair-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Local repair');
  expect((await getSmartRepairCalls(page)).filter(call => call.command === 'repair_json_with_agent')).toHaveLength(0);

  await preview.locator('.discard-button').click();
  await expect(preview).toHaveCount(0);
  expect(await getMainEditorValue(page)).toBe(LOCAL_SOURCE);
});

test('local repair failure never calls Codex', async ({ page }) => {
  await installTauriEditorHarness(page, CODEX_SOURCE, {
    settings: disabledSettings,
    agentScenario: {
      detectStatus: detectedCodex,
      repairedJson: REPAIRED_BY_CODEX,
    },
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Local repair', exact: true }).click();
  await expect(page.getByText(
    'Local repair could not safely repair this JSON',
    { exact: true },
  )).toBeVisible();
  expect((await getSmartRepairCalls(page)).filter(
    call => call.command === 'repair_json_with_agent',
  )).toHaveLength(0);
});

test('local repair remains visible while log detection is pending', async ({ page }) => {
  let markWorkerRequested;
  const workerRequested = new Promise(resolve => {
    markWorkerRequested = resolve;
  });
  let releaseWorker;

  await page.route(/logJson\.worker/, async route => {
    markWorkerRequested();
    await new Promise(resolve => {
      releaseWorker = resolve;
    });
    await route.continue();
  });

  await installTauriEditorHarness(page, LOCAL_SOURCE, {
    settings: disabledSettings,
    agentScenario: { detectStatus: detectedCodex },
  });

  try {
    await page.goto('/');
    await workerRequested;
    await expect(page.getByRole('button', {
      name: 'Local repair',
      exact: true,
    })).toBeVisible({ timeout: 500 });
  } finally {
    releaseWorker?.();
  }
});

test('finishing log detection does not cancel an active smart repair', async ({ page }) => {
  let markWorkerRequested;
  const workerRequested = new Promise(resolve => {
    markWorkerRequested = resolve;
  });
  let releaseWorker;

  await page.route(/logJson\.worker/, async route => {
    markWorkerRequested();
    await new Promise(resolve => {
      releaseWorker = resolve;
    });
    await route.continue();
  });

  await installTauriEditorHarness(page, CODEX_SOURCE, {
    settings: enabledSettings,
    agentScenario: {
      detectStatus: detectedCodex,
      repairedJson: REPAIRED_BY_CODEX,
      delayMs: 500,
    },
  });

  try {
    await page.goto('/');
    await workerRequested;
    await expect(page.getByTestId('json-editor')).toHaveAttribute(
      'data-active-model-key',
      'editor-test-tab',
    );
    await expect.poll(() => getMainEditorValue(page)).toBe(CODEX_SOURCE);
    await page.getByRole('button', { name: 'Smart repair', exact: true }).click();
    await expect.poll(async () => (
      (await getSmartRepairCalls(page)).some(call => call.command === 'repair_json_with_agent')
    )).toBe(true);
    releaseWorker();
    releaseWorker = null;

    await expect(page.getByTestId('smart-repair-preview')).toBeVisible();
    const calls = await getSmartRepairCalls(page);
    expect(calls.some(call => call.command === 'cancel_agent_task')).toBe(false);
  } finally {
    releaseWorker?.();
  }
});

test('local repair remains visible when invalid JSON contains nested fragments', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (!String(url).includes('logJson.worker')) return;
        this.addEventListener('message', () => {
          window.__LOG_JSON_DETECTION_COMPLETED__ = true;
        }, { once: true });
      }
    };
  });

  await installTauriEditorHarness(page, NESTED_FRAGMENT_SOURCE, {
    settings: disabledSettings,
    agentScenario: { detectStatus: detectedCodex },
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => (
    window.__LOG_JSON_DETECTION_COMPLETED__ ?? false
  ))).toBe(true);

  await expect(page.locator('.log-json-result')).toHaveCount(0);
  await expect(page.getByRole('button', {
    name: 'Local repair',
    exact: true,
  })).toBeVisible();
  await expect(page.getByRole('button', {
    name: 'Smart repair',
    exact: true,
  })).toHaveCount(0);
});

test('enabling Codex adds smart repair beside the persistent local action', async ({ page }) => {
  await installTauriEditorHarness(page, WHOLE_DOCUMENT_REPAIR_SOURCE, {
    isTauri: true,
    settings: {
      smartRepairEnabled: false,
      smartRepairPrivacyAccepted: false,
      codexCliPath: '',
    },
    agentScenario: { detectStatus: detectedCodex },
  });
  await page.goto('/');

  await expect(page.locator('.log-json-result')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Local repair', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Smart repair', exact: true })).toHaveCount(0);
  await openSmartRepairSettings(page);
  await page.getByRole('switch', { name: 'Enable smart repair' }).click();
  await page.getByRole('dialog', { name: 'Allow Codex smart repair?' })
    .getByRole('button', { name: 'Enable smart repair' }).click();
  await page.locator('.settings-close-btn').click();

  await expect(page.getByRole('button', {
    name: 'Smart repair',
    exact: true,
  })).toBeVisible();
  await expect(page.locator('.log-json-result')).toHaveCount(0);
});

test('smart repair calls Codex directly even when local repair could succeed', async ({ page }) => {
  await installTauriEditorHarness(page, LOCAL_SOURCE, {
    settings: enabledSettings,
    agentScenario: {
      detectStatus: detectedCodex,
      repairedJson: REPAIRED_BY_CODEX,
    },
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Smart repair', exact: true }).click();
  const preview = page.getByTestId('smart-repair-preview');
  await expect(preview).toContainText('Codex smart repair');

  const calls = (await getSmartRepairCalls(page)).filter(call => call.command === 'repair_json_with_agent');
  expect(calls).toHaveLength(1);
  expect(calls[0].args.content).toBe(LOCAL_SOURCE);
  expect(calls[0].args.configuredPath).toBeNull();
});

test('editing during Codex repair cancels the request and rejects the stale result', async ({ page }) => {
  await installTauriEditorHarness(page, CODEX_SOURCE, {
    settings: enabledSettings,
    agentScenario: {
      detectStatus: detectedCodex,
      repairedJson: REPAIRED_BY_CODEX,
      delayMs: 500,
    },
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Smart repair', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel repair' })).toBeVisible();
  await setMainEditorValue(page, '{"edited":true}');
  await expect(page.getByText('Repair was cancelled because the content changed')).toBeVisible();
  await page.waitForTimeout(600);

  await expect(page.getByTestId('smart-repair-preview')).toHaveCount(0);
  expect(await getMainEditorValue(page)).toBe('{"edited":true}');
  const calls = await getSmartRepairCalls(page);
  const repairCall = calls.find(call => call.command === 'repair_json_with_agent');
  const cancelCall = calls.find(call => call.command === 'cancel_agent_task');
  expect(cancelCall.args.requestId).toBe(repairCall.args.requestId);
});

test('external content updates cancel an active repair', async ({ page }) => {
  await installTauriEditorHarness(page, CODEX_SOURCE, {
    settings: enabledSettings,
    agentScenario: {
      detectStatus: detectedCodex,
      repairedJson: REPAIRED_BY_CODEX,
      delayMs: 500,
    },
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Smart repair', exact: true }).click();
  await page.evaluate(async () => {
    const { tabsStore } = await import('/src/lib/stores/tabs.ts');
    tabsStore.updateTabContent('editor-test-tab', '{"external":true}', false);
  });

  await expect(page.getByText('Repair was cancelled because the content changed')).toBeVisible();
  await expect.poll(() => getMainEditorValue(page)).toBe('{"external":true}');
  const calls = await getSmartRepairCalls(page);
  expect(calls.some(call => call.command === 'cancel_agent_task')).toBe(true);
});

test('external content updates close an obsolete repair preview', async ({ page }) => {
  await installTauriEditorHarness(page, LOCAL_SOURCE, { settings: disabledSettings });
  await page.goto('/');

  await page.getByRole('button', { name: 'Local repair', exact: true }).click();
  await expect(page.getByTestId('smart-repair-preview')).toBeVisible();
  await page.evaluate(async () => {
    const { tabsStore } = await import('/src/lib/stores/tabs.ts');
    tabsStore.updateTabContent('editor-test-tab', '{"external":true}', false);
  });

  await expect(page.getByTestId('smart-repair-preview')).toHaveCount(0);
  await expect.poll(() => getMainEditorValue(page)).toBe('{"external":true}');
});

test('disabling smart repair keeps the active Codex cancellation control', async ({ page }) => {
  await installTauriEditorHarness(page, CODEX_SOURCE, {
    isTauri: true,
    settings: enabledSettings,
    agentScenario: {
      detectStatus: detectedCodex,
      repairedJson: REPAIRED_BY_CODEX,
      delayMs: 1_000,
    },
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Smart repair', exact: true }).click();
  await openSmartRepairSettings(page);
  await page.getByRole('switch', { name: 'Enable smart repair' }).click();
  await page.locator('.settings-close-btn').click();

  const cancelButton = page.getByRole('button', { name: 'Cancel repair' });
  await expect(cancelButton).toBeVisible();
  await cancelButton.click();
  await expect(cancelButton).toHaveCount(0);
  await expect.poll(async () => (
    (await getSmartRepairCalls(page)).some(call => call.command === 'cancel_agent_task')
  )).toBe(true);
});

test('applying a local repair is restored by one undo', async ({ page }) => {
  await installTauriEditorHarness(page, LOCAL_SOURCE, { settings: disabledSettings });
  await page.goto('/');

  await page.getByRole('button', { name: 'Local repair', exact: true }).click();
  await page.getByTestId('smart-repair-apply').click();
  await expect.poll(() => getMainEditorValue(page)).toContain('"enabled": true');

  await page.evaluate(async () => {
    const { initMonaco } = await import('/src/lib/services/monaco.ts');
    await (await initMonaco()).editor.getEditors()[0].getModel().undo();
  });
  await expect.poll(() => getMainEditorValue(page)).toBe(LOCAL_SOURCE);
});

const agentErrors = [
  ['cli_not_found', 'Codex CLI was not found. Check Smart Repair settings.'],
  ['invalid_cli_path', 'The configured Codex CLI path is invalid'],
  ['authentication_failed', 'Codex authentication failed. Check the CLI credentials and try again.'],
  ['network_failed', 'Codex could not connect to its model service'],
  ['quota_or_rate_limited', 'Codex quota or rate limit was reached'],
  ['model_failed', 'The model configured for Codex is unavailable'],
  ['timed_out', 'Codex repair timed out after 120 seconds'],
  ['unexpected_error', 'Smart repair failed. Check Codex CLI and try again.'],
];

for (const [code, message] of agentErrors) {
  test(`error ${code} keeps the document unchanged`, async ({ page }) => {
    await installTauriEditorHarness(page, CODEX_SOURCE, {
      settings: enabledSettings,
      agentScenario: {
        detectStatus: detectedCodex,
        error: { code },
      },
    });
    await page.goto('/');

    await page.getByRole('button', { name: 'Smart repair', exact: true }).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(page.getByTestId('smart-repair-preview')).toHaveCount(0);
    expect(await getMainEditorValue(page)).toBe(CODEX_SOURCE);
  });
}

test('error invalid agent output keeps the document unchanged', async ({ page }) => {
  await installTauriEditorHarness(page, CODEX_SOURCE, {
    settings: enabledSettings,
    agentScenario: {
      detectStatus: detectedCodex,
      repairedJson: 'not valid json',
    },
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Smart repair', exact: true }).click();
  await expect(page.getByText('Codex returned an invalid JSON repair result', { exact: true })).toBeVisible();
  expect(await getMainEditorValue(page)).toBe(CODEX_SOURCE);
});

test('error oversized UTF-8 input stops before Codex', async ({ page }) => {
  const oversizedSource = `${CODEX_SOURCE}\n${'中'.repeat(90_000)}`;
  await installTauriEditorHarness(page, oversizedSource, {
    settings: enabledSettings,
    agentScenario: { detectStatus: detectedCodex },
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Smart repair', exact: true }).click();
  await expect(page.getByText(
    'This content exceeds the 256 KiB Codex limit',
    { exact: true },
  )).toBeVisible();
  const calls = await getSmartRepairCalls(page);
  expect(calls.filter(call => call.command === 'repair_json_with_agent')).toHaveLength(0);
});

test('switching tabs cancels Codex repair and suppresses the stale result', async ({ page }) => {
  await installTauriEditorHarness(page, CODEX_SOURCE, {
    settings: enabledSettings,
    agentScenario: {
      detectStatus: detectedCodex,
      repairedJson: REPAIRED_BY_CODEX,
      delayMs: 500,
    },
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Smart repair', exact: true }).click();
  await page.evaluate(async () => {
    const { tabsStore } = await import('/src/lib/stores/tabs.ts');
    tabsStore.addTab('{"other":true}');
  });
  await expect(page.getByText('Repair was cancelled because the tab or view changed')).toBeVisible();
  await page.waitForTimeout(600);

  await expect(page.getByTestId('smart-repair-preview')).toHaveCount(0);
  expect(await getMainEditorValue(page)).toBe('{"other":true}');
  const calls = await getSmartRepairCalls(page);
  expect(calls.some(call => call.command === 'cancel_agent_task')).toBe(true);
});

test('entering Diff cancels Codex repair and suppresses the stale result', async ({ page }) => {
  await installTauriEditorHarness(page, CODEX_SOURCE, {
    settings: enabledSettings,
    agentScenario: {
      detectStatus: detectedCodex,
      repairedJson: REPAIRED_BY_CODEX,
      delayMs: 500,
    },
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Smart repair', exact: true }).click();
  await page.getByRole('button', { name: 'Diff', exact: true }).click();
  await expect(page.getByText('Repair was cancelled because the tab or view changed')).toBeVisible();
  await expect(page.locator('.monaco-diff-editor')).toBeVisible();
  await page.waitForTimeout(600);

  await expect(page.getByTestId('smart-repair-preview')).toHaveCount(0);
  const calls = await getSmartRepairCalls(page);
  expect(calls.some(call => call.command === 'cancel_agent_task')).toBe(true);
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 960, height: 640 },
]) {
  test(`responsive smart repair layout at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await installTauriEditorHarness(page, LOCAL_SOURCE, {
      settings: enabledSettings,
      agentScenario: { detectStatus: detectedCodex },
    });
    await page.goto('/');

    const foldButton = page.getByRole('button', { name: 'Fold', exact: true });
    const localRepairButton = page.getByRole('button', { name: 'Local repair', exact: true });
    const smartRepairButton = page.getByRole('button', { name: 'Smart repair', exact: true });
    const foldBox = await foldButton.boundingBox();
    const localRepairBox = await localRepairButton.boundingBox();
    const smartRepairBox = await smartRepairButton.boundingBox();
    expect(foldBox).not.toBeNull();
    expect(localRepairBox).not.toBeNull();
    expect(smartRepairBox).not.toBeNull();
    expect(foldBox.x + foldBox.width).toBeLessThanOrEqual(localRepairBox.x);
    expect(localRepairBox.x + localRepairBox.width).toBeLessThanOrEqual(smartRepairBox.x);

    await openSmartRepairSettings(page);
    await expect(page.locator('.settings-body')).toBeVisible();
    expect(await page.locator('.settings-body').evaluate(element => {
      const style = getComputedStyle(element);
      return style.overflowY === 'auto' && element.scrollHeight >= element.clientHeight;
    })).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`smart-repair-settings-${viewport.width}.png`),
      animations: 'disabled',
    });
    await page.locator('.settings-close-btn').click();

    await localRepairButton.click();
    const preview = page.getByTestId('smart-repair-preview');
    await expect(preview).toBeVisible();
    await expect(page.getByTestId('smart-repair-apply')).toBeVisible();
    await expect(preview.locator('.discard-button')).toBeVisible();

    const applyBox = await page.getByTestId('smart-repair-apply').boundingBox();
    const discardBox = await preview.locator('.discard-button').boundingBox();
    expect(applyBox.x + applyBox.width).toBeLessThanOrEqual(viewport.width);
    expect(discardBox.x + discardBox.width).toBeLessThanOrEqual(applyBox.x);

    await page.screenshot({
      path: testInfo.outputPath(`smart-repair-${viewport.width}.png`),
      animations: 'disabled',
    });
  });
}
