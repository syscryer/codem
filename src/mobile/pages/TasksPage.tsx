import { useState } from 'react';
import { Plus } from 'lucide-react';
import { AgentProviderIcon } from '../../components/AgentProviderIcon';
import { mobileTaskChannelLabel } from '../lib/mobile-task-channel';
import type { MobileBootstrap, MobileChannelBootstrap, MobileTask, MobileTaskPhase } from '../types';

export function TasksPage({ data, mode = 'tasks', onOpen, onNew }: { data: MobileBootstrap | null; mode?: 'tasks' | 'notifications'; onOpen: (id: string) => void; onNew?: () => void }) {
  const [visibleCount, setVisibleCount] = useState(50);
  const tasks = data?.tasks ?? [];
  const active = tasks.filter((task) => ['running', 'starting', 'waiting'].includes(task.phase));
  const recent = tasks.filter((task) => !active.includes(task));
  const notifications = tasks.filter((task) => task.pendingActions.length > 0 || task.phase === 'error');
  if (mode === 'notifications') return <TaskGroup title="需要处理" tasks={notifications.slice(0, visibleCount)} channels={data?.channels} onOpen={onOpen} empty="目前没有待处理通知" />;
  return <>
    <section className="prototype-summary" aria-label="任务概览"><Summary value={active.filter((task) => task.phase !== 'waiting').length} label="运行中" tone="blue" /><Summary value={active.filter((task) => task.phase === 'waiting').length} label="待处理" tone="orange" /><Summary value={recent.filter((task) => task.phase === 'done').length} label="最近完成" tone="green" /></section>
    <TaskGroup title="正在进行" tasks={active} channels={data?.channels} onOpen={onOpen} empty="当前没有运行中的任务" />
    <TaskGroup title="最近任务" tasks={recent.slice(0, visibleCount)} channels={data?.channels} onOpen={onOpen} empty="创建任务后会显示在这里" />
    {recent.length > visibleCount ? <button className="mobile-load-more" onClick={() => setVisibleCount((value) => value + 50)}>显示更多任务</button> : null}
    {onNew ? <button type="button" className="mobile-new-task-fab" onClick={onNew} aria-label="新建任务"><Plus size={24} /></button> : null}
  </>;
}

function Summary({ value, label, tone }: { value: number; label: string; tone: string }) { return <div className="prototype-summary-item"><strong className={`tone-${tone}`}>{value}</strong><span>{label}</span></div>; }
function TaskGroup({ title, tasks, channels, onOpen, empty }: { title: string; tasks: MobileTask[]; channels?: MobileChannelBootstrap; onOpen: (id: string) => void; empty: string }) { return <section className="prototype-section"><div className="mobile-task-group-heading"><h2>{title}</h2></div><div className="prototype-grouped-list">{tasks.length ? tasks.map((task) => <TaskRow key={task.threadId} task={task} channels={channels} onOpen={onOpen} />) : <div className="mobile-empty-row">{empty}</div>}</div></section>; }
function TaskRow({ task, channels, onOpen }: { task: MobileTask; channels?: MobileChannelBootstrap; onOpen: (id: string) => void }) {
  const summary = task.pendingActions[0]?.title || task.latestActivity;
  const channelLabel = mobileTaskChannelLabel(task, channels);
  return <button type="button" className="prototype-task-row" onClick={() => onOpen(task.threadId)}><span className="prototype-task-icon mobile-task-provider-icon"><AgentProviderIcon providerId={task.providerId} size={19} /><i className={`mobile-task-status-dot status-${task.phase}`} aria-hidden="true" /></span><span className="prototype-task-copy"><span className="prototype-task-topline"><strong>{task.title}</strong><time>{relativeTime(task.updatedAt)}</time></span>{summary ? <span className="prototype-task-summary">{summary}</span> : null}<span className="prototype-task-meta"><span className={`status-${task.phase}`}>{phaseLabel(task.phase)}</span><span>{task.projectName}</span>{channelLabel ? <span>{channelLabel}</span> : null}<span>{task.providerLabel}</span></span></span><span className="prototype-row-chevron">›</span></button>;
}
function phaseLabel(phase: MobileTaskPhase) { return ({ running: '正在运行', starting: '正在启动', waiting: '等待处理', done: '已完成', error: '运行失败', stopped: '已停止', idle: '可继续' } as Record<MobileTaskPhase, string>)[phase]; }
function relativeTime(value: string) { const time = new Date(value).getTime(); if (!Number.isFinite(time)) return ''; const diff = Math.max(0, Date.now() - time); if (diff < 60_000) return '刚刚'; if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`; if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`; return `${Math.floor(diff / 86_400_000)} 天前`; }
