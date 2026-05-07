import { Plus, Layers, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { NewProjectDialog } from "@/components/projects/NewProjectDialog";
import { ImportProjectButton } from "@/components/projects/ImportProjectButton";
import { ImportSurveyButton } from "@/components/projects/ImportSurveyButton";
import { useProjects } from "@/hooks/useProjects";

export default function ProjectsPage() {
  const { data: projects, isLoading } = useProjects();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2">
      {/* Hero / page header on a clean canvas. */}
      <div className="border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-end justify-between gap-4 px-5 py-8 sm:px-6 lg:px-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Tus proyectos</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Cada proyecto guarda sus propios documentos, codebook, citas y
              memos. Crea tantos como necesites para tu tesis o tu equipo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ImportSurveyButton />
            <ImportProjectButton />
            <NewProjectDialog
              trigger={
                <Button size="lg" className="shadow-soft">
                  <Plus className="mr-2 h-4 w-4" />
                  Nuevo proyecto
                </Button>
              }
            />
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 lg:px-8">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 w-full" />
            ))}
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border-2 border-dashed border-border bg-background/60 px-6 py-20 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-4 ring-primary/5">
        <Layers className="h-7 w-7 text-primary" />
      </div>
      <h2 className="mt-5 text-xl font-semibold">Empieza tu primer proyecto</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Un proyecto es tu estudio de investigación. Sube fuentes, construye un
        codebook, anota citas y deja que la IA descubra temas en tus datos.
      </p>
      <NewProjectDialog
        trigger={
          <Button size="lg" className="mt-6 shadow-soft">
            <Sparkles className="mr-2 h-4 w-4" />
            Crear mi primer proyecto
          </Button>
        }
      />
    </div>
  );
}
