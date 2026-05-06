import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { DocumentTranscriptSegment, Quotation, TimerangeSelection } from "@/types/database";

// Minimal video viewer:
// - HTML5 <video> with native controls.
// - Below: a simple timeline showing existing time-range quotations
//   as colored bands and the current playhead.
// - Buttons "marcar inicio" / "marcar fin" build a range from current
//   time and call onCreateRange when both are set.
// - Transcript list (if available) is the same as audio.

interface Props {
  videoUrl: string;
  segments: DocumentTranscriptSegment[];
  quotations: Quotation[];
  onCreateRange: (startMs: number, endMs: number, contentText: string) => void;
  onSelectQuotation?: (quotationId: string) => void;
}

export function VideoDocumentViewer({
  videoUrl,
  segments,
  quotations,
  onCreateRange,
  onSelectQuotation,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const [markStart, setMarkStart] = useState<number | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onLoaded = () => setDuration(v.duration * 1000);
    const onTime = () => setCurrentMs(Math.round(v.currentTime * 1000));
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("timeupdate", onTime);
    return () => {
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("timeupdate", onTime);
    };
  }, []);

  const ranges = useMemo(() => {
    return quotations
      .map((q) => ({ q, sel: q.selection_meta as TimerangeSelection }))
      .filter(({ sel }) => sel?.type === "timerange");
  }, [quotations]);

  function handleMarkStart() {
    setMarkStart(currentMs);
  }
  function handleMarkEnd() {
    if (markStart === null || currentMs <= markStart) return;
    const startMs = markStart;
    const endMs = currentMs;
    const text = segments
      .filter((s) => s.end_ms > startMs && s.start_ms < endMs)
      .map((s) => s.text)
      .join(" ")
      .trim();
    onCreateRange(startMs, endMs, text || "(sin transcripción)");
    setMarkStart(null);
  }

  function seekToMs(ms: number) {
    if (!videoRef.current) return;
    videoRef.current.currentTime = ms / 1000;
  }

  return (
    <div className="space-y-4">
      <video
        ref={videoRef}
        src={videoUrl}
        controls
        className="w-full rounded-md border bg-black"
      />

      <div className="rounded-md border bg-card p-3">
        <div className="relative h-6 w-full overflow-hidden rounded bg-muted/50">
          {ranges.map(({ q, sel }) => {
            const left = duration > 0 ? (sel.startMs / duration) * 100 : 0;
            const width = duration > 0 ? Math.max(0.5, ((sel.endMs - sel.startMs) / duration) * 100) : 0;
            return (
              <button
                key={q.id}
                type="button"
                title={q.content}
                onClick={() => onSelectQuotation?.(q.id)}
                className="absolute top-0 h-full bg-emerald-500/40 hover:bg-emerald-500/60"
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            );
          })}
          {markStart !== null && (
            <div
              className="absolute top-0 h-full bg-amber-500/40"
              style={{
                left: duration > 0 ? `${(markStart / duration) * 100}%` : 0,
                width: duration > 0 ? `${Math.max(0.5, ((currentMs - markStart) / duration) * 100)}%` : 0,
              }}
            />
          )}
          <div
            className="absolute top-0 h-full w-[2px] bg-primary"
            style={{ left: duration > 0 ? `${(currentMs / duration) * 100}%` : 0 }}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-muted-foreground">{formatMs(currentMs)}</span>
          <span className="text-muted-foreground">/</span>
          <span className="font-mono text-muted-foreground">{formatMs(duration)}</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={handleMarkStart}>
              Marcar inicio
            </Button>
            <Button
              size="sm"
              onClick={handleMarkEnd}
              disabled={markStart === null || currentMs <= markStart}
            >
              {markStart !== null
                ? `Crear cita (${formatMs(markStart)} → ${formatMs(currentMs)})`
                : "Marcar fin"}
            </Button>
          </div>
        </div>
      </div>

      {segments.length > 0 && (
        <ol className="space-y-1 text-sm">
          {segments
            .slice()
            .sort((a, b) => a.segment_index - b.segment_index)
            .map((s) => {
              const active = currentMs >= s.start_ms && currentMs <= s.end_ms;
              return (
                <li
                  key={s.id}
                  className={`flex gap-3 rounded px-2 py-1.5 ${active ? "bg-primary/10" : "hover:bg-muted/40"}`}
                >
                  <button
                    type="button"
                    onClick={() => seekToMs(s.start_ms)}
                    className="font-mono text-xs text-muted-foreground hover:text-primary"
                  >
                    {formatMs(s.start_ms)}
                  </button>
                  <span className="flex-1 leading-relaxed">{s.text}</span>
                </li>
              );
            })}
        </ol>
      )}
    </div>
  );
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
