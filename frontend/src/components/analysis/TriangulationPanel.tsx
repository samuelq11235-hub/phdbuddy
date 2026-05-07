// F34 — Automatic triangulation.
//
// For every code we measure how diverse its evidence base is:
//   - distinct documents (source diversity)
//   - distinct document groups (theoretical context diversity)
//   - distinct values of a chosen "actor" attribute
//
// We then classify each finding into a tier:
//   • single_source  — only one document supports it (treat with care)
//   • partial        — ≥2 documents but only one group / actor
//   • triangulated   — ≥3 documents AND ≥2 groups OR ≥2 actor values
//
// This panel is the qualitative-research equivalent of "convergent
// validity": findings that survive triangulation are the safest to
// report in the thesis.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Users,
  FileText,
  Boxes,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDocumentAttributeSchema } from "@/hooks/useDocumentGroups";
import { useDocuments } from "@/hooks/useDocuments";
import { useCodes } from "@/hooks/useCodes";
import { cn } from "@/lib/utils";

// PostgREST returns nested rels as either a single object or an array
// depending on FK cardinality. Normalising to `any` here keeps the
// runtime guard below readable; we narrow back to the strict shape
// before feeding it into the rest of the panel.
type QuotationCodeRow = {
  code_id: string;
  quotation:
    | { document_id: string; project_id: string }
    | { document_id: string; project_id: string }[]
    | null;
};

interface DocGroupRow {
  document_id: string;
  document_group_id: string;
}

type Tier = "triangulated" | "partial" | "single_source";

interface CodeFinding {
  codeId: string;
  codeName: string;
  codeColor: string;
  totalQuotations: number;
  documents: string[];
  groups: string[];
  actorValues: string[];
  tier: Tier;
}

interface Props {
  projectId: string;
}

export function TriangulationPanel({ projectId }: Props) {
  const { data: schema = [] } = useDocumentAttributeSchema(projectId);
  const { data: documents = [] } = useDocuments(projectId);
  const { data: codes = [] } = useCodes(projectId);
  const [actorAttr, setActorAttr] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<Tier | "all">("all");

  const effectiveActor = actorAttr ?? schema[0]?.name ?? null;

  const codings = useQuery({
    queryKey: ["triangulation-codings", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotation_codes")
        .select("code_id, quotation:quotations(document_id, project_id)")
        .limit(50_000);
      if (error) throw error;
      return (data ?? []).flatMap((row) => {
        const r = row as unknown as QuotationCodeRow;
        const q = Array.isArray(r.quotation) ? r.quotation[0] : r.quotation;
        if (!q || q.project_id !== projectId) return [];
        return [{ codeId: r.code_id, documentId: q.document_id }];
      });
    },
  });

  const groupMembers = useQuery({
    queryKey: ["triangulation-groups", projectId],
    queryFn: async () => {
      // We pull (document_id, group_id) restricted to the current project
      // by joining via document_groups in a sub-select.
      const { data: groups, error: gErr } = await supabase
        .from("document_groups")
        .select("id")
        .eq("project_id", projectId);
      if (gErr) throw gErr;
      const groupIds = (groups ?? []).map((g) => g.id as string);
      if (groupIds.length === 0) return [] as DocGroupRow[];
      const { data, error } = await supabase
        .from("document_group_members")
        .select("document_id, document_group_id")
        .in("document_group_id", groupIds);
      if (error) throw error;
      return (data ?? []) as DocGroupRow[];
    },
  });

  const findings = useMemo<CodeFinding[]>(() => {
    if (!codings.data) return [];

    const docMeta = new Map<string, Record<string, unknown>>();
    for (const d of documents) {
      docMeta.set(d.id, (d.source_metadata ?? {}) as Record<string, unknown>);
    }
    const groupsByDoc = new Map<string, Set<string>>();
    for (const m of groupMembers.data ?? []) {
      const set = groupsByDoc.get(m.document_id) ?? new Set<string>();
      set.add(m.document_group_id);
      groupsByDoc.set(m.document_id, set);
    }

    const byCode = new Map<
      string,
      {
        docs: Set<string>;
        groups: Set<string>;
        actors: Set<string>;
        total: number;
      }
    >();
    for (const c of codings.data) {
      const slot = byCode.get(c.codeId) ?? {
        docs: new Set<string>(),
        groups: new Set<string>(),
        actors: new Set<string>(),
        total: 0,
      };
      slot.docs.add(c.documentId);
      slot.total += 1;
      const g = groupsByDoc.get(c.documentId);
      if (g) for (const gid of g) slot.groups.add(gid);
      if (effectiveActor) {
        const meta = docMeta.get(c.documentId);
        const v = meta ? meta[effectiveActor] : null;
        if (v != null && v !== "") slot.actors.add(String(v));
      }
      byCode.set(c.codeId, slot);
    }

    return codes
      .map((code) => {
        const slot = byCode.get(code.id);
        if (!slot) return null;
        const docs = [...slot.docs];
        const groups = [...slot.groups];
        const actors = [...slot.actors];
        let tier: Tier;
        if (docs.length < 2) tier = "single_source";
        else if (
          docs.length >= 3 &&
          (groups.length >= 2 || actors.length >= 2)
        )
          tier = "triangulated";
        else tier = "partial";
        return {
          codeId: code.id,
          codeName: code.name,
          codeColor: code.color,
          totalQuotations: slot.total,
          documents: docs,
          groups,
          actorValues: actors,
          tier,
        } as CodeFinding;
      })
      .filter((x): x is CodeFinding => x !== null)
      .sort((a, b) => {
        const order: Record<Tier, number> = {
          triangulated: 0,
          partial: 1,
          single_source: 2,
        };
        if (order[a.tier] !== order[b.tier]) return order[a.tier] - order[b.tier];
        return b.totalQuotations - a.totalQuotations;
      });
  }, [codings.data, codes, documents, groupMembers.data, effectiveActor]);

  const counts = useMemo(() => {
    const c: Record<Tier, number> = {
      triangulated: 0,
      partial: 0,
      single_source: 0,
    };
    for (const f of findings) c[f.tier] += 1;
    return c;
  }, [findings]);

  if (codings.isLoading || groupMembers.isLoading) {
    return <Skeleton className="h-[400px]" />;
  }

  if (findings.length === 0) {
    return (
      <Card className="flex h-[300px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <ShieldAlert className="h-6 w-6 text-muted-foreground/60" />
        <p>Aún no hay códigos con citas suficientes para triangular.</p>
      </Card>
    );
  }

  const visible =
    tierFilter === "all" ? findings : findings.filter((f) => f.tier === tierFilter);

  return (
    <div className="space-y-4">
      {/* Top stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TierStat
          label="Triangulado"
          count={counts.triangulated}
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          tone="emerald"
          active={tierFilter === "triangulated"}
          onClick={() =>
            setTierFilter(tierFilter === "triangulated" ? "all" : "triangulated")
          }
        />
        <TierStat
          label="Parcial"
          count={counts.partial}
          icon={<ShieldAlert className="h-4 w-4 text-amber-500" />}
          tone="amber"
          active={tierFilter === "partial"}
          onClick={() => setTierFilter(tierFilter === "partial" ? "all" : "partial")}
        />
        <TierStat
          label="Fuente única"
          count={counts.single_source}
          icon={<AlertTriangle className="h-4 w-4 text-rose-500" />}
          tone="rose"
          active={tierFilter === "single_source"}
          onClick={() =>
            setTierFilter(tierFilter === "single_source" ? "all" : "single_source")
          }
        />
      </div>

      {/* Actor selector */}
      {schema.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface-2 px-4 py-3 text-xs text-muted-foreground">
          <span>
            Atributo que actúa como <strong className="text-foreground">actor</strong>:
          </span>
          <Select
            value={effectiveActor ?? undefined}
            onValueChange={(v) => setActorAttr(v)}
          >
            <SelectTrigger className="h-8 w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {schema.map((s) => (
                <SelectItem key={s.id} value={s.name}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground/80">
            Un código triangula si ≥3 documentos lo respaldan{" "}
            <strong>y</strong> tienen ≥2 grupos o ≥2 valores de este atributo.
          </span>
        </div>
      ) : null}

      {/* Findings list */}
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {visible.map((f) => (
          <FindingCard key={f.codeId} finding={f} />
        ))}
      </div>
    </div>
  );
}

function TierStat({
  label,
  count,
  icon,
  tone,
  active,
  onClick,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  tone: "emerald" | "amber" | "rose";
  active: boolean;
  onClick: () => void;
}) {
  const ring = {
    emerald: "ring-emerald-300",
    amber: "ring-amber-300",
    rose: "ring-rose-300",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-elevated",
        active && `ring-2 ${ring}`
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
          {icon}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="text-lg font-semibold">{count}</p>
        </div>
      </div>
    </button>
  );
}

function FindingCard({ finding }: { finding: CodeFinding }) {
  const tone = {
    triangulated: "border-emerald-300 bg-emerald-50/40 dark:bg-emerald-900/10",
    partial: "border-amber-300 bg-amber-50/40 dark:bg-amber-900/10",
    single_source: "border-rose-300 bg-rose-50/40 dark:bg-rose-900/10",
  }[finding.tier];

  const tierLabel = {
    triangulated: "Triangulado",
    partial: "Parcial",
    single_source: "Fuente única",
  }[finding.tier];

  return (
    <Card className={cn("flex flex-col gap-2 px-4 py-3", tone)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: finding.codeColor }}
          />
          <p className="truncate text-sm font-semibold">{finding.codeName}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            finding.tier === "triangulated" && "border-emerald-400 text-emerald-700 dark:text-emerald-300",
            finding.tier === "partial" && "border-amber-400 text-amber-700 dark:text-amber-300",
            finding.tier === "single_source" && "border-rose-400 text-rose-700 dark:text-rose-300"
          )}
        >
          {tierLabel}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <FileText className="h-3 w-3" />
          {finding.totalQuotations} citas en {finding.documents.length} doc
          {finding.documents.length === 1 ? "" : "s"}
        </span>
        <span className="inline-flex items-center gap-1">
          <Boxes className="h-3 w-3" />
          {finding.groups.length} grupo{finding.groups.length === 1 ? "" : "s"}
        </span>
        <span className="inline-flex items-center gap-1">
          <Users className="h-3 w-3" />
          {finding.actorValues.length} actor
          {finding.actorValues.length === 1 ? "" : "es"}
        </span>
      </div>
      {finding.actorValues.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {finding.actorValues.slice(0, 6).map((v) => (
            <span
              key={v}
              className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium"
            >
              {v}
            </span>
          ))}
          {finding.actorValues.length > 6 ? (
            <span className="text-[10px] text-muted-foreground">
              +{finding.actorValues.length - 6}
            </span>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
