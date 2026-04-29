import { useEffect, useRef, type RefObject } from 'react';

type OutsideRefEntry = {
  ref: RefObject<HTMLElement | null>;
  onDismiss: () => void;
};

type OutsideSelectorEntry = {
  selector: string;
  onDismiss: () => void;
  anchorRefs?: RefObject<HTMLElement | null>[];
};

type UseOutsideDismissArgs = {
  refs?: OutsideRefEntry[];
  selectors?: OutsideSelectorEntry[];
};

export function useOutsideDismiss({ refs = [], selectors = [] }: UseOutsideDismissArgs) {
  const latestArgsRef = useRef({ refs, selectors });
  latestArgsRef.current = { refs, selectors };

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      const { refs: currentRefs, selectors: currentSelectors } = latestArgsRef.current;

      for (const entry of currentRefs) {
        if (!entry.ref.current?.contains(target)) {
          entry.onDismiss();
        }
      }

      for (const entry of currentSelectors) {
        const element = document.querySelector(entry.selector);
        const isInsidePopover = element?.contains(target);
        const isInsideAnchor = entry.anchorRefs?.some((ref) => ref.current?.contains(target));
        if (element && !isInsidePopover && !isInsideAnchor) {
          entry.onDismiss();
        }
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);
}
