import { useState } from 'react';
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDot,
  FolderKanban,
  ListTodo,
  MoreHorizontal,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
} from 'lucide-react';
import { PrototypeConversation } from './PrototypeConversation';
import { prototypeTasks, type PrototypeTask, type PrototypeTaskStatus } from './prototype-data';
import { SettingsPage } from '../pages/SettingsPage';
import '../mobile.css';

type PrototypeTab = 'tasks' | 'projects' | 'notifications' | 'settings';
type PrototypeRoute = { name: 'home'; tab: PrototypeTab } | { name: 'detail'; task: PrototypeTask };

const statusIcons: Record<PrototypeTaskStatus, typeof CircleDot> = {
  running: Sparkles,
  waiting: ShieldCheck,
  done: CircleCheck,
  error: Square,
};

export default function MobilePrototypeApp() {
  const [route, setRoute] = useState<PrototypeRoute>({ name: 'home', tab: 'tasks' });

  if (route.name === 'detail') {
    return <PrototypeTaskDetail task={route.task} onBack={() => setRoute({ name: 'home', tab: 'tasks' })} />;
  }

  return (
    <div className={`mobile-prototype mobile-page-${route.tab} codex-desktop`}>
      <div className="prototype-safe-shell">
        <header className="prototype-home-header">
          <div className="prototype-device-line">
            <span className="prototype-online-dot" />
            <span>MNL-PC 在线</span>
          </div>
          <div className="prototype-title-row">
            <h1>{tabTitle(route.tab)}</h1>
            {route.tab === 'tasks' ? (
              <button type="button" className="prototype-primary-icon" aria-label="新建任务">
                <Plus size={22} />
              </button>
            ) : null}
          </div>
        </header>

        <main className="prototype-home-content">
          {route.tab === 'tasks' ? <PrototypeTasks onOpen={(task) => setRoute({ name: 'detail', task })} /> : null}
          {route.tab === 'projects' ? <PrototypeProjects /> : null}
          {route.tab === 'notifications' ? <PrototypeNotifications onOpen={(task) => setRoute({ name: 'detail', task })} /> : null}
          {route.tab === 'settings' ? <SettingsPage data={null} /> : null}
        </main>

        <PrototypeTabBar active={route.tab} onChange={(tab) => setRoute({ name: 'home', tab })} />
      </div>
    </div>
  );
}

function PrototypeTasks({ onOpen }: { onOpen: (task: PrototypeTask) => void }) {
  const running = prototypeTasks.filter((task) => task.status === 'running' || task.status === 'waiting');
  const recent = prototypeTasks.filter((task) => task.status === 'done' || task.status === 'error');

  return (
    <>
      <section className="prototype-summary" aria-label="任务概览">
        <SummaryItem value="1" label="运行中" tone="blue" />
        <SummaryItem value="1" label="待处理" tone="orange" />
        <SummaryItem value="2" label="最近完成" tone="green" />
      </section>
      <TaskGroup title="正在进行" tasks={running} onOpen={onOpen} />
      <TaskGroup title="最近任务" tasks={recent} onOpen={onOpen} />
    </>
  );
}

function SummaryItem({ value, label, tone }: { value: string; label: string; tone: string }) {
  return (
    <div className="prototype-summary-item">
      <strong className={`tone-${tone}`}>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function TaskGroup({ title, tasks, onOpen }: { title: string; tasks: PrototypeTask[]; onOpen: (task: PrototypeTask) => void }) {
  return (
    <section className="prototype-section">
      <h2>{title}</h2>
      <div className="prototype-grouped-list">
        {tasks.map((task) => <PrototypeTaskRow key={task.id} task={task} onOpen={onOpen} />)}
      </div>
    </section>
  );
}

function PrototypeTaskRow({ task, onOpen }: { task: PrototypeTask; onOpen: (task: PrototypeTask) => void }) {
  const Icon = statusIcons[task.status];
  return (
    <button type="button" className="prototype-task-row" onClick={() => onOpen(task)}>
      <span className={`prototype-task-icon status-${task.status}`}><Icon size={18} /></span>
      <span className="prototype-task-copy">
        <span className="prototype-task-topline">
          <strong>{task.title}</strong>
          <time>{task.updatedAt}</time>
        </span>
        <span className="prototype-task-summary">{task.summary}</span>
        <span className="prototype-task-meta">
          <span className={`status-${task.status}`}>{task.statusLabel}</span>
          <span>{task.project}</span>
          <span>{task.provider}</span>
        </span>
      </span>
      <ChevronRight className="prototype-row-chevron" size={17} />
    </button>
  );
}

function PrototypeProjects() {
  return (
    <section className="prototype-section prototype-first-section">
      <h2>本地项目</h2>
      <div className="prototype-grouped-list">
        <div className="prototype-project-row">
          <span className="prototype-task-icon status-running"><FolderKanban size={18} /></span>
          <span><strong>CodeM</strong><small>D:\\ai_proj\\codem · main · 有改动</small></span>
          <ChevronRight size={17} />
        </div>
        <div className="prototype-project-row">
          <span className="prototype-task-icon neutral"><FolderKanban size={18} /></span>
          <span><strong>MindFS Research</strong><small>D:\\Projects\\mindfs · main</small></span>
          <ChevronRight size={17} />
        </div>
      </div>
    </section>
  );
}

function PrototypeNotifications({ onOpen }: { onOpen: (task: PrototypeTask) => void }) {
  return (
    <section className="prototype-section prototype-first-section">
      <h2>需要处理</h2>
      <div className="prototype-grouped-list">
        <PrototypeTaskRow task={prototypeTasks[1]} onOpen={onOpen} />
        <PrototypeTaskRow task={prototypeTasks[3]} onOpen={onOpen} />
      </div>
    </section>
  );
}

function PrototypeTaskDetail({ task, onBack }: { task: PrototypeTask; onBack: () => void }) {
  return (
    <div className="mobile-prototype prototype-detail codex-desktop">
      <header className="prototype-detail-header">
        <button type="button" className="prototype-back-button" onClick={onBack} aria-label="返回任务列表">
          <ChevronLeft size={24} />
          <span>任务</span>
        </button>
        <div className="prototype-detail-title">
          <strong>{task.project}</strong>
          <span><i className={`status-${task.status}`} />{task.statusLabel} · {task.provider}</span>
        </div>
        <button type="button" className="prototype-icon-button" aria-label="更多操作">
          <MoreHorizontal size={21} />
        </button>
      </header>
      <main className="prototype-detail-scroll">
        <div className="prototype-thread-heading">
          <h1>{task.title}</h1>
          <p>移动端只调整外壳，对话内容继续使用 CodeM 桌面版组件。</p>
        </div>
        <PrototypeConversation />
      </main>
    </div>
  );
}

function PrototypeTabBar({ active, onChange }: { active: PrototypeTab; onChange: (tab: PrototypeTab) => void }) {
  const tabs = [
    ['tasks', ListTodo, '任务'],
    ['projects', FolderKanban, '项目'],
    ['notifications', Bell, '通知'],
    ['settings', Settings, '设置'],
  ] as const;
  return (
    <nav className="prototype-tab-bar" aria-label="移动端主导航">
      {tabs.map(([tab, Icon, label]) => (
        <button key={tab} type="button" className={active === tab ? 'active' : ''} onClick={() => onChange(tab)}>
          <Icon size={21} />
          <span>{label}</span>
          {tab === 'notifications' ? <i>2</i> : null}
        </button>
      ))}
    </nav>
  );
}

function tabTitle(tab: PrototypeTab) {
  if (tab === 'projects') return '项目';
  if (tab === 'notifications') return '通知';
  if (tab === 'settings') return '设置';
  return '任务';
}
