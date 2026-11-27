<script lang="ts">
  import { Check, Sparkles, X } from '@lucide/svelte';
  import type { EditorTheme } from '$lib/config/monacoThemes';
  import { t } from '$lib/i18n';
  import MonacoDiffEditor from './MonacoDiffEditor.svelte';

  type RepairSource = 'local' | 'codex';

  type SmartRepairDiffProps = {
    originalContent: string;
    repairedContent: string;
    source: RepairSource;
    theme: EditorTheme;
    fontSize: number;
    lineHeight: number;
    tabSize: number;
    onApply: () => void;
    onDiscard: () => void;
  };

  let {
    originalContent,
    repairedContent,
    source,
    theme,
    fontSize,
    lineHeight,
    tabSize,
    onApply,
    onDiscard,
  }: SmartRepairDiffProps = $props();
</script>

<div class="repair-preview" data-testid="smart-repair-preview">
  <div class="repair-actions">
    <div class="repair-source">
      <Sparkles size={16} aria-hidden="true" />
      <span>{source === 'local' ? $t('repair.sourceLocal') : $t('repair.sourceCodex')}</span>
    </div>
    <div class="repair-buttons">
      <button class="discard-button" type="button" onclick={onDiscard}>
        <X size={15} aria-hidden="true" />
        <span>{$t('repair.discard')}</span>
      </button>
      <button
        class="apply-button"
        type="button"
        data-testid="smart-repair-apply"
        onclick={onApply}
      >
        <Check size={15} aria-hidden="true" />
        <span>{$t('repair.apply')}</span>
      </button>
    </div>
  </div>

  <div class="repair-diff">
    <MonacoDiffEditor
      originalValue={originalContent}
      modifiedValue={repairedContent}
      language="json"
      {theme}
      readOnly={true}
      {fontSize}
      {lineHeight}
      {tabSize}
      originalLabel={$t('repair.original')}
      modifiedLabel={$t('repair.repaired')}
      exitLabel={$t('repair.discard')}
      onExit={onDiscard}
    />
  </div>
</div>

<style>
  .repair-preview {
    display: flex;
    width: 100%;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    background: var(--bg-primary);
  }

  .repair-actions {
    display: flex;
    min-height: 44px;
    flex: 0 0 44px;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
  }

  .repair-source,
  .repair-buttons,
  .apply-button,
  .discard-button {
    display: flex;
    align-items: center;
  }

  .repair-source {
    min-width: 0;
    gap: 8px;
    color: var(--accent);
    font-size: 12px;
    font-weight: 650;
  }

  .repair-buttons {
    flex: 0 0 auto;
    gap: 8px;
  }

  .apply-button,
  .discard-button {
    min-height: 30px;
    justify-content: center;
    gap: 6px;
    padding: 0 11px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 650;
  }

  .discard-button {
    border: 1px solid var(--border);
    background: var(--bg-primary);
    color: var(--text-secondary);
  }

  .apply-button {
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent);
  }

  .discard-button:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .apply-button:hover {
    background: color-mix(in srgb, var(--accent) 24%, transparent);
  }

  .repair-diff {
    min-height: 0;
    flex: 1;
  }
</style>
