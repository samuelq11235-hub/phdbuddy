import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { DocumentStatus } from "@/types/database";

const labels: Record<DocumentStatus, string> = {
  pending: "En cola",
  processing: "Procesando",
  ready: "Listo",
  error: "Error",
};

const variants: Record<DocumentStatus, "default" | "secondary" | "destructive" | "success" | "warning" | "outline"> = {
  pending: "secondary",
  processing: "warning",
  ready: "success",
  error: "destructive",
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  const showSpinner = status === "processing" || status === "pending";
  return (
    <Badge variant={variants[status]} className="gap-1">
      {showSpinner && <Loader2 className="h-3 w-3 animate-spin" />}
      {labels[status]}
    </Badge>
  );
}
