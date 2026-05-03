import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

export interface CodeNodeData {
  label: string;
  color: string;
  usageCount: number;
}

// Custom React Flow node with anchored handles on all four sides so users
// can drag connections from any edge of the rounded pill — closer to the
// freeform feel of Atlas.ti's network editor.
function CodeNodeRaw({ data, selected }: NodeProps<CodeNodeData>) {
  return (
    <div
      className="rounded-2xl border bg-card px-3 py-2 text-xs font-medium shadow-sm transition-shadow hover:shadow-md"
      style={{
        borderColor: data.color,
        borderWidth: selected ? 2 : 1,
        boxShadow: selected
          ? `0 0 0 2px ${data.color}33, 0 4px 14px ${data.color}26`
          : undefined,
        minWidth: 96,
        maxWidth: 220,
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

      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
          style={{ backgroundColor: data.color }}
        />
        <span className="truncate" title={data.label}>
          {data.label}
        </span>
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">
        {data.usageCount} {data.usageCount === 1 ? "uso" : "usos"}
      </div>
    </div>
  );
}

export const CodeNode = memo(CodeNodeRaw);
