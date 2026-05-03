import { useState, type FormEvent } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { GoogleButton } from "./GoogleButton";

export function LoginForm() {
  const { signInWithEmail, signInWithGoogle, signInAnonymously } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/app/projects";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signInWithEmail(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo iniciar sesión",
        description: err instanceof Error ? err.message : "Inténtalo de nuevo.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    try {
      await signInWithGoogle();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falló el inicio de sesión con Google",
        description: err instanceof Error ? err.message : "Inténtalo de nuevo.",
      });
    }
  }

  async function handleGuest() {
    setGuestLoading(true);
    try {
      await signInAnonymously();
      navigate(from, { replace: true });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falló el acceso de prueba",
        description: err instanceof Error ? err.message : "Inténtalo de nuevo.",
      });
    } finally {
      setGuestLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={handleGuest}
        disabled={submitting || guestLoading}
      >
        {guestLoading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="mr-2 h-4 w-4" />
        )}
        Probar sin registro
      </Button>
      <p className="-mt-4 text-center text-xs text-muted-foreground">
        Crea un espacio de prueba al instante. Podrás convertirlo en una cuenta permanente más tarde.
      </p>

      <GoogleButton onClick={handleGoogle} disabled={submitting} />

      <div className="relative">
        <Separator />
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs uppercase text-muted-foreground">
          o
        </span>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="email">Correo electrónico</Label>
          <Input
            id="email"
            type="email"
            placeholder="tu@universidad.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Iniciar sesión
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        ¿Aún no tienes cuenta?{" "}
        <Link to="/signup" className="font-medium text-primary hover:underline">
          Crear cuenta
        </Link>
      </p>
    </div>
  );
}
