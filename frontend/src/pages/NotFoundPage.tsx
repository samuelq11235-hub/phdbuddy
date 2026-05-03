import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-4 text-center">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight">Página no encontrada</h1>
      <p className="mt-2 text-muted-foreground">
        La página que buscas no existe o fue movida.
      </p>
      <div className="mt-6 flex gap-2">
        <Button asChild variant="outline">
          <Link to="/">Inicio</Link>
        </Button>
        <Button asChild>
          <Link to="/app/projects">Ir a mis proyectos</Link>
        </Button>
      </div>
    </div>
  );
}
