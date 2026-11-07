import { DEFAULT_SETTINGS } from '../../../packages/core/src/config.js';

// Settings migration: v0.1's model field became engine
export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
  delete s.model;
  return s;
}
export async function saveSettings(s) {
  await chrome.storage.local.set({ settings: s });
}
