import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultAppSettings,
  defaultAppearanceSettings,
  defaultModelSettings,
  fetchAppSettings,
  normalizeModelSettings,
  saveAppearanceSettings,
  saveModelSettings,
} from '../lib/settings-api';
import type { AppSettings, AppearanceSettings, ModelSettings, ToastState } from '../types';

type ToastTone = ToastState['tone'];
type ShowToast = (message: string, tone?: ToastTone) => void;
export type AppearanceSettingsUpdate =
  | Partial<AppearanceSettings>
  | ((current: AppearanceSettings) => Partial<AppearanceSettings> | AppearanceSettings);
export type ModelSettingsUpdate =
  | Partial<ModelSettings>
  | ((current: ModelSettings) => Partial<ModelSettings> | ModelSettings);

type AppearanceSaveQueueOptions = {
  save: (appearance: AppearanceSettings) => Promise<AppSettings>;
  onSaved: (settings: AppSettings) => void;
  onError: (error: unknown) => void;
};

type AppearanceSaveQueue = {
  enqueue: (appearance: AppearanceSettings) => void;
  dispose: () => void;
};

export { defaultAppSettings, defaultAppearanceSettings };
export { defaultModelSettings };

export function useAppSettings(showToast?: ShowToast) {
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings);
  const [loading, setLoading] = useState(true);
  const latestSettingsRef = useRef(defaultAppSettings);
  const requestVersionRef = useRef(0);
  const toastRef = useRef(showToast);
  const saveQueueRef = useRef<AppearanceSaveQueue | null>(null);

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

  const getSaveQueue = useCallback(() => {
    if (!saveQueueRef.current) {
      saveQueueRef.current = createLatestAppearanceSaveQueue({
        save: saveAppearanceSettings,
        onSaved: (savedSettings) => {
          applySettings(savedSettings);
        },
        onError: (error) => {
          toastRef.current?.(error instanceof Error ? error.message : '保存外观设置失败', 'error');
        },
      });
    }

    return saveQueueRef.current;
  }, [applySettings]);

  useEffect(() => {
    return () => {
      saveQueueRef.current?.dispose();
      saveQueueRef.current = null;
    };
  }, []);

  const updateAppearance = useCallback(
    (update: AppearanceSettingsUpdate) => {
      ++requestVersionRef.current;
      const currentSettings = latestSettingsRef.current;
      const nextAppearance = resolveAppearanceUpdate(currentSettings.appearance, update);
      const optimisticSettings = mergeAppSettings({
        ...currentSettings,
        appearance: nextAppearance,
      });

      applySettings(optimisticSettings);
      setLoading(false);
      getSaveQueue().enqueue(optimisticSettings.appearance);
    },
    [applySettings, getSaveQueue],
  );

  const updateModels = useCallback(
    async (update: ModelSettingsUpdate) => {
      ++requestVersionRef.current;
      const currentSettings = latestSettingsRef.current;
      const nextModels = resolveModelSettingsUpdate(currentSettings.models, update);
      const optimisticSettings = mergeAppSettings({
        ...currentSettings,
        models: nextModels,
      });

      applySettings(optimisticSettings);
      setLoading(false);

      try {
        const savedSettings = await saveModelSettings(optimisticSettings.models);
        applySettings(savedSettings);
      } catch (error) {
        toastRef.current?.(error instanceof Error ? error.message : '保存模型设置失败', 'error');
      }
    },
    [applySettings],
  );

  return {
    settings,
    appearance: settings.appearance,
    models: settings.models,
    loading,
    updateAppearance,
    updateModels,
  };
}

export function resolveAppearanceUpdate(
  current: AppearanceSettings,
  update: AppearanceSettingsUpdate,
): AppearanceSettings {
  const patch = typeof update === 'function' ? update(current) : update;
  return mergeAppearanceSettings({
    ...current,
    ...patch,
  });
}

export function resolveModelSettingsUpdate(
  current: ModelSettings,
  update: ModelSettingsUpdate,
): ModelSettings {
  const patch = typeof update === 'function' ? update(current) : update;
  return normalizeModelSettings({
    ...current,
    ...patch,
  });
}

export function createLatestAppearanceSaveQueue(options: AppearanceSaveQueueOptions): AppearanceSaveQueue {
  let pendingAppearance: AppearanceSettings | null = null;
  let saveInFlight = false;
  let disposed = false;

  async function flush() {
    if (saveInFlight || disposed) {
      return;
    }

    while (pendingAppearance && !disposed) {
      const appearance = pendingAppearance;
      pendingAppearance = null;
      saveInFlight = true;

      try {
        const savedSettings = await options.save(appearance);
        if (!pendingAppearance && !disposed) {
          options.onSaved(savedSettings);
        }
      } catch (error) {
        if (!pendingAppearance && !disposed) {
          options.onError(error);
        }
      } finally {
        saveInFlight = false;
      }
    }
  }

  return {
    enqueue: (appearance) => {
      pendingAppearance = appearance;
      void flush();
    },
    dispose: () => {
      disposed = true;
      pendingAppearance = null;
    },
  };
}

function mergeAppSettings(settings: Partial<AppSettings> | null | undefined): AppSettings {
  return {
    appearance: mergeAppearanceSettings(settings?.appearance),
    models: normalizeModelSettings(settings?.models),
  };
}

function mergeAppearanceSettings(appearance: Partial<AppearanceSettings> | null | undefined): AppearanceSettings {
  return {
    ...defaultAppearanceSettings,
    ...appearance,
  };
}
