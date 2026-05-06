import { useEffect, useMemo, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.js";
import { Loader2, Pause, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DocumentTranscriptSegment, Quotation, TimerangeSelection } from "@/types/database";

// Audio document viewer.
// - Wavesurfer.js renders the waveform.
// - Drag on the waveform → calls onCreateRange with [startMs, endMs] for
//   the AddQuotationDialog to consume.
// - Existing quotations show as colored regions.
// - Below the waveform, the transcript is rendered with click-to-seek.

interface Props {
  audioUrl: string;
  segments: DocumentTranscriptSegment[];
  quotations: Quotation[];
  onCreateRange: (startMs: number, endMs: number, contentText: string) => void;
  onSelectQuotation?: (quotationId: string) => void;
}

export function AudioDocumentViewer({
  audioUrl,
  segments,
  quotations,
  onCreateRange,
  onSelectQuotation,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);

  // ---- init wavesurfer ----
  useEffect(() => {
    if (!containerRef.current) return;
    const regions = RegionsPlugin.create();
    const ws = WaveSurfer.create({
      container: containerRef.current,
      url: audioUrl,
      height: 80,
      waveColor: "#a78bfa",
      progressColor: "#7C3AED",
      cursorColor: "#7C3AED",
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      plugins: [regions],
    });
    wavesurferRef.current = ws;
    regionsRef.current = regions;

    ws.on("ready", () => setReady(true));
    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("audioprocess", () => setCurrentMs(Math.round(ws.getCurrentTime() * 1000)));
    ws.on("seeking", () => setCurrentMs(Math.round(ws.getCurrentTime() * 1000)));

    // Drag to define a region (creates a new quotation).
    regions.enableDragSelection({ color: "rgba(124,58,237,0.18)" });
    regions.on("region-created", (region: { start: number; end: number; remove: () => void }) => {
      const startMs = Math.round(region.start * 1000);
      const endMs = Math.round(region.end * 1000);
      // Compose the literal transcript text covered by this range.
      const text = segments
        .filter((s) => s.end_ms > startMs && s.start_ms < endMs)
        .map((s) => s.text)
        .join(" ")
        .trim();
      onCreateRange(startMs, endMs, text || "(sin transcripción en este rango)");
      // Drop the temporary drag-region; the canonical region for the
      // saved quotation is added in the layout effect below.
      region.remove();
    });

    return () => {
      ws.destroy();
      wavesurferRef.current = null;
      regionsRef.current = null;
      setReady(false);
    };
    // We intentionally re-init when audioUrl changes; segments are
    // separate. Keeping segments out of deps avoids re-creating WS
    // every time a transcript row arrives.
  }, [audioUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- render quotation regions whenever quotations or readiness change ----
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions || !ready) return;
    // Clear existing.
    regions.clearRegions();
    for (const q of quotations) {
      const sel = q.selection_meta as TimerangeSelection;
      if (sel?.type !== "timerange") continue;
      regions.addRegion({
        id: q.id,
        start: sel.startMs / 1000,
        end: sel.endMs / 1000,
        color: "rgba(16,185,129,0.18)",
        drag: false,
        resize: false,
      });
    }
  }, [quotations, ready]);

  // Selecting a region opens its quotation (parent decides what to do).
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions) return;
    const handler = (region: { id?: string }) => {
      if (region.id && onSelectQuotation) onSelectQuotation(region.id);
    };
    regions.on("region-clicked", handler);
    return () => {
      regions.un("region-clicked", handler);
    };
  }, [onSelectQuotation]);

  function togglePlay() {
    wavesurferRef.current?.playPause();
  }

  function seekTo(ms: number) {
    if (!wavesurferRef.current) return;
    const dur = wavesurferRef.current.getDuration();
    if (dur > 0) wavesurferRef.current.seekTo(Math.max(0, Math.min(1, ms / 1000 / dur)));
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card p-3">
        <div ref={containerRef} className="w-full" />
        <div className="mt-2 flex items-center justify-between">
          <Button size="sm" variant="outline" onClick={togglePlay} disabled={!ready}>
            {!ready ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Cargando…
              </>
            ) : playing ? (
              <>
                <Pause className="mr-1 h-3.5 w-3.5" /> Pausar
              </>
            ) : (
              <>
                <Play className="mr-1 h-3.5 w-3.5" /> Reproducir
              </>
            )}
          </Button>
          <span className="font-mono text-xs text-muted-foreground">{formatMs(currentMs)}</span>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Arrastra sobre la onda para crear una cita en ese rango temporal.
        </p>
      </div>

      <TranscriptList
        segments={segments}
        currentMs={currentMs}
        onSeek={seekTo}
      />
    </div>
  );
}

function TranscriptList({
  segments,
  currentMs,
  onSeek,
}: {
  segments: DocumentTranscriptSegment[];
  currentMs: number;
  onSeek: (ms: number) => void;
}) {
  const items = useMemo(() => segments.slice().sort((a, b) => a.segment_index - b.segment_index), [segments]);
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay transcripción disponible. Si quieres transcribir el audio, configura{" "}
        <code className="rounded bg-muted px-1">OPENAI_API_KEY</code> en el proyecto Supabase y reprocesa.
      </p>
    );
  }
  return (
    <ol className="space-y-1 text-sm">
      {items.map((s) => {
        const active = currentMs >= s.start_ms && currentMs <= s.end_ms;
        return (
          <li
            key={s.id}
            className={`flex gap-3 rounded px-2 py-1.5 ${active ? "bg-primary/10" : "hover:bg-muted/40"}`}
          >
            <button
              type="button"
              onClick={() => onSeek(s.start_ms)}
              className="font-mono text-xs text-muted-foreground hover:text-primary"
            >
              {formatMs(s.start_ms)}
            </button>
            <span className="flex-1 leading-relaxed">{s.text}</span>
          </li>
        );
      })}
    </ol>
  );
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
