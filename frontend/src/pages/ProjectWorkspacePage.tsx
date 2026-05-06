import { useEffect } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import {
  FileText,
  Tags,
  Quote,
  NotebookPen,
  Network as NetworkIcon,
  Sparkles,
  ArrowLeft,
  LayoutGrid,
  Users,
  ShieldCheck,
  Search,
  BarChart3,
  Folders,
  Activity,
} from "lucide-react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import { ChatPanel } from "@/components/ai/ChatPanel";
import { MembersPanelGate } from "@/components/projects/MembersPanel";
import { ExportButton } from "@/components/projects/ExportButton";
import { AgreementPanel } from "@/components/agreement/AgreementPanel";
import { QueryBuilderPanel } from "@/components/query/QueryBuilderPanel";
import { TextAnalysisPanel } from "@/components/analysis/TextAnalysisPanel";
import { DocumentGroupsPanel } from "@/components/documents/DocumentGroupsPanel";
import { ActivityLogPanel } from "@/components/activity/ActivityLogPanel";

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
  "chat",
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

export default function ProjectWorkspacePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading } = useProject(projectId);
  const { data: myRole } = useMyRole(projectId);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") ?? "documents";
  const tab = (VALID_TABS as readonly string[]).includes(tabParam) ? (tabParam as TabId) : "documents";

  function setTab(next: TabId) {
    setSearchParams((prev) => {
      const sp = new URLSearchParams(prev);
      sp.set("tab", next);
      return sp;
    });
  }

  useEffect(() => {
    if (project) document.title = `${project.name} — PHDBuddy`;
    return () => {
      document.title = "PHDBuddy";
    };
  }, [project]);

  if (isLoading || !project) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="mt-4 h-6 w-96" />
        <Skeleton className="mt-8 h-96 w-full" />
      </div>
    );
  }

  if (!projectId) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2 text-muted-foreground">
        <Link to="/app/projects">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Todos los proyectos
        </Link>
      </Button>

      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span
              className="inline-block h-3 w-3 flex-shrink-0 rounded-full"
              style={{ backgroundColor: project.color }}
            />
            <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
          </div>
          {project.research_question && (
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              <span className="font-medium">Pregunta:</span> {project.research_question}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {project.methodology && (
              <span className="inline-flex rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {project.methodology}
              </span>
            )}
            {myRole && myRole !== "owner" && (
              <span className="inline-flex rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {ROLE_LABELS[myRole]}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <Stat label="docs" value={project.document_count} icon={FileText} />
          <Stat label="códigos" value={project.code_count} icon={Tags} />
          <Stat label="citas" value={project.quotation_count} icon={Quote} />
          <Stat label="memos" value={project.memo_count} icon={NotebookPen} />
          <ExportButton projectId={projectId} />
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
        <TabsList className="flex w-full flex-wrap justify-start gap-1 bg-transparent p-0">
          <TabTrigger value="documents" icon={FileText}>Documentos</TabTrigger>
          <TabTrigger value="groups" icon={Folders}>Grupos</TabTrigger>
          <TabTrigger value="codes" icon={Tags}>Codebook</TabTrigger>
          <TabTrigger value="quotations" icon={Quote}>Citas</TabTrigger>
          <TabTrigger value="matrix" icon={LayoutGrid}>Matriz</TabTrigger>
          <TabTrigger value="memos" icon={NotebookPen}>Memos</TabTrigger>
          <TabTrigger value="network" icon={NetworkIcon}>Red</TabTrigger>
          <TabTrigger value="query" icon={Search}>Consultas</TabTrigger>
          <TabTrigger value="analysis" icon={BarChart3}>Análisis</TabTrigger>
          <TabTrigger value="chat" icon={Sparkles}>Chat IA</TabTrigger>
          <TabTrigger value="agreement" icon={ShieldCheck}>Acuerdo</TabTrigger>
          <TabTrigger value="activity" icon={Activity}>Actividad</TabTrigger>
          <TabTrigger value="members" icon={Users}>Miembros</TabTrigger>
        </TabsList>

        <div className="mt-6">
          <TabsContent value="documents">
            <DocumentsPanel projectId={projectId} />
          </TabsContent>
          <TabsContent value="groups">
            <DocumentGroupsPanel projectId={projectId} />
          </TabsContent>
          <TabsContent value="analysis">
            <TextAnalysisPanel projectId={projectId} />
          </TabsContent>
          <TabsContent value="codes">
            <CodebookPanel projectId={projectId} />
          </TabsContent>
          <TabsContent value="quotations">
            <QuotationsPanel projectId={projectId} />
          </TabsContent>
          <TabsContent value="matrix">
            <CodeDocumentMatrix projectId={projectId} />
          </TabsContent>
          <TabsContent value="memos">
            <MemosPanel projectId={projectId} />
          </TabsContent>
          <TabsContent value="network">
            <CodeNetworkPanel projectId={projectId} />
          </TabsContent>
          <TabsContent value="query">
            <QueryBuilderPanel projectId={projectId} />
          </TabsContent>
          <TabsContent value="chat">
            <ChatPanel projectId={projectId} />
          </TabsContent>
          <TabsContent value="agreement">
            <AgreementPanel projectId={projectId} />
          </TabsContent>
          <TabsContent value="activity">
            <ActivityLogPanel projectId={projectId} />
          </TabsContent>
          <TabsContent value="members">
            <MembersPanelGate projectId={projectId} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function TabTrigger({
  value,
  children,
  icon: Icon,
}: {
  value: string;
  children: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <TabsTrigger
      value={value}
      className="rounded-md border border-transparent px-3 py-1.5 text-sm font-medium data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:text-primary"
    >
      <Icon className="mr-1.5 h-3.5 w-3.5" />
      {children}
    </TabsTrigger>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1">
      <Icon className="h-3.5 w-3.5 text-primary" />
      <span className="font-semibold text-foreground">{value}</span>
      <span>{label}</span>
    </span>
  );
}
