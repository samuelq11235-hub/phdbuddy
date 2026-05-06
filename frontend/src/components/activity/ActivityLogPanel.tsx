import { Activity, Quote, Tags, NotebookPen, Users, Link as LinkIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActivityLog, type ActivityEventWithActor } from "@/hooks/useActivityLog";

interface Props { projectId: string; }

const ENTITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  quotation: Quote,
  code: Tags,
  memo: NotebookPen,
  member: Users,
  coding: LinkIcon,
};

const ENTITY_LABELS: Record<string, string> = {
  quotation: "cita",
  code: "código",
  memo: "memo",
  member: "miembro",
  coding: "codificación",
};

const ACTION_LABELS: Record<string, string> = {
  create: "creó",
  update: "actualizó",
  delete: "eliminó",
  attach: "vinculó",
  detach: "desvinculó",
  role_change: "cambió rol de",
};

export function ActivityLogPanel({ projectId }: Props) {
  const { data, isLoading, error } = useActivityLog(projectId, 300);

  return (
    <div>
      <header className="mb-4">
        <h2 className="text-xl font-semibold">
          <Activity className="mr-1.5 inline h-5 w-5 text-primary" />
          Actividad del proyecto
        </h2>
        <p className="text-sm text-muted-foreground">
          Las últimas {data?.length ?? 0} acciones de los miembros sobre citas, códigos, memos y permisos.
          Sólo lectura: el registro lo escriben automáticamente los triggers de la base de datos.
        </p>
      </header>

      {isLoading && <Skeleton className="h-96" />}
      {error && (
        <p className="text-sm text-destructive">
          Error al cargar el registro: {(error as Error).message}
        </p>
      )}

      <Card className="divide-y">
        {(data ?? []).length === 0 && !isLoading && (
          <p className="p-6 text-sm italic text-muted-foreground">
            Aún no hay actividad. Edita una cita, un código o un memo para que aparezcan aquí.
          </p>
        )}
        {(data ?? []).map((ev) => (
          <ActivityRow key={ev.id} event={ev} />
        ))}
      </Card>
    </div>
  );
}

function ActivityRow({ event }: { event: ActivityEventWithActor }) {
  const Icon = ENTITY_ICONS[event.entity_type] ?? Activity;
  const entityLabel = ENTITY_LABELS[event.entity_type] ?? event.entity_type;
  const actionLabel = ACTION_LABELS[event.action] ?? event.action;
  const actor = event.actor_name ?? "(sistema)";

  // Pull a short context string from metadata when available — helps the
  // user identify what the event is *about* without clicking through.
  const m = event.metadata ?? {};
  const summary =
    typeof m.title === "string"
      ? m.title
      : typeof m.name === "string"
        ? m.name
        : typeof m.role === "string"
          ? `rol ${m.role}`
          : typeof m.new_role === "string"
            ? `${m.old_role ?? ""} → ${m.new_role}`
            : typeof m.quotation_id === "string"
              ? "cita"
              : "";

  return (
    <div className="flex items-start gap-3 p-3 text-sm">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p>
          <span className="font-medium">{actor}</span>{" "}
          <span className="text-muted-foreground">{actionLabel}</span>{" "}
          <span className="font-medium">{entityLabel}</span>
          {summary && (
            <span className="text-muted-foreground">: <span className="italic">{summary}</span></span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {new Date(event.created_at).toLocaleString("es-ES")}
        </p>
      </div>
    </div>
  );
}
