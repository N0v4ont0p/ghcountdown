import { useCallback, useRef } from 'react';

/**
 * Walk up from `el` until a scrollable ancestor is found.  An element is
 * "scrollable" if its computed `overflow-y` is `auto` or `scroll` *and* it
 * actually has overflowing content (`scrollHeight > clientHeight`).  Falls
 * back to `document.scrollingElement` if no in-page scroll container is found
 * (e.g. when the whole page scrolls instead of an inner `<main>`).
 */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el?.parentElement ?? null;
  while (cur && cur !== document.body) {
    const style = window.getComputedStyle(cur);
    const overflowY = style.overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      cur.scrollHeight > cur.clientHeight
    ) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * React hook that keeps the user's scroll position stable across an async
 * data update.  Many of our views re-fetch their entire dataset after a
 * create/edit/delete and re-render large lists with framer-motion layout
 * animations; the combination of new array references, layout transitions,
 * and Radix dialog focus-restoration can nudge or reset the scroll position
 * of the surrounding scroll container.
 *
 * Usage:
 * ```tsx
 * const { rootRef, preserveScroll } = useScrollPreservation<HTMLDivElement>();
 * // ...
 * <div ref={rootRef}> ... </div>
 * // around any handler that triggers a reload:
 * await preserveScroll(async () => {
 *   await updateThing(...);
 *   await loadData();
 * });
 * ```
 *
 * The captured scrollTop is re-applied across two `requestAnimationFrame`
 * ticks so the restoration runs after React has committed the new state and
 * the browser has performed layout.  Restoration is a no-op when no scroll
 * container can be found or when nothing has actually changed.
 */
export function useScrollPreservation<T extends HTMLElement = HTMLElement>() {
  const rootRef = useRef<T | null>(null);

  const preserveScroll = useCallback(async <R,>(action: () => Promise<R> | R): Promise<R> => {
    const container = findScrollParent(rootRef.current);
    const savedTop = container?.scrollTop ?? 0;
    const savedLeft = container?.scrollLeft ?? 0;

    const result = await action();

    if (container) {
      // Two RAFs: the first lets React flush its commit (state setters that
      // ran synchronously during `action`); the second lets the browser
      // perform layout so any framer-motion `layout` transitions have
      // settled enough that our scrollTop assignment sticks.
      const restore = () => {
        if (container.scrollTop !== savedTop) {
          container.scrollTop = savedTop;
        }
        if (container.scrollLeft !== savedLeft) {
          container.scrollLeft = savedLeft;
        }
      };
      requestAnimationFrame(() => {
        restore();
        requestAnimationFrame(restore);
      });
    }

    return result;
  }, []);

  return { rootRef, preserveScroll };
}
