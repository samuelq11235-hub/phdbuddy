import type { ComponentType, MouseEvent } from "react";

import { cn } from "@/lib/utils";

export interface ActivityBarItem<T extends string> {
  id: T;
  label: string;
  icon: ComponentType<{ className?: string }>;
  shortcut?: string;
  badge?: number | string;
  /** Optional category accent — colors the active indicator and hover glow. */
  tone?: "default" | "violet" | "amber" | "emerald" | "rose";
}

interface Props<T extends string> {
  items: ActivityBarItem<T>[];
  active: T;
  onSelect: (id: T) => void;
  /** Optional extra slot rendered below the items (e.g. settings). */
  footer?: React.ReactNode;
}

/**
 * Vertical activity rail rendered on the left edge of the workspace,
 * inspired by IDE shells (VS Code, Linear, Cursor). Each item is an
 * icon-only button with a tooltip, an active indicator on the leading
 * edge, and a keyboard-friendly hit-target. Tone is a category accent
 * mostly used to differentiate the panel groups visually.
 */
export function ActivityBar<T extends string>({
  items,
  active,
  onSelect,
  footer,
}: Props<T>) {
  return (
    <nav
      aria-label="Secciones del proyecto"
      className="flex h-full w-14 shrink-0 flex-col border-r border-border surface-sidebar"
    >
      <ul className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-3">
        {items.map((item) => (
          <li key={item.id}>
            <RailButton item={item} active={active === item.id} onSelect={onSelect} />
          </li>
        ))}
      </ul>
      {footer ? (
        <div className="flex flex-col items-center gap-1 border-t border-border py-3">
          {footer}
        </div>
      ) : null}
    </nav>
  );
}

function RailButton<T extends string>({
  item,
  active,
  onSelect,
}: {
  item: ActivityBarItem<T>;
  active: boolean;
  onSelect: (id: T) => void;
}) {
  const Icon = item.icon;
  const tone = item.tone ?? "default";
  const activeBg: Record<NonNullable<ActivityBarItem<T>["tone"]>, string> = {
    default: "bg-primary/10 text-primary",
    violet: "bg-[hsl(262_83%_58%_/0.12)] text-[hsl(262_83%_56%)]",
    amber: "bg-[hsl(38_92%_52%_/0.16)] text-[hsl(35_90%_38%)]",
    emerald: "bg-[hsl(152_65%_38%_/0.14)] text-[hsl(152_65%_30%)]",
    rose: "bg-[hsl(346_85%_55%_/0.12)] text-[hsl(346_85%_50%)]",
  };
  const hover: Record<NonNullable<ActivityBarItem<T>["tone"]>, string> = {
    default: "hover:bg-accent hover:text-foreground",
    violet: "hover:bg-[hsl(262_83%_58%_/0.08)] hover:text-foreground",
    amber: "hover:bg-[hsl(38_92%_52%_/0.1)] hover:text-foreground",
    emerald: "hover:bg-[hsl(152_65%_38%_/0.08)] hover:text-foreground",
    rose: "hover:bg-[hsl(346_85%_55%_/0.08)] hover:text-foreground",
  };

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    onSelect(item.id);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-10 w-10 items-center justify-center rounded-lg text-sidebar-foreground transition-colors",
        active ? activeBg[tone] : hover[tone]
      )}
    >
      {/* Leading active indicator — a subtle vertical bar like VS Code. */}
      <span
        aria-hidden
        className={cn(
          "absolute -left-2.5 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary transition-opacity",
          active ? "opacity-100" : "opacity-0"
        )}
      />
      <Icon className="h-[18px] w-[18px]" />
      {item.badge !== undefined && item.badge !== 0 && item.badge !== "" ? (
        <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
          {item.badge}
        </span>
      ) : null}
    </button>
  );
}
