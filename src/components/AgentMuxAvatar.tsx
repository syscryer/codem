import { AgentProviderIcon } from './AgentProviderIcon';

export const AGENT_MUX_AVATAR_OPTIONS = [
  ['rabbit', '兔子'], ['fox', '狐狸'], ['penguin', '企鹅'], ['turtle', '乌龟'], ['cat', '猫'], ['owl', '猫头鹰'],
  ['shiba', '柴犬'], ['koala', '考拉'], ['panda', '熊猫'], ['otter', '水獭'], ['frog', '青蛙'], ['lion', '狮子'],
  ['hedgehog', '刺猬'], ['bird', '小鸟'], ['raccoon', '浣熊'], ['chick', '小鸡'], ['pig', '小猪'], ['whale', '鲸鱼'],
  ['crocodile', '鳄鱼'], ['chipmunk', '花栗鼠'], ['polar-bear', '北极熊'], ['deer', '小鹿'], ['dolphin', '海豚'], ['hamster', '仓鼠'],
  ['alpaca', '羊驼'], ['crow', '乌鸦'], ['duck', '鸭子'], ['red-panda', '小熊猫'], ['elephant', '大象'], ['bat', '蝙蝠'],
  ['sheep', '绵羊'], ['unicorn', '独角兽'], ['leopard', '花豹'], ['snowy-owl', '雪鸮'], ['bee', '蜜蜂'], ['husky', '哈士奇'],
] as const;

export type AgentMuxAvatarId = typeof AGENT_MUX_AVATAR_OPTIONS[number][0];

const AVATAR_INDEX = new Map<string, number>(AGENT_MUX_AVATAR_OPTIONS.map(([id], index) => [id, index]));

export function AgentMuxAvatar({ avatar, providerId, size, showProviderBadge = true }: {
  avatar?: string | null;
  providerId: string;
  size: 'large' | 'small';
  showProviderBadge?: boolean;
}) {
  const index = avatar ? AVATAR_INDEX.get(avatar) : undefined;
  if (index === undefined) {
    return <span className={`conversation-agent-avatar ${size} is-provider-default`} aria-hidden="true"><AgentProviderIcon providerId={providerId} size={size === 'large' ? 18 : 14} /></span>;
  }
  const column = index % 6;
  const row = Math.floor(index / 6);
  const cropSize = 158;
  const sheetSize = 1254;
  const tileOffset = 42;
  const tilePitch = 201;
  const sheetScale = (sheetSize / cropSize) * 100;
  const left = -((tileOffset + column * tilePitch) / cropSize) * 100;
  const top = -((tileOffset + row * tilePitch) / cropSize) * 100;

  return <span className={`conversation-agent-avatar ${size}`} aria-hidden="true"><img src="/agent-avatar-sheet.png" alt="" draggable="false" style={{ width: `${sheetScale}%`, height: `${sheetScale}%`, left: `${left}%`, top: `${top}%` }} />{showProviderBadge ? <span className="conversation-agent-provider-badge"><AgentProviderIcon providerId={providerId} size={size === 'large' ? 10 : 8} /></span> : null}</span>;
}
