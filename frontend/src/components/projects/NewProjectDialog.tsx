import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateProject } from "@/hooks/useProjects";
import { useToast } from "@/hooks/use-toast";

const PROJECT_COLORS = [
  "#7C3AED", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444",
  "#EC4899", "#14B8A6", "#8B5CF6", "#6366F1", "#F97316",
];

const METHODOLOGIES = [
  "Teoría Fundamentada",
  "Análisis Temático",
  "Análisis de Contenido",
  "Fenomenología",
  "Análisis del Discurso",
  "Análisis Narrativo",
  "Estudio de Caso",
  "Métodos Mixtos",
  "Otro",
];

export function NewProjectDialog({ trigger }: { trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [researchQuestion, setResearchQuestion] = useState("");
  const [methodology, setMethodology] = useState<string>("Análisis Temático");
  const [color, setColor] = useState(PROJECT_COLORS[0]);

  const createProject = useCreateProject();
  const { toast } = useToast();
  const navigate = useNavigate();

  function reset() {
    setName("");
    setDescription("");
    setResearchQuestion("");
    setMethodology("Análisis Temático");
    setColor(PROJECT_COLORS[0]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const project = await createProject.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        research_question: researchQuestion.trim() || null,
        methodology: methodology === "Otro" ? null : methodology,
        color,
      });
      toast({ title: "Proyecto creado", description: project.name });
      setOpen(false);
      reset();
      navigate(`/app/p/${project.id}`);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo crear el proyecto",
        description: err instanceof Error ? err.message : "Inténtalo más tarde.",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button>Nuevo proyecto</Button>}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Nuevo proyecto de investigación</DialogTitle>
            <DialogDescription>
              Dale contexto a tu proyecto para que la IA de PHDBuddy fundamente
              sus sugerencias en tu pregunta de investigación.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="project-name">Nombre del proyecto</Label>
            <Input
              id="project-name"
              placeholder="p. ej., Burnout en personal de enfermería novel"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-question">Pregunta de investigación</Label>
            <Textarea
              id="project-question"
              placeholder="¿Cuál es la pregunta principal que tu estudio busca responder?"
              value={researchQuestion}
              onChange={(e) => setResearchQuestion(e.target.value)}
              rows={2}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Metodología</Label>
              <Select value={methodology} onValueChange={setMethodology}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODOLOGIES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-1.5">
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    onClick={() => setColor(c)}
                    className="h-7 w-7 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      borderColor: color === c ? "white" : "transparent",
                      outline: color === c ? `2px solid ${c}` : undefined,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-desc">Descripción (opcional)</Label>
            <Textarea
              id="project-desc"
              placeholder="Notas breves sobre alcance, participantes, cronograma..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">Cancelar</Button>
            </DialogClose>
            <Button type="submit" disabled={createProject.isPending || !name.trim()}>
              {createProject.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Crear proyecto
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
