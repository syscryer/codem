import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildThreadSystemNotificationPayload,
  showThreadSystemNotification,
  type NativeNotificationApi,
} from './thread-system-notifications.js';
import type { ThreadActivityNotice } from './thread-activity-notices.js';

function notice(kind: ThreadActivityNotice['kind']): ThreadActivityNotice {
  return {
    threadId: 'thread-1',
    kind,
    title: '后台会话',
    key: `${kind}:thread-1:turn-1`,
    updatedAtMs: 100,
  };
}

test('buildThreadSystemNotificationPayload formats completed, failed, and approval notices', () => {
  assert.deepEqual(buildThreadSystemNotificationPayload(notice('completed')), {
    title: 'CodeM 任务完成',
    body: '“后台会话”已完成',
  });
  assert.deepEqual(buildThreadSystemNotificationPayload(notice('failed')), {
    title: 'CodeM 任务失败',
    body: '“后台会话”运行失败',
  });
  assert.deepEqual(buildThreadSystemNotificationPayload(notice('approval')), {
    title: 'CodeM 等待确认',
    body: '“后台会话”需要你处理',
  });
});

test('showThreadSystemNotification sends through native Tauri notifications after permission is granted', async () => {
  const sent: Array<{ title: string; body: string }> = [];
  const nativeApi: NativeNotificationApi = {
    isPermissionGranted: async () => false,
    requestPermission: async () => 'granted',
    sendNotification: (payload) => {
      sent.push(payload);
    },
  };

  const result = await showThreadSystemNotification(notice('completed'), {
    isTauriRuntime: () => true,
    loadNativeNotificationApi: async () => nativeApi,
  });

  assert.equal(result, 'sent');
  assert.deepEqual(sent, [
    {
      title: 'CodeM 任务完成',
      body: '“后台会话”已完成',
    },
  ]);
});

test('showThreadSystemNotification prefers the CodeM desktop command when available', async () => {
  const sent: Array<{ title: string; body: string }> = [];
  const nativeApi: NativeNotificationApi = {
    isPermissionGranted: async () => true,
    requestPermission: async () => 'granted',
    sendNotification: () => {
      throw new Error('plugin fallback should not be used');
    },
    sendCodeMNotification: async (payload) => {
      sent.push(payload);
    },
  };

  const result = await showThreadSystemNotification(notice('completed'), {
    isTauriRuntime: () => true,
    loadNativeNotificationApi: async () => nativeApi,
  });

  assert.equal(result, 'sent');
  assert.deepEqual(sent, [
    {
      title: 'CodeM 任务完成',
      body: '“后台会话”已完成',
    },
  ]);
});

test('showThreadSystemNotification passes the desktop command payload as a Tauri command argument', async () => {
  const invoked: Array<{ command: string; args: unknown }> = [];
  const result = await showThreadSystemNotification(notice('failed'), {
    isTauriRuntime: () => true,
    loadNativeNotificationApi: async () => ({
      isPermissionGranted: async () => true,
      requestPermission: async () => 'granted',
      sendNotification: () => {
        throw new Error('plugin fallback should not be used');
      },
      sendCodeMNotification: async (payload) => {
        invoked.push({
          command: 'show_thread_notification',
          args: { request: payload },
        });
      },
    }),
  });

  assert.equal(result, 'sent');
  assert.deepEqual(invoked, [
    {
      command: 'show_thread_notification',
      args: {
        request: {
          title: 'CodeM 任务失败',
          body: '“后台会话”运行失败',
        },
      },
    },
  ]);
});

test('showThreadSystemNotification skips native notifications when permission is denied', async () => {
  let sendCount = 0;
  const nativeApi: NativeNotificationApi = {
    isPermissionGranted: async () => false,
    requestPermission: async () => 'denied',
    sendNotification: () => {
      sendCount += 1;
    },
  };

  const result = await showThreadSystemNotification(notice('failed'), {
    isTauriRuntime: () => true,
    loadNativeNotificationApi: async () => nativeApi,
  });

  assert.equal(result, 'permission-denied');
  assert.equal(sendCount, 0);
});

test('showThreadSystemNotification falls back to Web Notification outside Tauri', async () => {
  const sent: Array<{ title: string; body?: string }> = [];
  class TestNotification {
    static permission: NotificationPermission = 'granted';

    constructor(title: string, options?: NotificationOptions) {
      sent.push({
        title,
        body: options?.body,
      });
    }
  }

  const result = await showThreadSystemNotification(notice('approval'), {
    isTauriRuntime: () => false,
    webNotification: TestNotification as unknown as typeof Notification,
  });

  assert.equal(result, 'sent');
  assert.deepEqual(sent, [
    {
      title: 'CodeM 等待确认',
      body: '“后台会话”需要你处理',
    },
  ]);
});
