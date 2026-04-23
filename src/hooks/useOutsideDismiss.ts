import { useEffect, type RefObject } from 'react';

type OutsideRefEntry = {
  ref: RefObject<HTMLElement | null>;
  onDismiss: () => void;
};

type OutsideSelectorEntry = {
  selector: string;
  onDismiss: () => void;
};

type UseOutsideDismissArgs = {
  refs?: OutsideRefEntry[];
  selectors?: OutsideSelectorEntry[];
};

export function useOutsideDismiss({ refs = [], selectors = [] }: UseOutsideDismissArgs) {
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      for (const entry of refs) {
        if (!entry.ref.current?.contains(target)) {
          entry.onDismiss();
        }
      }

      for (const entry of selectors) {
        const element = document.querySelector(entry.selector);
        if (element && !element.contains(target)) {
          entry.onDismiss();
        }
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [refs, selectors]);
}
