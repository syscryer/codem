import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type TooltipPlacement = 'top' | 'bottom';

type TooltipAnchorRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
  anchorX: number;
};

type TooltipState = {
  text: string;
  rect: TooltipAnchorRect;
  version: number;
};

type TooltipPosition = {
  left: number;
  top: number;
  placement: TooltipPlacement;
  ready: boolean;
};

const TOOLTIP_MARGIN = 8;
const TOOLTIP_GAP = 8;

export function TooltipLayer() {
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const activeTargetRef = useRef<HTMLElement | null>(null);
  const activePointerXRef = useRef<number | null>(null);
  const versionRef = useRef(0);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [position, setPosition] = useState<TooltipPosition>({
    left: 0,
    top: 0,
    placement: 'top',
    ready: false,
  });

  const hideTooltip = useCallback(() => {
    activeTargetRef.current = null;
    activePointerXRef.current = null;
    setTooltip(null);
    setPosition((current) => ({ ...current, ready: false }));
  }, []);

  const showTooltipForTarget = useCallback((target: HTMLElement, pointerClientX?: number) => {
    normalizeTooltipElement(target);
    const text = target.dataset.tooltip?.trim();
    if (!text) {
      hideTooltip();
      return;
    }

    const targetRect = target.getBoundingClientRect();
    const pointerX = typeof pointerClientX === 'number' && Number.isFinite(pointerClientX)
      ? pointerClientX
      : null;
    activeTargetRef.current = target;
    activePointerXRef.current = pointerX;
    setPosition((current) => ({ ...current, ready: false }));
    setTooltip({
      text,
      rect: toTooltipAnchorRect(targetRect, activePointerXRef.current),
      version: ++versionRef.current,
    });
  }, [hideTooltip]);

  useEffect(() => {
    normalizeNativeTitleTooltips(document.body);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
          normalizeTooltipElement(mutation.target);
          continue;
        }

        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            normalizeNativeTitleTooltips(node);
          }
        }
      }
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['title'],
      childList: true,
      subtree: true,
    });

    function handlePointerOver(event: PointerEvent) {
      const target = findTooltipTarget(event.target);
      if (!target) return;

      const relatedTarget = event.relatedTarget;
      if (target === activeTargetRef.current && relatedTarget instanceof Node && target.contains(relatedTarget)) {
        return;
      }

      showTooltipForTarget(target, event.clientX);
    }

    function handlePointerOut(event: PointerEvent) {
      const activeTarget = activeTargetRef.current;
      if (!activeTarget) return;

      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && activeTarget.contains(relatedTarget)) {
        return;
      }

      if (event.target instanceof Node && activeTarget.contains(event.target)) {
        hideTooltip();
      }
    }

    function handleFocusIn(event: FocusEvent) {
      const target = findTooltipTarget(event.target);
      if (target) {
        if (target === activeTargetRef.current && activePointerXRef.current !== null) {
          return;
        }
        showTooltipForTarget(target);
      }
    }

    function handleFocusOut(event: FocusEvent) {
      const activeTarget = activeTargetRef.current;
      if (!activeTarget) return;

      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && activeTarget.contains(relatedTarget)) {
        return;
      }

      if (event.target instanceof Node && activeTarget.contains(event.target)) {
        hideTooltip();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        hideTooltip();
      }
    }

    document.addEventListener('pointerover', handlePointerOver);
    document.addEventListener('pointerout', handlePointerOut);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      observer.disconnect();
      document.removeEventListener('pointerover', handlePointerOver);
      document.removeEventListener('pointerout', handlePointerOut);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [hideTooltip, showTooltipForTarget]);

  useEffect(() => {
    if (!tooltip) return;

    let animationFrame = 0;
    const updateFromActiveTarget = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const target = activeTargetRef.current;
        if (!target || !document.documentElement.contains(target)) {
          hideTooltip();
          return;
        }

        const text = target.dataset.tooltip?.trim();
        if (!text) {
          hideTooltip();
          return;
        }

        setTooltip({
          text,
          rect: toTooltipAnchorRect(target.getBoundingClientRect(), activePointerXRef.current),
          version: ++versionRef.current,
        });
      });
    };

    window.addEventListener('scroll', updateFromActiveTarget, true);
    window.addEventListener('resize', updateFromActiveTarget);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('scroll', updateFromActiveTarget, true);
      window.removeEventListener('resize', updateFromActiveTarget);
    };
  }, [hideTooltip, tooltip]);

  useLayoutEffect(() => {
    const tooltipElement = tooltipRef.current;
    if (!tooltip || !tooltipElement) return;

    const tooltipWidth = tooltipElement.offsetWidth;
    const tooltipHeight = tooltipElement.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const fitsAbove = tooltip.rect.top >= tooltipHeight + TOOLTIP_GAP + TOOLTIP_MARGIN;
    const fitsBelow = viewportHeight - tooltip.rect.bottom >= tooltipHeight + TOOLTIP_GAP + TOOLTIP_MARGIN;
    const placement: TooltipPlacement = fitsAbove || !fitsBelow ? 'top' : 'bottom';
    const preferredTop = placement === 'top'
      ? tooltip.rect.top - tooltipHeight - TOOLTIP_GAP
      : tooltip.rect.bottom + TOOLTIP_GAP;
    const preferredLeft = tooltip.rect.anchorX - tooltipWidth / 2;

    setPosition({
      left: clamp(preferredLeft, TOOLTIP_MARGIN, viewportWidth - tooltipWidth - TOOLTIP_MARGIN),
      top: clamp(preferredTop, TOOLTIP_MARGIN, viewportHeight - tooltipHeight - TOOLTIP_MARGIN),
      placement,
      ready: true,
    });
  }, [tooltip]);

  if (!tooltip) {
    return null;
  }

  const container = document.querySelector('.codex-desktop') ?? document.body;

  return createPortal(
    <div
      ref={tooltipRef}
      className="app-tooltip"
      role="tooltip"
      data-placement={position.placement}
      style={{
        left: position.left,
        top: position.top,
        opacity: position.ready ? undefined : 0,
      }}
    >
      {tooltip.text}
    </div>,
    container,
  );
}

function normalizeNativeTitleTooltips(root: HTMLElement) {
  normalizeTooltipElement(root);
  root.querySelectorAll<HTMLElement>('[title]').forEach(normalizeTooltipElement);
}

function normalizeTooltipElement(element: HTMLElement) {
  const rawTitle = element.getAttribute('title');
  if (rawTitle === null) {
    return;
  }

  const title = rawTitle.trim();
  if (!title) {
    if (element.dataset.tooltipFromTitle === 'true') {
      delete element.dataset.tooltip;
      delete element.dataset.tooltipFromTitle;
    }
    element.removeAttribute('title');
    return;
  }

  element.dataset.tooltip = title;
  element.dataset.tooltipFromTitle = 'true';
  if (!element.hasAttribute('aria-label') && shouldUseTooltipAsAccessibleLabel(element)) {
    element.setAttribute('aria-label', title);
  }
  element.removeAttribute('title');
}

function shouldUseTooltipAsAccessibleLabel(element: HTMLElement) {
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'button' || tagName === 'a' || tagName === 'input' || tagName === 'select' || tagName === 'textarea') {
    return true;
  }

  const role = element.getAttribute('role');
  return role === 'button' || role === 'menuitem' || role === 'tab';
}

function findTooltipTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return null;
  }

  const titleTarget = target.closest('[title]');
  if (titleTarget instanceof HTMLElement) {
    normalizeTooltipElement(titleTarget);
  }

  const tooltipTarget = target.closest('[data-tooltip]');
  if (!(tooltipTarget instanceof HTMLElement)) {
    return null;
  }

  return tooltipTarget.dataset.tooltipDisabled === 'true' ? null : tooltipTarget;
}

function toTooltipAnchorRect(rect: DOMRect, pointerClientX?: number | null): TooltipAnchorRect {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    anchorX: resolveTooltipAnchorX(rect.left, rect.right, pointerClientX),
  };
}

export function resolveTooltipAnchorX(
  targetLeft: number,
  targetRight: number,
  pointerClientX?: number | null,
) {
  if (pointerClientX === null || pointerClientX === undefined || !Number.isFinite(pointerClientX)) {
    return targetLeft + (targetRight - targetLeft) / 2;
  }
  return clamp(pointerClientX, targetLeft, targetRight);
}

function clamp(value: number, min: number, max: number) {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}
