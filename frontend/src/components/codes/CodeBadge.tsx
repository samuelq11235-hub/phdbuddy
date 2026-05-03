import { X, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Code } from "@/types/database";

interface Props {
  code: Pick<Code, "id" | "name" | "color"> & { created_by_ai?: boolean };
  size?: "sm" | "md";
  showAi?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  className?: string;
}

export function CodeBadge({ code, size = "sm", showAi, onClick, onRemove, className }: Props) {
  const tone = adjustTone(code.color);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium leading-none transition-colors",
        size === "sm" ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs",
        onClick && "cursor-pointer hover:brightness-110",
        className
      )}
      style={{
        backgroundColor: tone.bg,
        color: tone.fg,
        borderColor: tone.border,
      }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: code.color }}
      />
      <span className="truncate max-w-[180px]">{code.name}</span>
      {showAi && code.created_by_ai && (
        <Sparkles className="h-3 w-3 opacity-70" aria-label="Generado por IA" />
      )}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 -mr-0.5 rounded-full p-0.5 hover:bg-black/10"
          aria-label={`Quitar ${code.name}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

// Build a soft pastel background + readable text from a vivid hex.
function adjustTone(hex: string): { bg: string; fg: string; border: string } {
  const { r, g, b } = parseHex(hex);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const fg = lum > 160 ? "#1f2937" : "#0f172a";
  const bg = mix(hex, "#ffffff", 0.85);
  const border = mix(hex, "#ffffff", 0.65);
  return { bg, fg, border };
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

function mix(a: string, b: string, t: number): string {
  const A = parseHex(a);
  const B = parseHex(b);
  const r = Math.round(A.r + (B.r - A.r) * t);
  const g = Math.round(A.g + (B.g - A.g) * t);
  const bl = Math.round(A.b + (B.b - A.b) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl
    .toString(16)
    .padStart(2, "0")}`;
}
