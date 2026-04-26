import { useCallback, useEffect, useState } from 'react';
import { fetchAppSettings, saveAppearanceSettings } from '../lib/settings-api';
import type { AppSettings, AppearanceSettings, ToastState } from '../types';

type ToastTone = ToastState['tone'];
type ShowToast = (message: string, tone?: ToastTone) => void;
type AppearanceSettingsPatch = Partial<AppearanceSettings>;

export const defaultAppearanceSettings: AppearanceSettings = {
  themeMode: 'system',
  density: 'comfortable',
  uiFontSize: 13,
  codeFontSize: 12,
  sidebarWidth: 'default',
};

export const defaultAppSettings: AppSettings = {
  appearance: defaultAppearanceSettings,
};

export function useAppSettings(showToast?: ShowToast) {
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      setLoading(true);
      try {
        const nextSettings = await fetchAppSettings();
        if (!cancelled) {
          setSettings(mergeAppSettings(nextSettings));
        }
      } catch (error) {
        if (!cancelled) {
          showToast?.(error instanceof Error ? error.message : '读取设置失败', 'error');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [showToast]);

  const updateAppearance = useCallback(
    async (nextAppearance: AppearanceSettingsPatch) => {
      const previousSettings = settings;
      const optimisticSettings = mergeAppSettings({
        ...settings,
        appearance: {
          ...settings.appearance,
          ...nextAppearance,
        },
      });

      setSettings(optimisticSettings);

      try {
        const savedSettings = await saveAppearanceSettings(optimisticSettings.appearance);
        setSettings(mergeAppSettings(savedSettings));
      } catch (error) {
        setSettings(previousSettings);
        showToast?.(error instanceof Error ? error.message : '保存外观设置失败', 'error');
      }
    },
    [settings, showToast],
  );

  return {
    settings,
    appearance: settings.appearance,
    loading,
    updateAppearance,
  };
}

function mergeAppSettings(settings: Partial<AppSettings> | null | undefined): AppSettings {
  return {
    appearance: mergeAppearanceSettings(settings?.appearance),
  };
}

function mergeAppearanceSettings(appearance: Partial<AppearanceSettings> | null | undefined): AppearanceSettings {
  return {
    ...defaultAppearanceSettings,
    ...appearance,
  };
}
