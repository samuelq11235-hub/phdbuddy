// Compact selector to attach a theoretical framework to the project.
// The selection is a soft-influence: the framework's `prompt_addendum`
// is appended to every Claude call (auto-coding, summaries, networks,
// thesis copilot) so the AI speaks the same analytical dialect as the
// researcher. Hidden from read-only roles.
import { useMemo, useState } from "react";
import { Brain, Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useSetProjectFramework,
  useTheoryFrameworks,
} from "@/hooks/useTheoryFrameworks";
import { cn } from "@/lib/utils";
import type { TheoryFramework } from "@/types/database";

interface Props {
  projectId: string;
  activeFrameworkId: string | null;
  canEdit: boolean;
}

export function TheoryFrameworkSelector({
  projectId,
  activeFrameworkId,
  canEdit,
}: Props) {
  const { data: frameworks } = useTheoryFrameworks(projectId);
  const setFramework = useSetProjectFramework();
  const [open, setOpen] = useState(false);

  const active = useMemo<TheoryFramework | null>(() => {
    if (!frameworks || !activeFrameworkId) return null;
    return frameworks.find((f) => f.id === activeFrameworkId) ?? null;
  }, [frameworks, activeFrameworkId]);

  if (!canEdit && !active) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 max-w-[220px] gap-1.5"
          disabled={!canEdit}
          title={
            active
              ? `Marco activo: ${active.name}`
              : "Elige un marco analítico (Grounded Theory, IPA, CDA…)"
          }
        >
          <Brain className="h-3.5 w-3.5 text-violet-500" />
          <span className="truncate text-xs">
            {active ? active.name : "Marco analítico"}
          </span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[360px] p-0">
        <div className="border-b border-border px-3 py-2">
          <p className="text-xs font-semibold text-foreground">
            Marco teórico del proyecto
          </p>
          <p className="text-[11px] text-muted-foreground">
            Influye en la voz del AI (codificación, resúmenes, redes, copilot
            de tesis).
          </p>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          <FrameworkOption
            label="Sin marco"
            description="Codificación abierta sin compromiso teórico previo."
            isActive={!activeFrameworkId}
            onSelect={async () => {
              await setFramework.mutateAsync({ projectId, frameworkId: null });
              setOpen(false);
            }}
          />
          {(frameworks ?? []).map((fw) => (
            <FrameworkOption
              key={fw.id}
              label={fw.name}
              description={fw.description ?? undefined}
              citation={fw.citation ?? undefined}
              isActive={fw.id === activeFrameworkId}
              onSelect={async () => {
                await setFramework.mutateAsync({
                  projectId,
                  frameworkId: fw.id,
                });
                setOpen(false);
              }}
            />
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FrameworkOption({
  label,
  description,
  citation,
  isActive,
  onSelect,
}: {
  label: string;
  description?: string;
  citation?: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2 border-b border-border px-3 py-2.5 text-left text-xs transition-colors last:border-b-0 hover:bg-muted/60",
        isActive && "bg-muted/40"
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          isActive
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border"
        )}
      >
        {isActive ? <Check className="h-3 w-3" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {description ? (
          <span className="block text-[11px] text-muted-foreground">
            {description}
          </span>
        ) : null}
        {citation ? (
          <span className="mt-1 block font-mono text-[10px] text-muted-foreground/80">
            {citation}
          </span>
        ) : null}
      </span>
    </button>
  );
}
