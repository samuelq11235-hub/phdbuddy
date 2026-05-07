import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { Quote } from "lucide-react";

export interface QuotationNodeData {
  // Truncated content (first ~140 chars). The full content is shown in
  // the side drawer when the node is double-clicked.
  preview: string;
  documentTitle: string;
  // Optional indicator dots for codes assigned to this quotation. We
  // render up to 3 dots; "+N" badge for the rest.
  codeColors: string[];
}

function QuotationNodeRaw({ data, selected }: NodeProps<QuotationNodeData>) {
  const extra = Math.max(0, data.codeColors.length - 3);
  return (
    <div
      className="rounded-xl border bg-amber-50 px-3 py-2 text-xs shadow-sm transition-shadow hover:shadow-md dark:bg-amber-950/40"
      style={{
        borderColor: selected ? "#d97706" : "#f59e0b",
        borderWidth: selected ? 2 : 1,
        boxShadow: selected ? "0 0 0 2px #d9770633, 0 4px 14px #d9770626" : undefined,
        minWidth: 180,
        maxWidth: 280,
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

      <div className="flex items-start gap-1.5">
        <Quote className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex-1 leading-snug text-amber-950 dark:text-amber-100">
          <span className="line-clamp-3 italic">{data.preview}</span>
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-amber-700 dark:text-amber-300">
        <span className="truncate" title={data.documentTitle}>
          {data.documentTitle}
        </span>
        {data.codeColors.length > 0 ? (
          <div className="flex flex-shrink-0 items-center gap-0.5">
            {data.codeColors.slice(0, 3).map((c, i) => (
              <span
                key={i}
                className="h-2 w-2 rounded-full ring-1 ring-white/60"
                style={{ backgroundColor: c }}
              />
            ))}
            {extra > 0 ? (
              <span className="ml-0.5 font-medium">+{extra}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const QuotationNode = memo(QuotationNodeRaw);
