import { DEFAULT_SETTINGS } from '../../../packages/core/src/languages.js';

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}
export async function saveSettings(s) {
  await chrome.storage.local.set({ settings: s });
}
