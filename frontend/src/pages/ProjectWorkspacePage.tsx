import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  FileText,
  Tags,
  Quote,
  NotebookPen,
  Network as NetworkIcon,
  LayoutGrid,
  Users,
  ShieldCheck,
  Search,
  BarChart3,
  Folders,
  Activity,
  Microscope,
  Sparkles,
} from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useProject } from "@/hooks/useProjects";
import { useMyRole } from "@/hooks/useMembers";
import type { ProjectRole } from "@/types/database";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";
import { CodebookPanel } from "@/components/codes/CodebookPanel";
import { CodeDocumentMatrix } from "@/components/codes/CodeDocumentMatrix";
import { QuotationsPanel } from "@/components/quotations/QuotationsPanel";
import { MemosPanel } from "@/components/memos/MemosPanel";
import { CodeNetworkPanel } from "@/components/network/CodeNetworkPanel";
import { FloatingChatWidget } from "@/components/ai/FloatingChatWidget";
import { MembersPanelGate } from "@/components/projects/MembersPanel";
import { ExportButton } from "@/components/projects/ExportButton";
import { AgreementPanel } from "@/components/agreement/AgreementPanel";
import { QueryBuilderPanel } from "@/components/query/QueryBuilderPanel";
import { TextAnalysisPanel } from "@/components/analysis/TextAnalysisPanel";
import { DocumentGroupsPanel } from "@/components/documents/DocumentGroupsPanel";
import { ActivityLogPanel } from "@/components/activity/ActivityLogPanel";
import { GlobalSearchDialog } from "@/components/search/GlobalSearchDialog";
import { ActivityBar, type ActivityBarItem } from "@/components/layout/ActivityBar";
import { WorkspaceCanvas } from "@/components/layout/WorkspaceCanvas";
import { cn } from "@/lib/utils";

const VALID_TABS = [
  "documents",
  "groups",
  "codes",
  "quotations",
  "matrix",
  "memos",
  "network",
  "query",
  "analysis",
  "agreement",
  "activity",
  "members",
] as const;
type TabId = (typeof VALID_TABS)[number];

const ROLE_LABELS: Record<ProjectRole, string> = {
  owner: "Propietario",
  admin: "Admin",
  coder: "Codificador",
  viewer: "Solo lectura",
};

const TAB_TITLES: Record<TabId, { title: string; subtitle: string }> = {
  documents: {
    title: "Documentos",
    subtitle: "Tu corpus: textos, PDFs, imágenes, audio y video.",
  },
  groups: {
    title: "Grupos de documentos",
    subtitle: "Organiza el corpus en cohortes comparables.",
  },
  codes: {
    title: "Codebook",
    subtitle: "Tu sistema de códigos jerárquico.",
  },
  quotations: {
    title: "Citas",
    subtitle: "Fragmentos codificados en todos tus documentos.",
  },
  matrix: {
    title: "Matriz código × documento",
    subtitle: "Densidad de codificación a lo largo del corpus.",
  },
  memos: { title: "Memos", subtitle: "Tu bitácora analítica reflexiva." },
  network: {
    title: "Redes conceptuales",
    subtitle: "Mapas visuales de relaciones entre entidades.",
  },
  query: {
    title: "Constructor de consultas",
    subtitle: "Recupera evidencia con operadores lógicos.",
  },
  analysis: {
    title: "Análisis de texto",
    subtitle: "Frecuencias, KWIC, co-ocurrencias y sentimiento.",
  },
  agreement: {
    title: "Acuerdo intercodificadores",
    subtitle: "Mide consistencia entre coders del proyecto.",
  },
  activity: { title: "Actividad", subtitle: "Bitácora de cambios del proyecto." },
  members: { title: "Miembros", subtitle: "Equipo y permisos." },
};

export default function ProjectWorkspacePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading } = useProject(projectId);
  const { data: myRole } = useMyRole(projectId);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") ?? "documents";
  const tab = (VALID_TABS as readonly string[]).includes(tabParam)
    ? (tabParam as TabId)
    : "documents";

  function setTab(next: TabId) {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        sp.set("tab", next);
        return sp;
      },
      { replace: true }
    );
  }

  useEffect(() => {
    if (project) document.title = `${project.name} — PHDBuddy`;
    return () => {
      document.title = "PHDBuddy";
    };
  }, [project]);

  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      } else if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searchOpen]);

  const items = useMemo<ActivityBarItem<TabId>[]>(
    () => [
      { id: "documents", label: "Documentos", icon: FileText, tone: "violet" },
      { id: "groups", label: "Grupos", icon: Folders, tone: "violet" },
      { id: "codes", label: "Codebook", icon: Tags, tone: "amber" },
      { id: "quotations", label: "Citas", icon: Quote, tone: "amber" },
      { id: "memos", label: "Memos", icon: NotebookPen, tone: "amber" },
      { id: "matrix", label: "Matriz", icon: LayoutGrid, tone: "emerald" },
      { id: "network", label: "Redes", icon: NetworkIcon, tone: "emerald" },
      { id: "query", label: "Consultas", icon: Search, tone: "emerald" },
      { id: "analysis", label: "Análisis", icon: BarChart3, tone: "emerald" },
      {
        id: "agreement",
        label: "Acuerdo",
        icon: ShieldCheck,
        tone: "rose",
      },
      { id: "activity", label: "Actividad", icon: Activity, tone: "default" },
      { id: "members", label: "Miembros", icon: Users, tone: "default" },
    ],
    []
  );

  if (isLoading || !project) {
    return (
      <div className="flex min-h-0 flex-1">
        <div className="w-14 shrink-0 border-r border-border surface-sidebar" />
        <div className="flex-1 px-6 py-8">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="mt-4 h-5 w-96" />
          <Skeleton className="mt-8 h-[60vh] w-full" />
        </div>
      </div>
    );
  }

  if (!projectId) return null;

  const titleInfo = TAB_TITLES[tab];

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <ActivityBar items={items} active={tab} onSelect={setTab} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Project context strip */}
        <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-background px-5 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background"
                style={{ backgroundColor: project.color ?? undefined }}
                aria-hidden
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-lg font-semibold tracking-tight">
                    {project.name}
                  </h1>
                  {myRole && myRole !== "owner" ? (
                    <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {ROLE_LABELS[myRole]}
                    </span>
                  ) : null}
                </div>
                {project.research_question ? (
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/70">
                      Pregunta:
                    </span>{" "}
                    {project.research_question}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <StatPill icon={FileText} value={project.document_count} label="docs" />
              <StatPill icon={Tags} value={project.code_count} label="cód." />
              <StatPill icon={Quote} value={project.quotation_count} label="citas" />
              <StatPill icon={NotebookPen} value={project.memo_count} label="memos" />

              <div className="mx-1 h-5 w-px bg-border" aria-hidden />

              <Button
                variant="outline"
                size="sm"
                onClick={() => setSearchOpen(true)}
                className="h-8 gap-1.5"
                title="Buscar en el proyecto (Ctrl/Cmd+K)"
              >
                <Search className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Buscar</span>
                <kbd className="ml-1 hidden text-[10px] sm:inline-flex">⌘K</kbd>
              </Button>
              <ExportButton projectId={projectId} />
            </div>
          </div>
        </div>

        {/* Section header — title + subtitle for the active tab */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-surface-2 px-5 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <SectionIcon tab={tab} />
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold leading-tight">
                {titleInfo.title}
              </h2>
              <p className="truncate text-[11px] text-muted-foreground">
                {titleInfo.subtitle}
              </p>
            </div>
          </div>
        </div>

        {/* Active panel canvas */}
        <WorkspaceCanvas bleed={tab === "network" || tab === "matrix"}>
          <PanelOutlet tab={tab} projectId={projectId} />
        </WorkspaceCanvas>
      </div>

      <GlobalSearchDialog
        projectId={projectId}
        open={searchOpen}
        onOpenChange={setSearchOpen}
      />
      <FloatingChatWidget projectId={projectId} />
    </div>
  );
}

function PanelOutlet({ tab, projectId }: { tab: TabId; projectId: string }) {
  // We render every panel directly so each owns its scroll. Keep this
  // exhaustive — the union enforces all branches at compile time.
  switch (tab) {
    case "documents":
      return <DocumentsPanel projectId={projectId} />;
    case "groups":
      return <DocumentGroupsPanel projectId={projectId} />;
    case "codes":
      return <CodebookPanel projectId={projectId} />;
    case "quotations":
      return <QuotationsPanel projectId={projectId} />;
    case "matrix":
      return <CodeDocumentMatrix projectId={projectId} />;
    case "memos":
      return <MemosPanel projectId={projectId} />;
    case "network":
      return <CodeNetworkPanel projectId={projectId} />;
    case "query":
      return <QueryBuilderPanel projectId={projectId} />;
    case "analysis":
      return <TextAnalysisPanel projectId={projectId} />;
    case "agreement":
      return <AgreementPanel projectId={projectId} />;
    case "activity":
      return <ActivityLogPanel projectId={projectId} />;
    case "members":
      return <MembersPanelGate projectId={projectId} />;
    default: {
      const _never: never = tab;
      void _never;
      return null;
    }
  }
}

function StatPill({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs",
        "text-muted-foreground"
      )}
      title={`${value} ${label}`}
    >
      <Icon className="h-3.5 w-3.5 text-primary" />
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
      <span>{label}</span>
    </span>
  );
}

function SectionIcon({ tab }: { tab: TabId }) {
  const map: Record<TabId, React.ComponentType<{ className?: string }>> = {
    documents: FileText,
    groups: Folders,
    codes: Tags,
    quotations: Quote,
    matrix: LayoutGrid,
    memos: NotebookPen,
    network: NetworkIcon,
    query: Search,
    analysis: BarChart3,
    agreement: ShieldCheck,
    activity: Activity,
    members: Users,
  };
  const Icon = map[tab] ?? Microscope;
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
      <Icon className="h-3.5 w-3.5" />
      <span className="sr-only">
        <Sparkles className="hidden" />
      </span>
    </div>
  );
}
