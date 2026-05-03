import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import type { QuotationWithCodes } from "@/hooks/useQuotations";

interface Props {
  textRef: React.RefObject<HTMLDivElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  quotations: QuotationWithCodes[];
  highlightQuotationId?: string;
  activeQuotationId?: string | null;
  onQuotationClick: (quotationId: string) => void;
}

interface Bar {
  quotationId: string;
  codeId: string;
  codeName: string;
  color: string;
  top: number;
  height: number;
  column: number;
}

/**
 * Vertical "code margin" — Atlas.ti's signature gutter on the right side of a
 * document, where every quotation gets a colored bar covering the vertical
 * range of its text. Overlapping quotations stack horizontally as parallel
 * columns within the gutter, one column per quotation.
 *
 * Positioning strategy: we measure `<span data-offset="...">` segments inside
 * the rendered text container (already produced by `DocumentTextViewer`'s
 * `buildSegments`). For each quotation, we union the bounding rects of every
 * segment that intersects its `[start_offset, end_offset)` range — that yields
 * the exact pixel range the quotation occupies, even when the text wraps
 * across multiple lines.
 */
export function CodeMargin({
  textRef,
  containerRef,
  quotations,
  highlightQuotationId,
  activeQuotationId,
  onQuotationClick,
}: Props) {
  const [bars, setBars] = useState<Bar[]>([]);

  const recompute = useMemo(() => {
    return () => {
      const text = textRef.current;
      const container = containerRef.current;
      if (!text || !container) {
        setBars([]);
        return;
      }
      if (quotations.length === 0) {
        setBars([]);
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const segmentEls = Array.from(
        text.querySelectorAll<HTMLElement>("span.document-segment[data-offset]")
      );
      if (segmentEls.length === 0) {
        setBars([]);
        return;
      }

      // Build a sorted index of segments with their character ranges.
      type SegEntry = { el: HTMLElement; start: number; end: number };
      const segs: SegEntry[] = [];
      for (let i = 0; i < segmentEls.length; i++) {
        const el = segmentEls[i];
        const start = parseInt(el.dataset.offset ?? "", 10);
        if (Number.isNaN(start)) continue;
        const next = segmentEls[i + 1];
        const nextStart = next ? parseInt(next.dataset.offset ?? "", 10) : NaN;
        const end = Number.isFinite(nextStart)
          ? (nextStart as number)
          : start + (el.textContent ?? "").length;
        segs.push({ el, start, end });
      }
      if (segs.length === 0) {
        setBars([]);
        return;
      }

      const sorted = [...quotations].sort((a, b) => {
        if (a.start_offset !== b.start_offset) return a.start_offset - b.start_offset;
        return a.end_offset - b.end_offset;
      });

      const rectsByQuotation = new Map<string, { top: number; bottom: number }>();
      for (const q of sorted) {
        let lo = 0;
        let hi = segs.length - 1;
        let firstIdx = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (segs[mid].end <= q.start_offset) {
            lo = mid + 1;
          } else {
            firstIdx = mid;
            hi = mid - 1;
          }
        }
        if (firstIdx === -1) continue;

        let top = Number.POSITIVE_INFINITY;
        let bottom = Number.NEGATIVE_INFINITY;
        for (let i = firstIdx; i < segs.length; i++) {
          const s = segs[i];
          if (s.start >= q.end_offset) break;
          // Walk the segment's client rects; multi-line text wraps produce
          // multiple line boxes per span and we want them all.
          const rects = s.el.getClientRects();
          for (let r = 0; r < rects.length; r++) {
            const rect = rects[r];
            if (rect.height === 0) continue;
            if (rect.top < top) top = rect.top;
            if (rect.bottom > bottom) bottom = rect.bottom;
          }
        }
        if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
        rectsByQuotation.set(q.id, { top, bottom });
      }

      const layout = packColumns(sorted, rectsByQuotation);

      const next: Bar[] = [];
      for (const item of layout) {
        const codes = item.q.codes.length > 0 ? item.q.codes : [null];
        const totalCols = codes.length;
        for (let i = 0; i < codes.length; i++) {
          const c = codes[i];
          next.push({
            quotationId: item.q.id,
            codeId: c?.id ?? `__none-${item.q.id}`,
            codeName: c?.name ?? "(sin códigos)",
            color: c?.color ?? "#94A3B8",
            top: item.top - containerRect.top,
            height: Math.max(2, item.bottom - item.top),
            column: item.column * totalCols + i,
          });
        }
      }
      setBars(next);
    };
  }, [containerRef, quotations, textRef]);

  // Measurement happens after layout. `useLayoutEffect` synchronously runs
  // after DOM mutations but before the browser paints, so the user never
  // sees a frame without bars after `quotations` change.
  useLayoutEffect(() => {
    recompute();
  }, [recompute]);

  // Re-measure whenever the text container reflows: window resize, sidebar
  // toggle, font load, or any layout-affecting parent change.
  useEffect(() => {
    const text = textRef.current;
    if (!text) return;

    const ro = new ResizeObserver(() => recompute());
    ro.observe(text);
    if (text.parentElement) ro.observe(text.parentElement);

    const onWindowResize = () => recompute();
    window.addEventListener("resize", onWindowResize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, [recompute, textRef]);

  if (bars.length === 0) {
    return null;
  }

  const maxColumn = bars.reduce((m, b) => Math.max(m, b.column), 0);
  const barWidth = 4;
  const gap = 2;
  const padLeft = 8;
  const totalWidth = padLeft + (maxColumn + 1) * (barWidth + gap);

  return (
    <div
      aria-hidden={false}
      className="pointer-events-none absolute right-0 top-0 h-full"
      style={{ width: `${totalWidth}px` }}
    >
      {bars.map((b) => {
        const isActive = b.quotationId === activeQuotationId;
        const isHighlighted = b.quotationId === highlightQuotationId;
        return (
          <button
            key={`${b.quotationId}-${b.codeId}-${b.column}`}
            type="button"
            onClick={() => onQuotationClick(b.quotationId)}
            title={`${b.codeName}`}
            className="pointer-events-auto absolute rounded-sm transition-all hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            style={{
              top: `${b.top}px`,
              left: `${padLeft + b.column * (barWidth + gap)}px`,
              width: `${barWidth}px`,
              height: `${b.height}px`,
              backgroundColor: b.color,
              opacity: isActive || isHighlighted ? 1 : 0.78,
              boxShadow: isActive
                ? "0 0 0 2px rgba(124,58,237,0.6)"
                : isHighlighted
                ? "0 0 0 1.5px rgba(124,58,237,0.4)"
                : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

interface PackItem {
  q: QuotationWithCodes;
  top: number;
  bottom: number;
  column: number;
}

/**
 * Greedy interval graph coloring: assigns each quotation the leftmost column
 * (0-indexed) that is free for its vertical pixel span. Two quotations share
 * a column iff their pixel ranges don't overlap. Input must be pre-sorted by
 * `start_offset` so the sweep proceeds top-to-bottom.
 */
function packColumns(
  sorted: QuotationWithCodes[],
  rectsByQuotation: Map<string, { top: number; bottom: number }>
): PackItem[] {
  const result: PackItem[] = [];
  const columnEnds: number[] = []; // columnEnds[i] = pixel `bottom` of the last quotation placed in column i

  for (const q of sorted) {
    const rect = rectsByQuotation.get(q.id);
    if (!rect) continue;
    let placed = -1;
    for (let i = 0; i < columnEnds.length; i++) {
      if (columnEnds[i] <= rect.top + 0.5) {
        placed = i;
        break;
      }
    }
    if (placed === -1) {
      placed = columnEnds.length;
      columnEnds.push(rect.bottom);
    } else {
      columnEnds[placed] = rect.bottom;
    }
    result.push({ q, top: rect.top, bottom: rect.bottom, column: placed });
  }
  return result;
}
