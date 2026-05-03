import { Outlet } from "react-router-dom";

import { TopNav } from "./TopNav";

export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
