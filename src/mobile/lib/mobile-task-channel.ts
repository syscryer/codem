import type { MobileChannelBootstrap, MobileTask } from '../types.js';

export function mobileTaskChannelLabel(
  task: Pick<MobileTask, 'channelId' | 'providerId'>,
  channels: MobileChannelBootstrap | undefined,
) {
  const channelId = task.channelId?.trim() || 'system';
  if (channelId === 'system') {
    return channels?.systemChannels
      .find((channel) => channel.providerId === task.providerId)
      ?.name.trim() || '系统渠道';
  }
  return channels?.channels
    .find((channel) => channel.id === channelId && channel.providerId === task.providerId)
    ?.name.trim() || '';
}
