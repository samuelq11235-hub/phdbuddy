import { Outlet, useLocation } from "react-router-dom";

import { TopNav } from "./TopNav";

/**
 * The application shell hosts every authenticated route. It is a single
 * column that owns the viewport height — the top nav stays fixed at the
 * top, and the `<main>` underneath fills the remaining space. We pass
 * `min-h-0` so children that opt into full-height flex layouts (the
 * project workspace and the document viewer) can do so without bleeding
 * past the viewport. List-style pages (projects, settings) handle their
 * own internal scrolling via the `overflow-y-auto` wrapper they render.
 */
export function AppShell() {
  const { pathname } = useLocation();
  // The top nav becomes "compact" inside the workspace and document
  // viewer to maximise vertical canvas for analysis work. The list
  // pages keep the slightly taller branded header.
  const isWorkspace = /\/app\/p\//.test(pathname);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TopNav compact={isWorkspace} />
      <main className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
