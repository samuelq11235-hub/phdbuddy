import { useMemo, useState } from "react";
import { Loader2, ShieldCheck, ShieldAlert, ShieldX, Users as UsersIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectMembers } from "@/hooks/useMembers";
import { useDocuments } from "@/hooks/useDocuments";
import { useComputeAgreement } from "@/hooks/useAgreement";
import { useToast } from "@/hooks/use-toast";

// Inter-coder agreement panel:
// - Pick two project members
// - Optionally narrow to a subset of documents
// - Compute κ per code + global α + percent agreement + discrepancies
//
// All actual math lives in the `compute-agreement` edge function so we
// can reuse the same logic for export jobs / PDF reports later.

interface Props {
  projectId: string;
}

export function AgreementPanel({ projectId }: Props) {
  const { data: members, isLoading: membersLoading } = useProjectMembers(projectId);
  const { data: documents } = useDocuments(projectId);
  const compute = useComputeAgreement();
  const { toast } = useToast();

  const [userA, setUserA] = useState<string | undefined>(undefined);
  const [userB, setUserB] = useState<string | undefined>(undefined);
  const [docFilter, setDocFilter] = useState<"all" | string>("all");

  const memberOptions = useMemo(() => {
    return (members ?? []).map((m) => ({
      id: m.user_id,
      label: m.profile?.full_name || `Usuario ${m.user_id.slice(0, 6)}`,
    }));
  }, [members]);

  async function run() {
    if (!userA || !userB) {
      toast({
        title: "Selecciona dos miembros",
        description: "Elige dos personas para comparar sus codificaciones.",
        variant: "destructive",
      });
      return;
    }
    if (userA === userB) {
      toast({
        title: "Selecciona codificadores distintos",
        variant: "destructive",
      });
      return;
    }
    try {
      await compute.mutateAsync({
        projectId,
        userA,
        userB,
        documentIds: docFilter === "all" ? undefined : [docFilter],
      });
    } catch (err) {
      toast({
        title: "No se pudo calcular el acuerdo",
        description: err instanceof Error ? err.message : "Error desconocido",
        variant: "destructive",
      });
    }
  }

  if (membersLoading) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (memberOptions.length < 2) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <UsersIcon className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-2 text-sm font-medium">Necesitas al menos 2 miembros</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Invita a otra persona desde la pestaña <span className="font-medium">Miembros</span> antes de medir el acuerdo.
        </p>
      </div>
    );
  }

  const result = compute.data;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField
            label="Codificador A"
            value={userA}
            onChange={setUserA}
            options={memberOptions}
          />
          <SelectField
            label="Codificador B"
            value={userB}
            onChange={setUserB}
            options={memberOptions}
          />
          <SelectField
            label="Documentos"
            value={docFilter}
            onChange={(v) => setDocFilter(v as "all" | string)}
            options={[
              { id: "all", label: "Todos los documentos" },
              ...((documents ?? []).map((d) => ({ id: d.id, label: d.title }))),
            ]}
          />
        </div>
        <div className="mt-4 flex items-center justify-end gap-3">
          <p className="text-xs text-muted-foreground">
            Unidad de análisis: bucket de posición en el documento (100 buckets/doc).
          </p>
          <Button onClick={run} disabled={compute.isPending}>
            {compute.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Calcular acuerdo
          </Button>
        </div>
      </div>

      {result && (
        <div className="space-y-6">
          <GlobalMetrics
            kappa={result.global.kappa}
            alpha={result.global.alpha}
            simpleAgreement={result.global.simpleAgreement}
            n={result.global.n}
          />
          <PerCodeTable rows={result.perCode} />
          <DiscrepanciesList rows={result.discrepancies} />
        </div>
      )}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <label className="space-y-1.5 text-sm">
      <span className="block font-medium">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Selecciona…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.id} value={opt.id}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function GlobalMetrics({
  kappa,
  alpha,
  simpleAgreement,
  n,
}: {
  kappa: number | null;
  alpha: number | null;
  simpleAgreement: number | null;
  n: number;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <Metric label="Kappa medio (Cohen)" value={kappa} interpret help="Acuerdo binario presencia/ausencia, promediado por código." />
      <Metric label="Alpha (Krippendorff)" value={alpha} interpret help="Acuerdo global considerando todos los códigos como conjunto." />
      <Metric label="% Acuerdo simple" value={simpleAgreement} percent help="Fracción de unidades donde A y B aplican el mismo conjunto de códigos." />
      <Metric label="Unidades comparadas" value={n} integer help="Buckets de 1/100 del texto, sumados sobre todos los documentos." />
    </div>
  );
}

function Metric({
  label,
  value,
  interpret,
  percent,
  integer,
  help,
}: {
  label: string;
  value: number | null;
  interpret?: boolean;
  percent?: boolean;
  integer?: boolean;
  help?: string;
}) {
  let display: string;
  let Icon = ShieldAlert;
  let color = "text-amber-600";
  if (value === null || value === undefined) {
    display = "—";
    Icon = ShieldAlert;
    color = "text-muted-foreground";
  } else if (integer) {
    display = value.toLocaleString();
    color = "text-foreground";
  } else if (percent) {
    display = `${(value * 100).toFixed(1)}%`;
    color = "text-foreground";
  } else {
    display = value.toFixed(3);
    if (interpret) {
      if (value >= 0.8) { Icon = ShieldCheck; color = "text-emerald-600"; }
      else if (value >= 0.6) { Icon = ShieldAlert; color = "text-amber-600"; }
      else { Icon = ShieldX; color = "text-red-600"; }
    }
  }
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${color}`}>{display}</p>
      {help && <p className="mt-1 text-[11px] text-muted-foreground">{help}</p>}
    </div>
  );
}

function PerCodeTable({
  rows,
}: {
  rows: Array<{
    code_id: string;
    code_name: string;
    a_only: number;
    b_only: number;
    both: number;
    kappa: number | null;
    percentAgreement: number;
  }>;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No hay codificaciones de ambos usuarios.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Código</th>
            <th className="px-3 py-2 text-right">Solo A</th>
            <th className="px-3 py-2 text-right">Solo B</th>
            <th className="px-3 py-2 text-right">Ambos</th>
            <th className="px-3 py-2 text-right">Kappa</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code_id} className="border-t">
              <td className="px-3 py-2 font-medium">{r.code_name}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.a_only}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.b_only}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.both}</td>
              <td className={`px-3 py-2 text-right tabular-nums font-semibold ${kappaColor(r.kappa)}`}>
                {r.kappa === null ? "—" : r.kappa.toFixed(3)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function kappaColor(k: number | null): string {
  if (k === null) return "text-muted-foreground";
  if (k >= 0.8) return "text-emerald-600";
  if (k >= 0.6) return "text-amber-600";
  return "text-red-600";
}

function DiscrepanciesList({
  rows,
}: {
  rows: Array<{ quotation_id: string; a_codes: string[]; b_codes: string[] }>;
}) {
  if (rows.length === 0) return null;
  return (
    <details className="rounded-lg border bg-card">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium hover:bg-muted/40">
        Ver discrepancias ({rows.length})
      </summary>
      <ul className="divide-y border-t text-sm">
        {rows.slice(0, 50).map((r) => (
          <li key={r.quotation_id} className="px-4 py-2">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-emerald-700">
                A: {r.a_codes.join(", ") || "—"}
              </span>
              <span className="rounded bg-blue-500/10 px-2 py-0.5 text-blue-700">
                B: {r.b_codes.join(", ") || "—"}
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              cita {r.quotation_id.slice(0, 8)}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}
