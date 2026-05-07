import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { FileText, FileImage, FileAudio, FileVideo, FileQuestion } from "lucide-react";

export interface DocumentNodeData {
  title: string;
  kind: string;
  quotationCount: number;
}

function pickIcon(kind: string) {
  if (kind === "image") return FileImage;
  if (kind === "audio") return FileAudio;
  if (kind === "video") return FileVideo;
  if (kind === "interview" || kind === "transcript" || kind === "field_notes") return FileText;
  if (kind === "literature" || kind === "survey") return FileText;
  return FileQuestion;
}

function DocumentNodeRaw({ data, selected }: NodeProps<DocumentNodeData>) {
  const Icon = pickIcon(data.kind);
  return (
    <div
      className="rounded-xl border bg-sky-50 px-3 py-2 text-xs shadow-sm transition-shadow hover:shadow-md dark:bg-sky-950/40"
      style={{
        borderColor: selected ? "#0284c7" : "#0ea5e9",
        borderWidth: selected ? 2 : 1,
        boxShadow: selected ? "0 0 0 2px #0284c733, 0 4px 14px #0284c726" : undefined,
        minWidth: 150,
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

      <div className="flex items-center gap-1.5 font-medium text-sky-900 dark:text-sky-100">
        <Icon className="h-3 w-3 flex-shrink-0 text-sky-600 dark:text-sky-400" />
        <span className="truncate" title={data.title}>
          {data.title}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-sky-700 dark:text-sky-300">
        <span className="capitalize">{data.kind}</span>
        <span>{data.quotationCount} citas</span>
      </div>
    </div>
  );
}

export const DocumentNode = memo(DocumentNodeRaw);
