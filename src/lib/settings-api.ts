import type { AppSettings, AppearanceSettings } from '../types';

export async function fetchAppSettings(): Promise<AppSettings> {
  const response = await fetch('/api/settings');
  if (!response.ok) {
    throw new Error('读取设置失败');
  }
  return (await response.json()) as AppSettings;
}

export async function saveAppearanceSettings(appearance: AppearanceSettings): Promise<AppSettings> {
  const response = await fetch('/api/settings/appearance', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(appearance),
  });
  if (!response.ok) {
    throw new Error('保存外观设置失败');
  }
  return (await response.json()) as AppSettings;
}
