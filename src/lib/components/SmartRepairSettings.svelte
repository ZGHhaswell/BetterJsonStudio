<script lang="ts">
  import { onMount } from 'svelte';
  import {
    AlertCircle,
    Bot,
    CheckCircle,
    FolderOpen,
    RefreshCw,
    Trash2,
  } from '@lucide/svelte';
  import { t } from '$lib/i18n';
  import {
    AgentServiceError,
    detectCodexCli,
    selectCodexCli,
    type AgentCliStatus,
    type AgentErrorCode,
    type CliSource,
  } from '$lib/services/agent';
  import { settingsStore } from '$lib/stores/settings';
  import ConfirmDialog from './dialogs/ConfirmDialog.svelte';

  let cliStatus = $state<AgentCliStatus | null>(null);
  let isDetecting = $state(false);
  let pathInput = $state('');
  let showPrivacyConfirm = $state(false);
  let pendingEnable = $state(false);
  let detectionSequence = 0;
  let lastStoredPath = $state('');

  $effect(() => {
    const storedPath = $settingsStore.codexCliPath;
    if (storedPath === lastStoredPath) return;
    lastStoredPath = storedPath;
    pathInput = storedPath;
  });

  onMount(() => {
    pathInput = $settingsStore.codexCliPath;
    lastStoredPath = pathInput;
    void refreshCliStatus(pathInput);
  });

  function createUnavailableStatus(error: unknown): AgentCliStatus {
    const code: AgentErrorCode = error instanceof AgentServiceError
      ? error.code
      : 'unknown_cli_error';

    return {
      available: false,
      path: null,
      version: null,
      source: null,
      error: {
        code,
        message: error instanceof Error ? error.message : undefined,
      },
    };
  }

  async function refreshCliStatus(configuredPath = $settingsStore.codexCliPath) {
    const detectionId = ++detectionSequence;
    isDetecting = true;

    try {
      const status = await detectCodexCli(configuredPath);
      if (detectionId === detectionSequence) cliStatus = status;
    } catch (error) {
      if (detectionId === detectionSequence) cliStatus = createUnavailableStatus(error);
    } finally {
      if (detectionId === detectionSequence) isDetecting = false;
    }
  }

  async function saveManualPath() {
    const nextPath = pathInput.trim();
    pathInput = nextPath;

    if (nextPath !== $settingsStore.codexCliPath) {
      settingsStore.updateSetting('codexCliPath', nextPath);
    }

    await refreshCliStatus(nextPath);
  }

  async function browseForCli() {
    try {
      const selectedPath = await selectCodexCli();
      if (!selectedPath) return;

      pathInput = selectedPath;
      settingsStore.updateSetting('codexCliPath', selectedPath);
      await refreshCliStatus(selectedPath);
    } catch (error) {
      cliStatus = createUnavailableStatus(error);
    }
  }

  async function clearManualPath() {
    pathInput = '';
    settingsStore.updateSetting('codexCliPath', '');
    await refreshCliStatus('');
  }

  function handlePathKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.currentTarget instanceof HTMLInputElement && event.currentTarget.blur();
  }

  function handleEnabledToggle() {
    if ($settingsStore.smartRepairEnabled) {
      settingsStore.updateSetting('smartRepairEnabled', false);
      return;
    }

    if (!$settingsStore.smartRepairPrivacyAccepted && cliStatus?.available === false) return;

    if ($settingsStore.smartRepairPrivacyAccepted) {
      settingsStore.updateSetting('smartRepairEnabled', true);
      return;
    }

    pendingEnable = true;
    showPrivacyConfirm = true;
  }

  function confirmPrivacy() {
    if (!pendingEnable) return;
    settingsStore.updateSettings({
      smartRepairPrivacyAccepted: true,
      smartRepairEnabled: true,
    });
    pendingEnable = false;
  }

  function cancelPrivacy() {
    pendingEnable = false;
  }

  function getSourceLabel(source: CliSource | null) {
    if (source === 'configured') return $t('settings.smartRepairSourceConfigured');
    if (source === 'path') return $t('settings.smartRepairSourcePath');
    if (source === 'common_location') return $t('settings.smartRepairSourceCommon');
    return $t('settings.smartRepairAutomatic');
  }

  function getErrorLabel(code: AgentErrorCode | undefined) {
    if (code === 'invalid_cli_path') return $t('settings.smartRepairInvalidPath');
    if (code === 'cli_version_failed') return $t('settings.smartRepairVersionFailed');
    if (code === 'cli_not_found') return $t('settings.smartRepairMissing');
    return $t('settings.smartRepairDetectionFailed');
  }
</script>

<section class="smart-repair-settings">
  <h3 class="section-title">{$t('settings.smartRepairTitle')}</h3>

  <div class="provider-panel">
    <div class="provider-header">
      <div class="provider-identity">
        <span class="provider-icon" aria-hidden="true"><Bot size={18} /></span>
        <div>
          <div class="provider-name">{$t('settings.smartRepairProvider')}</div>
          <div class="provider-hint">{$t('settings.smartRepairEnabledHint')}</div>
        </div>
      </div>

      <button
        class="toggle {$settingsStore.smartRepairEnabled ? 'is-on' : ''}"
        role="switch"
        aria-checked={$settingsStore.smartRepairEnabled}
        aria-label={$t('settings.smartRepairEnabled')}
        title={$t('settings.smartRepairEnabled')}
        disabled={!$settingsStore.smartRepairEnabled && !$settingsStore.smartRepairPrivacyAccepted && cliStatus?.available === false}
        onclick={handleEnabledToggle}
        type="button"
      >
        <span class="toggle-thumb"></span>
      </button>
    </div>

    <div class="status-row" aria-live="polite">
      <div class="status-message" class:is-available={cliStatus?.available} class:is-error={cliStatus?.available === false}>
        {#if isDetecting}
          <RefreshCw class="spin" size={16} />
          <span>{$t('settings.smartRepairDetecting')}</span>
        {:else if cliStatus?.available}
          <CheckCircle size={16} />
          <span>{$t('settings.smartRepairDetected')}</span>
        {:else}
          <AlertCircle size={16} />
          <span>{getErrorLabel(cliStatus?.error?.code)}</span>
        {/if}
      </div>

      <button
        class="icon-button"
        type="button"
        aria-label={$t('settings.smartRepairRefresh')}
        title={$t('settings.smartRepairRefresh')}
        disabled={isDetecting}
        onclick={() => refreshCliStatus()}
      >
        <RefreshCw size={15} />
      </button>
    </div>

    {#if cliStatus?.available}
      <dl class="cli-details">
        <div>
          <dt>{$t('settings.smartRepairPath')}</dt>
          <dd title={cliStatus.path ?? ''}>{cliStatus.path}</dd>
        </div>
        <div>
          <dt>{$t('settings.smartRepairVersion')}</dt>
          <dd>{cliStatus.version}</dd>
        </div>
        <div>
          <dt>{$t('settings.smartRepairSource')}</dt>
          <dd>{getSourceLabel(cliStatus.source)}</dd>
        </div>
      </dl>
    {/if}

    {#if !$settingsStore.smartRepairPrivacyAccepted && cliStatus?.available === false}
      <p class="cli-required" role="alert">{$t('settings.smartRepairCliRequired')}</p>
    {/if}

    <div class="path-field">
      <label for="codex-cli-path">{$t('settings.smartRepairManualPath')}</label>
      <div class="path-controls">
        <input
          id="codex-cli-path"
          bind:value={pathInput}
          placeholder={$t('settings.smartRepairAutomatic')}
          spellcheck="false"
          onblur={saveManualPath}
          onkeydown={handlePathKeydown}
        />
        <button
          class="action-button"
          type="button"
          onclick={browseForCli}
          title={$t('settings.smartRepairBrowse')}
        >
          <FolderOpen size={15} />
          <span>{$t('settings.smartRepairBrowse')}</span>
        </button>
        <button
          class="icon-button"
          type="button"
          onclick={clearManualPath}
          title={$t('settings.smartRepairClear')}
          aria-label={$t('settings.smartRepairClear')}
          disabled={!$settingsStore.codexCliPath}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  </div>

  <p class="privacy-note">{$t('settings.smartRepairPrivacyMessage')}</p>
</section>

<ConfirmDialog
  bind:isOpen={showPrivacyConfirm}
  title={$t('settings.smartRepairPrivacyTitle')}
  message={$t('settings.smartRepairPrivacyMessage')}
  confirmText={$t('settings.smartRepairPrivacyConfirm')}
  cancelText={$t('settings.smartRepairPrivacyCancel')}
  onConfirm={confirmPrivacy}
  onCancel={cancelPrivacy}
/>

<style>
  .smart-repair-settings {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .section-title {
    padding-bottom: 12px;
    color: var(--text-tertiary);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .provider-panel {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg-secondary) 60%, transparent);
  }

  .provider-header,
  .status-row,
  .path-field {
    padding: 16px 20px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }

  .provider-header,
  .status-row,
  .path-controls {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .provider-header,
  .status-row {
    justify-content: space-between;
  }

  .provider-identity {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 12px;
  }

  .provider-icon {
    display: inline-flex;
    width: 34px;
    height: 34px;
    flex: 0 0 34px;
    align-items: center;
    justify-content: center;
    border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }

  .provider-name {
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 650;
  }

  .provider-hint,
  .privacy-note,
  .cli-required {
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.5;
  }

  .provider-hint {
    margin-top: 3px;
  }

  .toggle {
    position: relative;
    width: 40px;
    height: 22px;
    flex: 0 0 40px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 11px;
    background: color-mix(in srgb, var(--border) 80%, var(--bg-tertiary));
    cursor: pointer;
    transition: background 0.2s ease, border-color 0.2s ease;
  }

  .toggle.is-on {
    border-color: color-mix(in srgb, var(--accent) 42%, transparent);
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .toggle:disabled,
  .icon-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--text-tertiary);
    transition: transform 0.2s ease, background 0.2s ease;
  }

  .toggle.is-on .toggle-thumb {
    transform: translateX(18px);
    background: var(--accent);
  }

  .status-message {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
    color: var(--text-secondary);
    font-size: 13px;
  }

  .status-message.is-available {
    color: var(--success);
  }

  .status-message.is-error,
  .cli-required {
    color: var(--error);
  }

  .icon-button,
  .action-button {
    display: inline-flex;
    min-height: 32px;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-primary);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .icon-button {
    width: 32px;
    flex: 0 0 32px;
    padding: 0;
  }

  .action-button {
    gap: 7px;
    padding: 0 11px;
    font-size: 12px;
    font-weight: 650;
    white-space: nowrap;
  }

  .icon-button:hover:not(:disabled),
  .action-button:hover {
    border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .cli-details {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(100px, 1fr) minmax(100px, 1fr);
    gap: 14px;
    padding: 14px 20px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }

  .cli-details div {
    min-width: 0;
  }

  .cli-details dt,
  .path-field label {
    margin-bottom: 5px;
    color: var(--text-tertiary);
    font-size: 11px;
    font-weight: 650;
  }

  .cli-details dd {
    overflow: hidden;
    margin: 0;
    color: var(--text-secondary);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cli-required {
    margin: 0;
    padding: 10px 20px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
    background: color-mix(in srgb, var(--error) 7%, transparent);
  }

  .path-field {
    border-bottom: 0;
  }

  .path-field label {
    display: block;
  }

  .path-controls input {
    min-width: 0;
    height: 34px;
    flex: 1;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    outline: none;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 12px;
  }

  .path-controls input:focus {
    border-color: color-mix(in srgb, var(--accent) 58%, var(--border));
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .privacy-note {
    margin: 0;
    padding: 0 2px;
  }

  :global(.spin) {
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 720px) {
    .provider-header,
    .status-row,
    .path-field {
      padding-right: 14px;
      padding-left: 14px;
    }

    .cli-details {
      grid-template-columns: 1fr;
      padding-right: 14px;
      padding-left: 14px;
    }

    .path-controls {
      flex-wrap: wrap;
    }

    .path-controls input {
      flex-basis: 100%;
    }
  }
</style>
