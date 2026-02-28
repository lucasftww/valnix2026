import { useState, useEffect, useCallback } from "react";

type EmblaApi = {
  slidesInView: (target?: boolean) => number[];
  on: (event: string, cb: () => void) => void;
  off: (event: string, cb: () => void) => void;
};

/**
 * Tracks which carousel slides are near the viewport.
 * Returns a Set of indices that should render full content.
 * Slides outside the buffer render a lightweight placeholder.
 */
export function useVisibleSlides(api: EmblaApi | undefined, buffer = 2): Set<number> {
  const [visible, setVisible] = useState<Set<number>>(new Set([0, 1, 2, 3]));

  const update = useCallback(() => {
    if (!api) return;
    const inView = api.slidesInView(true);
    const expanded = new Set<number>();
    for (const idx of inView) {
      for (let i = idx - buffer; i <= idx + buffer; i++) {
        if (i >= 0) expanded.add(i);
      }
    }
    setVisible((prev) => {
      // Merge — never un-mount already-seen slides (prevents flicker on scroll-back)
      const merged = new Set(prev);
      let changed = false;
      for (const v of expanded) {
        if (!merged.has(v)) {
          merged.add(v);
          changed = true;
        }
      }
      return changed ? merged : prev;
    });
  }, [api, buffer]);

  useEffect(() => {
    if (!api) return;
    update();
    api.on("slidesInView", update);
    api.on("reInit", update);
    return () => {
      api.off("slidesInView", update);
      api.off("reInit", update);
    };
  }, [api, update]);

  return visible;
}
