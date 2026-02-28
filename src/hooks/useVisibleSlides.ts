import { useState, useEffect, useCallback, useRef } from "react";

type EmblaApi = {
  slidesInView: (target?: boolean) => number[];
  on: (event: string, cb: () => void) => void;
  off: (event: string, cb: () => void) => void;
};

/**
 * Tracks which carousel slides should render full content.
 * Uses a grow-only Set (never un-mounts seen slides).
 * Updates on settle/reInit only — NOT during active drag — to avoid
 * React re-renders that cause jank on low-end devices.
 */
export function useVisibleSlides(api: EmblaApi | undefined, buffer = 3): Set<number> {
  // Start with first few slides visible (covers initial render)
  const [visible, setVisible] = useState<Set<number>>(() => {
    const initial = new Set<number>();
    for (let i = 0; i < buffer + 2; i++) initial.add(i);
    return initial;
  });

  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const expand = useCallback(() => {
    if (!api) return;
    const inView = api.slidesInView(true);
    const prev = visibleRef.current;
    let changed = false;
    const merged = new Set(prev);
    for (const idx of inView) {
      for (let i = idx - buffer; i <= idx + buffer; i++) {
        if (i >= 0 && !merged.has(i)) {
          merged.add(i);
          changed = true;
        }
      }
    }
    if (changed) setVisible(merged);
  }, [api, buffer]);

  useEffect(() => {
    if (!api) return;
    // Initial expansion
    expand();
    // Only expand on settle (after drag/scroll ends) and reInit
    api.on("settle", expand);
    api.on("reInit", expand);
    // Also expand on select (arrow clicks)
    api.on("select", expand);
    return () => {
      api.off("settle", expand);
      api.off("reInit", expand);
      api.off("select", expand);
    };
  }, [api, expand]);

  return visible;
}
