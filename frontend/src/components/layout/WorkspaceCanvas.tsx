import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface Props {
  /** Optional toolbar rendered as a sticky strip on top of the canvas. */
  toolbar?: ReactNode;
  /** Main scrollable body. */
  children: ReactNode;
  /**
   * When true the canvas does not pad the content — useful for editors
   * that need to claim every pixel (network graph, PDF viewer, etc.).
   */
  bleed?: boolean;
  className?: string;
  /** Optional secondary right rail (e.g. inspector / details). */
  aside?: ReactNode;
  asideWidth?: number;
}

/**
 * The canonical "right side" of the workspace: a column with an
 * optional toolbar at the top, a scroll-controlled body, and an
 * optional aside docked to the right edge. It owns the height and
 * makes sure the body never bleeds past the viewport — important for
 * the IDE-style shell where every panel must scroll on its own.
 */
export function WorkspaceCanvas({
  toolbar,
  children,
  bleed = false,
  className,
  aside,
  asideWidth = 360,
}: Props) {
  return (
    <section className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        {toolbar ? (
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur">
            {toolbar}
          </div>
        ) : null}
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            bleed ? "" : "px-5 py-5 sm:px-6 sm:py-6",
            className
          )}
        >
          {children}
        </div>
      </div>
      {aside ? (
        <aside
          className="hidden shrink-0 border-l border-border surface-2 lg:flex lg:flex-col"
          style={{ width: asideWidth }}
        >
          {aside}
        </aside>
      ) : null}
    </section>
  );
}
