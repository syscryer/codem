import { isTauriRuntime } from './window-material';
import type { ThreadActivityNotice } from './thread-activity-notices';

export type ThreadSystemNotificationPayload = {
  title: string;
  body: string;
};

export type NativeNotificationApi = {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<NotificationPermission>;
  sendNotification: (payload: ThreadSystemNotificationPayload) => void;
  sendCodeMNotification?: (payload: ThreadSystemNotificationPayload) => Promise<void>;
};

type ThreadSystemNotificationOptions = {
  isTauriRuntime?: () => boolean;
  loadNativeNotificationApi?: () => Promise<NativeNotificationApi>;
  webNotification?: typeof Notification;
};

export type ThreadSystemNotificationResult =
  | 'sent'
  | 'permission-denied'
  | 'unsupported'
  | 'failed';

export function buildThreadSystemNotificationPayload(
  notice: ThreadActivityNotice,
): ThreadSystemNotificationPayload {
  if (notice.kind === 'failed') {
    return {
      title: 'CodeM 任务失败',
      body: `“${notice.title}”运行失败`,
    };
  }

  if (notice.kind === 'approval') {
    return {
      title: 'CodeM 等待确认',
      body: `“${notice.title}”需要你处理`,
    };
  }

  return {
    title: 'CodeM 任务完成',
    body: `“${notice.title}”已完成`,
  };
}

export async function showThreadSystemNotification(
  notice: ThreadActivityNotice,
  options: ThreadSystemNotificationOptions = {},
): Promise<ThreadSystemNotificationResult> {
  const payload = buildThreadSystemNotificationPayload(notice);
  const runtimeCheck = options.isTauriRuntime ?? isTauriRuntime;

  if (runtimeCheck()) {
    return showNativeThreadSystemNotification(
      payload,
      options.loadNativeNotificationApi ?? loadNativeNotificationApi,
    );
  }

  return showWebThreadSystemNotification(payload, options.webNotification);
}

async function showNativeThreadSystemNotification(
  payload: ThreadSystemNotificationPayload,
  loadNativeNotificationApi: () => Promise<NativeNotificationApi>,
): Promise<ThreadSystemNotificationResult> {
  try {
    const notification = await loadNativeNotificationApi();
    let permissionGranted = await notification.isPermissionGranted();
    if (!permissionGranted) {
      permissionGranted = (await notification.requestPermission()) === 'granted';
    }
    if (!permissionGranted) {
      return 'permission-denied';
    }

    if (notification.sendCodeMNotification) {
      await notification.sendCodeMNotification(payload);
    } else {
      notification.sendNotification(payload);
    }
    return 'sent';
  } catch {
    return 'failed';
  }
}

async function loadNativeNotificationApi(): Promise<NativeNotificationApi> {
  const [notification, tauriCore] = await Promise.all([
    import('@tauri-apps/plugin-notification'),
    import('@tauri-apps/api/core'),
  ]);
  return {
    isPermissionGranted: notification.isPermissionGranted,
    requestPermission: notification.requestPermission,
    sendNotification: notification.sendNotification,
    sendCodeMNotification: (payload) => tauriCore.invoke('show_thread_notification', { request: payload }),
  };
}

async function showWebThreadSystemNotification(
  payload: ThreadSystemNotificationPayload,
  injectedNotification?: typeof Notification,
): Promise<ThreadSystemNotificationResult> {
  const NotificationConstructor =
    injectedNotification ??
    (typeof window !== 'undefined' && 'Notification' in window ? window.Notification : undefined);
  if (!NotificationConstructor) {
    return 'unsupported';
  }

  let permission = NotificationConstructor.permission;
  if (permission === 'default') {
    permission = await NotificationConstructor.requestPermission();
  }
  if (permission !== 'granted') {
    return 'permission-denied';
  }

  new NotificationConstructor(payload.title, { body: payload.body });
  return 'sent';
}
