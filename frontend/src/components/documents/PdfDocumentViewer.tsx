import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { Stage, Layer, Rect } from "react-konva";
// Vite serves the worker as a static asset. The `?url` suffix is a
// Vite-specific feature that returns the asset's deployable URL string,
// which is what GlobalWorkerOptions.workerSrc expects.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import type Konva from "konva";
import type { Quotation, ImageAreaSelection } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface Props {
  pdfUrl: string;
  quotations: Quotation[];
  onCreateRect: (bbox: [number, number, number, number], page: number) => void;
}

// PDF + Konva overlay viewer.
//
// pdf.js renders the current page into a <canvas>; a Konva <Stage> sits
// on top of it absolutely, intercepting mouse events to draw new
// rectangles. Stored bboxes are in PAGE-PIXEL coordinates at scale=1
// (intrinsic page resolution), so they survive zoom changes.
//
// Single-page navigation only: scrolling through huge documents is
// nice but multi-page rendering with pdf.js is non-trivial and the
// payoff is small for qualitative coding workflows where researchers
// move around the document one page at a time anyway.
export function PdfDocumentViewer({ pdfUrl, quotations, onCreateRect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [scale, setScale] = useState(1.25);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const isDrawing = useRef(false);

  // Load the document once.
  useEffect(() => {
    let cancelled = false;
    setRenderError(null);
    pdfjsLib
      .getDocument({ url: pdfUrl })
      .promise.then((doc) => {
        if (cancelled) return;
        setPdfDoc(doc);
        setPageNum(1);
      })
      .catch((err) => {
        if (cancelled) return;
        setRenderError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  // Render current page on every (page, scale) change.
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;

    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNum);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        setPageSize({ width: viewport.width, height: viewport.height });
        const context = canvas.getContext("2d");
        if (!context) return;
        renderTask = page.render({ canvas, canvasContext: context, viewport });
        await renderTask.promise;
      } catch (err) {
        if (cancelled) return;
        // pdf.js raises a "RenderingCancelledException" when we
        // navigate away mid-render; that's fine, surface only real
        // errors.
        const name = (err as Error).name ?? "";
        if (!name.includes("Cancelled")) {
          setRenderError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        /* ignore */
      }
    };
  }, [pdfDoc, pageNum, scale]);

  // Existing rectangles for this page, in stage coords (multiplied by scale).
  const pageRects = useMemo(() => {
    return quotations
      .filter((q) => {
        const meta = q.selection_meta as ImageAreaSelection | undefined;
        return meta?.type === "image_area" && (meta.page ?? 1) === pageNum;
      })
      .map((q) => {
        const meta = q.selection_meta as ImageAreaSelection;
        return {
          id: q.id,
          x: meta.bbox[0] * scale,
          y: meta.bbox[1] * scale,
          w: meta.bbox[2] * scale,
          h: meta.bbox[3] * scale,
        };
      });
  }, [quotations, pageNum, scale]);

  function handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    const stage = e.target.getStage();
    if (!stage) return;
    const p = stage.getPointerPosition();
    if (!p) return;
    isDrawing.current = true;
    setDrawing({ x: p.x, y: p.y, w: 0, h: 0 });
  }
  function handleMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!isDrawing.current || !drawing) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const p = stage.getPointerPosition();
    if (!p) return;
    setDrawing({ x: drawing.x, y: drawing.y, w: p.x - drawing.x, h: p.y - drawing.y });
  }
  function handleMouseUp() {
    if (!isDrawing.current || !drawing) return;
    isDrawing.current = false;
    if (Math.abs(drawing.w) < 8 || Math.abs(drawing.h) < 8) {
      setDrawing(null);
      return;
    }
    // Normalise (handle drag in any direction) and convert back from
    // stage coords (current scale) to page-pixel coords (scale=1).
    const x = (drawing.w >= 0 ? drawing.x : drawing.x + drawing.w) / scale;
    const y = (drawing.h >= 0 ? drawing.y : drawing.y + drawing.h) / scale;
    const w = Math.abs(drawing.w) / scale;
    const h = Math.abs(drawing.h) / scale;
    onCreateRect([x, y, w, h], pageNum);
    setDrawing(null);
  }

  if (renderError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        No se pudo cargar el PDF: {renderError}
      </div>
    );
  }

  if (!pdfDoc) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button size="sm" variant="outline" disabled={pageNum <= 1} onClick={() => setPageNum((p) => Math.max(1, p - 1))}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="font-mono">
          {pageNum} / {pdfDoc.numPages}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={pageNum >= pdfDoc.numPages}
          onClick={() => setPageNum((p) => Math.min(pdfDoc.numPages, p + 1))}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <span className="mx-2 h-5 w-px bg-border" />
        <Button size="sm" variant="outline" onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}>
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="font-mono">{(scale * 100).toFixed(0)}%</span>
        <Button size="sm" variant="outline" onClick={() => setScale((s) => Math.min(3, s + 0.25))}>
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <p className="ml-auto text-xs text-muted-foreground">
          Arrastra sobre la página para crear una región anotable.
        </p>
      </div>

      <div className="relative inline-block max-w-full overflow-auto">
        <canvas ref={canvasRef} className="block" />
        {pageSize && (
          <Stage
            width={pageSize.width}
            height={pageSize.height}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            style={{ position: "absolute", inset: 0, cursor: "crosshair" }}
          >
            <Layer>
              {pageRects.map((r) => (
                <Rect
                  key={r.id}
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  fill="rgba(124,58,237,0.15)"
                  stroke="#7C3AED"
                  strokeWidth={1.5}
                />
              ))}
              {drawing && (
                <Rect
                  x={drawing.w >= 0 ? drawing.x : drawing.x + drawing.w}
                  y={drawing.h >= 0 ? drawing.y : drawing.y + drawing.h}
                  width={Math.abs(drawing.w)}
                  height={Math.abs(drawing.h)}
                  fill="rgba(124,58,237,0.25)"
                  stroke="#7C3AED"
                  strokeWidth={1}
                  dash={[4, 4]}
                />
              )}
            </Layer>
          </Stage>
        )}
      </div>
    </div>
  );
}
