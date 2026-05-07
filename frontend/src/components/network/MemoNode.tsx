import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { NotebookPen } from "lucide-react";

export interface MemoNodeData {
  title: string;
  preview: string;
  kind: string;
}

const KIND_COLOR: Record<string, string> = {
  analytic: "#8b5cf6",
  methodological: "#06b6d4",
  theoretical: "#10b981",
  reflective: "#f97316",
};

function MemoNodeRaw({ data, selected }: NodeProps<MemoNodeData>) {
  const accent = KIND_COLOR[data.kind] ?? "#8b5cf6";
  return (
    <div
      className="rounded-xl border bg-violet-50 px-3 py-2 text-xs shadow-sm transition-shadow hover:shadow-md dark:bg-violet-950/40"
      style={{
        borderColor: selected ? accent : `${accent}99`,
        borderWidth: selected ? 2 : 1,
        boxShadow: selected ? `0 0 0 2px ${accent}33, 0 4px 14px ${accent}26` : undefined,
        minWidth: 160,
        maxWidth: 240,
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <Handle type="source" position={Position.Top} id="t-src" className="!bg-muted-foreground" />
      <Handle type="target" position={Position.Bottom} id="b-tgt" className="!bg-muted-foreground" />
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
      <Handle type="target" position={Position.Left} id="l-tgt" className="!bg-muted-foreground" />
      <Handle type="source" position={Position.Left} id="l-src" className="!bg-muted-foreground" />
      <Handle type="target" position={Position.Right} id="r-tgt" className="!bg-muted-foreground" />
      <Handle type="source" position={Position.Right} id="r-src" className="!bg-muted-foreground" />

      <div className="flex items-center gap-1.5 font-medium text-violet-900 dark:text-violet-100">
        <NotebookPen className="h-3 w-3 flex-shrink-0" style={{ color: accent }} />
        <span className="truncate" title={data.title}>
          {data.title}
        </span>
      </div>
      {data.preview ? (
        <p className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-violet-800/80 dark:text-violet-200/80">
          {data.preview}
        </p>
      ) : null}
      <div className="mt-1 text-[10px] uppercase tracking-wide" style={{ color: accent }}>
        {data.kind}
      </div>
    </div>
  );
}

export const MemoNode = memo(MemoNodeRaw);
