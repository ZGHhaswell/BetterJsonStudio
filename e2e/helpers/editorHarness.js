import { expect } from '@playwright/test';

const TAB_STATE_KEY = 'jsonstudio_tabs_state';
const SETTINGS_KEY = 'app-settings';

function emptyStats() {
  return {
    valid: false,
    key_count: 0,
    depth: 0,
    byte_size: 0,
    format_type: '',
    error_info: null,
  };
}

export async function installTauriEditorHarness(page, content = '', options = {}) {
  await page.addInitScript(({
    tabStateKey,
    settingsKey,
    initialContent,
    stats,
    showTreeView,
    isTauri,
    desktopPlatform,
    fileName,
    filePath,
    savedSettings,
    agentScenario,
  }) => {
    localStorage.setItem(tabStateKey, JSON.stringify({
      tabs: [{
        id: 'editor-test-tab',
        filePath,
        fileName,
        content: initialContent,
        isModified: false,
        stats,
        isPinned: false,
        contentVersion: initialContent ? 1 : 0,
      }],
      activeTabId: 'editor-test-tab',
    }));
    localStorage.setItem(settingsKey, JSON.stringify({
      language: 'en',
      showTreeView,
      showFolderView: false,
      autoSave: false,
      isDarkMode: false,
      ...savedSettings,
    }));

    window.isTauri = isTauri;
    window.__JSON_STUDIO_OPENED_URLS__ = [];
    window.__JSON_STUDIO_WINDOW_COMMANDS__ = [];
    window.__SMART_REPAIR_CALLS__ = [];

    let callbackId = 0;
    const callbacks = new Map();
    window.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { label: 'main' },
      },
      plugins: {
        path: { sep: '/', delimiter: ':' },
      },
      transformCallback(callback) {
        const id = ++callbackId;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id) {
        callbacks.delete(id);
      },
      runCallback(id, payload) {
        callbacks.get(id)?.(payload);
      },
      convertFileSrc(path) {
        return path;
      },
      async invoke(command, args) {
        if (command === 'detect_agent_cli') {
          window.__SMART_REPAIR_CALLS__.push({ command, args });
          return agentScenario.detectStatus;
        }
        if (command === 'select_agent_cli') {
          window.__SMART_REPAIR_CALLS__.push({ command, args });
          return agentScenario.selectedPath;
        }
        if (command === 'repair_json_with_agent') {
          window.__SMART_REPAIR_CALLS__.push({ command, args });
          if (agentScenario.delayMs) {
            await new Promise(resolve => setTimeout(resolve, agentScenario.delayMs));
          }
          if (agentScenario.error) throw agentScenario.error;
          return { repairedJson: agentScenario.repairedJson };
        }
        if (command === 'cancel_agent_task') {
          window.__SMART_REPAIR_CALLS__.push({ command, args });
          return true;
        }
        if (command === 'desktop_platform') return desktopPlatform;
        if (command.startsWith('plugin:window|')) {
          window.__JSON_STUDIO_WINDOW_COMMANDS__.push(command);
          if (command === 'plugin:window|is_focused') return true;
          if (command === 'plugin:window|is_fullscreen' || command === 'plugin:window|is_maximized') return false;
        }
        if (command === 'get_pending_files') return [];
        if (command === 'plugin:event|listen') return ++callbackId;
        if (command === 'plugin:opener|open_url') {
          window.__JSON_STUDIO_OPENED_URLS__.push(args.url);
          return null;
        }
        return null;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener() {},
    };
  }, {
    tabStateKey: TAB_STATE_KEY,
    settingsKey: SETTINGS_KEY,
    initialContent: content,
    stats: emptyStats(),
    showTreeView: options.showTreeView ?? false,
    isTauri: options.isTauri ?? false,
    desktopPlatform: options.desktopPlatform ?? 'macos',
    fileName: options.fileName ?? 'Editor Test',
    filePath: options.filePath ?? null,
    savedSettings: options.settings ?? {},
    agentScenario: {
      detectStatus: options.agentScenario?.detectStatus ?? {
        available: false,
        path: null,
        version: null,
        source: null,
        error: { code: 'cli_not_found' },
      },
      selectedPath: options.agentScenario?.selectedPath ?? null,
      repairedJson: options.agentScenario?.repairedJson ?? '{}',
      delayMs: options.agentScenario?.delayMs ?? 0,
      error: options.agentScenario?.error ?? null,
    },
  });
}

export async function openEmptyEditor(page) {
  await installTauriEditorHarness(page);
  await page.goto('/');

  const editorSurface = page.locator('[data-testid="json-editor"] .view-lines');
  await expect(editorSurface).toBeVisible();
  await editorSurface.click();
  return editorSurface;
}

export async function pasteIntoEditor(page, value) {
  await page.evaluate((content) => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', content);
    document.activeElement?.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: clipboard,
    }));
  }, value);
}

export async function getOpenedExternalUrls(page) {
  return page.evaluate(() => window.__JSON_STUDIO_OPENED_URLS__ ?? []);
}
