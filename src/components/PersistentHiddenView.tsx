import { cloneElement, memo, type ReactElement } from 'react';

type HideableElement = ReactElement<{ hidden?: boolean }>;

type PersistentHiddenViewProps = {
  hidden: boolean;
  children: HideableElement;
};

export function shouldFreezePersistentHiddenView(previousHidden: boolean, nextHidden: boolean) {
  return previousHidden && nextHidden;
}

function PersistentHiddenViewComponent({ hidden, children }: PersistentHiddenViewProps) {
  return cloneElement(children, { hidden });
}

export const PersistentHiddenView = memo(
  PersistentHiddenViewComponent,
  (previous, next) => shouldFreezePersistentHiddenView(previous.hidden, next.hidden),
);
