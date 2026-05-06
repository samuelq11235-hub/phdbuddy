import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { importProject } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

export function ImportProjectButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  function handleClick() {
    inputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be re-selected if needed.
    e.target.value = "";

    if (!file.name.endsWith(".qdpx")) {
      toast({
        variant: "destructive",
        title: "Formato incorrecto",
        description: "Solo se aceptan archivos .qdpx (REFI-QDA).",
      });
      return;
    }

    setLoading(true);
    try {
      const resp = await importProject(file);
      toast({
        title: "Proyecto importado",
        description: `"${resp.projectName}" — ${resp.imported.codes} códigos, ${resp.imported.quotations} citas, ${resp.imported.memos} memos.`,
      });
      qc.invalidateQueries({ queryKey: ["projects", user?.id] });
      navigate(`/app/p/${resp.projectId}`);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error al importar",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".qdpx"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button variant="outline" onClick={handleClick} disabled={loading}>
        {loading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Upload className="mr-2 h-4 w-4" />
        )}
        Importar .qdpx
      </Button>
    </>
  );
}
