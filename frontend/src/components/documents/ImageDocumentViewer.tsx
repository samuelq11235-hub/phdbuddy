import { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Rect } from "react-konva";
import useImage from "use-image";

import type Konva from "konva";
import type { Quotation, ImageAreaSelection } from "@/types/database";

// Konva-based viewer for image documents.
// - Renders the image to fit the available width.
// - Drag-to-create a new rectangle → opens an "add quotation" modal.
// - Existing quotations show as semi-transparent rects with their code colors.
//
// Quotations on images use selection_meta = { type: 'image_area', bbox: [x, y, w, h] }
// with bbox in IMAGE pixel coordinates (not stage coordinates), so the
// regions stay correct regardless of zoom / available width.

interface Props {
  imageUrl: string;
  quotations: Quotation[];
  onCreateRect: (bbox: [number, number, number, number]) => void;
  onSelectQuotation?: (quotationId: string) => void;
}

export function ImageDocumentViewer({
  imageUrl,
  quotations,
  onCreateRect,
  onSelectQuotation,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [image] = useImage(imageUrl, "anonymous");
  const [stageWidth, setStageWidth] = useState(800);
  const [drawing, setDrawing] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const isDrawing = useRef(false);

  // Resize observer keeps the stage tracking the container width.
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setStageWidth(w);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const scale = image && image.width > 0 ? stageWidth / image.width : 1;
  const stageHeight = image ? image.height * scale : 600;

  const imageRects = useMemo(() => {
    return quotations
      .filter((q) => (q.selection_meta as ImageAreaSelection)?.type === "image_area")
      .map((q) => {
        const bbox = (q.selection_meta as ImageAreaSelection).bbox;
        return {
          id: q.id,
          x: bbox[0] * scale,
          y: bbox[1] * scale,
          w: bbox[2] * scale,
          h: bbox[3] * scale,
        };
      });
  }, [quotations, scale]);

  function handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    const stage = e.target.getStage();
    if (!stage) return;
    const point = stage.getPointerPosition();
    if (!point) return;
    isDrawing.current = true;
    setDrawing({ x: point.x, y: point.y, w: 0, h: 0 });
  }

  function handleMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!isDrawing.current || !drawing) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const point = stage.getPointerPosition();
    if (!point) return;
    setDrawing({
      x: drawing.x,
      y: drawing.y,
      w: point.x - drawing.x,
      h: point.y - drawing.y,
    });
  }

  function handleMouseUp() {
    if (!isDrawing.current || !drawing) return;
    isDrawing.current = false;
    if (Math.abs(drawing.w) > 8 && Math.abs(drawing.h) > 8 && image) {
      // Normalise (allow drag in any direction) and convert back to
      // image-pixel coordinates by undoing the stage scale.
      const x = Math.min(drawing.x, drawing.x + drawing.w) / scale;
      const y = Math.min(drawing.y, drawing.y + drawing.h) / scale;
      const w = Math.abs(drawing.w) / scale;
      const h = Math.abs(drawing.h) / scale;
      onCreateRect([Math.round(x), Math.round(y), Math.round(w), Math.round(h)]);
    }
    setDrawing(null);
  }

  return (
    <div ref={containerRef} className="w-full overflow-hidden rounded-md border bg-muted/20">
      {!image ? (
        <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          Cargando imagen…
        </div>
      ) : (
        <Stage
          width={stageWidth}
          height={stageHeight}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className="cursor-crosshair"
        >
          <Layer>
            <KonvaImage
              image={image}
              x={0}
              y={0}
              width={stageWidth}
              height={stageHeight}
              listening={false}
            />
            {imageRects.map((r) => (
              <Rect
                key={r.id}
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                stroke="#7C3AED"
                strokeWidth={2}
                fill="rgba(124,58,237,0.12)"
                onClick={() => onSelectQuotation?.(r.id)}
                onTap={() => onSelectQuotation?.(r.id)}
              />
            ))}
            {drawing && (
              <Rect
                x={drawing.x}
                y={drawing.y}
                width={drawing.w}
                height={drawing.h}
                stroke="#7C3AED"
                strokeWidth={2}
                dash={[4, 4]}
                fill="rgba(124,58,237,0.05)"
                listening={false}
              />
            )}
          </Layer>
        </Stage>
      )}
    </div>
  );
}
