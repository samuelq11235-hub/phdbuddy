import { NavLink, useLocation, useParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";

import { Logo, LogoMark } from "@/components/Logo";
import { useProject } from "@/hooks/useProjects";
import { useDocument } from "@/hooks/useDocuments";
import { cn } from "@/lib/utils";

import { UserMenu } from "./UserMenu";

interface Props {
  /**
   * Compact mode shrinks the bar to 44px and replaces the project nav
   * with a breadcrumb tied to the URL params, freeing pixels for the
   * full-screen workspace canvas.
   */
  compact?: boolean;
}

export function TopNav({ compact = false }: Props) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-border bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/65 sm:px-5",
        compact ? "h-12" : "h-14"
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {compact ? (
          <NavLink
            to="/app/projects"
            aria-label="Ir al panel de proyectos"
            className="rounded-md p-1 transition-colors hover:bg-accent"
          >
            <LogoMark className="h-6 w-6" />
          </NavLink>
        ) : (
          <Logo to="/app/projects" />
        )}

        {compact ? (
          <Breadcrumbs />
        ) : (
          <nav className="hidden items-center gap-0.5 sm:flex">
            <TopLink to="/app/projects">Proyectos</TopLink>
            <TopLink to="/app/settings">Ajustes</TopLink>
          </nav>
        )}
      </div>

      <div className="flex items-center gap-2">
        <UserMenu />
      </div>
    </header>
  );
}

function Breadcrumbs() {
  const params = useParams<{ projectId?: string; documentId?: string }>();
  const { pathname } = useLocation();
  const isDocView = /\/d\//.test(pathname);
  const { data: project } = useProject(params.projectId);
  const { data: document } = useDocument(isDocView ? params.documentId : undefined);

  return (
    <ol className="flex min-w-0 items-center gap-1.5 text-sm">
      <li className="shrink-0">
        <NavLink
          to="/app/projects"
          className="rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Proyectos
        </NavLink>
      </li>
      {project ? (
        <>
          <li className="shrink-0 text-muted-foreground/60" aria-hidden>
            <ChevronRight className="h-3.5 w-3.5" />
          </li>
          <li className="min-w-0">
            <NavLink
              to={`/app/p/${project.id}`}
              className={({ isActive }) =>
                cn(
                  "flex min-w-0 items-center gap-2 rounded px-1.5 py-0.5 transition-colors hover:bg-accent",
                  isActive && !isDocView ? "text-foreground" : "text-muted-foreground"
                )
              }
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: project.color ?? undefined }}
                aria-hidden
              />
              <span className="truncate font-medium">{project.name}</span>
            </NavLink>
          </li>
          {isDocView && document ? (
            <>
              <li className="shrink-0 text-muted-foreground/60" aria-hidden>
                <ChevronRight className="h-3.5 w-3.5" />
              </li>
              <li className="min-w-0 truncate text-foreground">{document.title}</li>
            </>
          ) : null}
        </>
      ) : null}
    </ol>
  );
}

function TopLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === "/app/projects"}
      className={({ isActive }) =>
        cn(
          "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
          isActive
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )
      }
    >
      {children}
    </NavLink>
  );
}
