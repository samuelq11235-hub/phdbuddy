import { NavLink } from "react-router-dom";

import { Logo } from "@/components/Logo";
import { UserMenu } from "./UserMenu";
import { cn } from "@/lib/utils";

export function TopNav() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-6">
        <Logo to="/app/projects" />
        <nav className="hidden items-center gap-1 sm:flex">
          <TopLink to="/app/projects">Proyectos</TopLink>
          <TopLink to="/app/settings">Ajustes</TopLink>
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <UserMenu />
      </div>
    </header>
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
