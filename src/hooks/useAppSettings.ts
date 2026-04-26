import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultAppSettings,
  defaultAppearanceSettings,
  fetchAppSettings,
  saveAppearanceSettings,
} from '../lib/settings-api';
import type { AppSettings, AppearanceSettings, ToastState } from '../types';

type ToastTone = ToastState['tone'];
type ShowToast = (message: string, tone?: ToastTone) => void;

export { defaultAppSettings, defaultAppearanceSettings };

export function useAppSettings(showToast?: ShowToast) {
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings);
  const [loading, setLoading] = useState(true);
  const latestSettingsRef = useRef(defaultAppSettings);
  const requestVersionRef = useRef(0);
  const toastRef = useRef(showToast);

  useEffect(() => {
    toastRef.current = showToast;
  }, [showToast]);

  const applySettings = useCallback((nextSettings: AppSettings) => {
    const mergedSettings = mergeAppSettings(nextSettings);
    latestSettingsRef.current = mergedSettings;
    setSettings(mergedSettings);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requestVersion = ++requestVersionRef.current;

    async function loadSettings() {
      setLoading(true);
      try {
        const nextSettings = await fetchAppSettings();
        if (!cancelled && requestVersion === requestVersionRef.current) {
          applySettings(nextSettings);
        }
      } catch (error) {
        if (!cancelled && requestVersion === requestVersionRef.current) {
          toastRef.current?.(error instanceof Error ? error.message : '读取设置失败', 'error');
        }
      } finally {
        if (!cancelled && requestVersion === requestVersionRef.current) {
          setLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [applySettings]);

  const updateAppearance = useCallback(
    async (nextAppearance: AppearanceSettings) => {
      const requestVersion = ++requestVersionRef.current;
      const previousSettings = latestSettingsRef.current;
      const optimisticSettings = mergeAppSettings({
        ...previousSettings,
        appearance: nextAppearance,
      });

      applySettings(optimisticSettings);
      setLoading(false);

      try {
        const savedSettings = await saveAppearanceSettings(optimisticSettings.appearance);
        if (requestVersion === requestVersionRef.current) {
          applySettings(savedSettings);
        }
      } catch (error) {
        if (requestVersion === requestVersionRef.current) {
          applySettings(previousSettings);
          toastRef.current?.(error instanceof Error ? error.message : '保存外观设置失败', 'error');
        }
      }
    },
    [applySettings],
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
