import { ChevronLeft, Plus } from 'lucide-react';
import type { ReactNode } from 'react';

export function MobileHeader({ title, subtitle, back, action }: { title: string; subtitle?: string; back?: () => void; action?: ReactNode }) {
  return <header className="mobile-header">{back && <button className="icon-button glass" onClick={back} aria-label="返回"><ChevronLeft/></button>}<div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action && <div className="mobile-header-action">{action}</div>}</header>;
}

export function NewButton({ onClick }: { onClick: () => void }) {
  return <button className="new-task-button glass-strong" onClick={onClick} aria-label="新建任务"><Plus size={21}/><span>新建任务</span></button>;
}
