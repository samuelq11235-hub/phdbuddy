import { Link } from "react-router-dom";
import { FileText, Tags, Quote, MoreVertical, Trash2 } from "lucide-react";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDeleteProject } from "@/hooks/useProjects";
import { useToast } from "@/hooks/use-toast";
import type { Project, ProjectRole, ProjectWithRole } from "@/types/database";

const ROLE_LABELS: Record<ProjectRole, string> = {
  owner: "Propietario",
  admin: "Admin",
  coder: "Codificador",
  viewer: "Solo lectura",
};

export function ProjectCard({ project }: { project: Project | ProjectWithRole }) {
  const deleteProject = useDeleteProject();
  const { toast } = useToast();
  // `role` is present on rows from `useProjects()` (RPC) but absent on the
  // legacy `Project` shape that other call sites still pass — fall back to
  // owner so older code paths don't accidentally hide the delete CTA.
  const role: ProjectRole = ("role" in project && project.role) || "owner";
  const canDelete = role === "owner";

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (
      !confirm(
        `¿Eliminar "${project.name}"? Esto borrará permanentemente sus documentos, códigos y citas.`
      )
    )
      return;
    try {
      await deleteProject.mutateAsync(project.id);
      toast({ title: "Proyecto eliminado" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo eliminar",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <Card className="group relative overflow-hidden transition-all hover:shadow-md">
      <Link to={`/app/p/${project.id}`} className="block">
        <div className="h-1.5 w-full" style={{ backgroundColor: project.color }} />
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <CardTitle className="line-clamp-1 text-lg">{project.name}</CardTitle>
              {project.research_question && (
                <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
                  {project.research_question}
                </p>
              )}
            </div>
            {role !== "owner" && (
              <span className="flex-shrink-0 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {ROLE_LABELS[role]}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          {project.methodology && (
            <span className="inline-flex rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {project.methodology}
            </span>
          )}
        </CardContent>
        <CardFooter className="flex items-center gap-4 border-t bg-muted/20 py-2.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            {project.document_count} {pluralize("doc", "docs", project.document_count)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Tags className="h-3.5 w-3.5" />
            {project.code_count} {pluralize("código", "códigos", project.code_count)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Quote className="h-3.5 w-3.5" />
            {project.quotation_count} {pluralize("cita", "citas", project.quotation_count)}
          </span>
        </CardFooter>
      </Link>

      {canDelete && (
        <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={(e) => e.preventDefault()}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                Eliminar proyecto
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </Card>
  );
}

function pluralize(singular: string, plural: string, n: number) {
  return n === 1 ? singular : plural;
}
