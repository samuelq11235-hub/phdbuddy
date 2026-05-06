import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { GoogleButton } from "./GoogleButton";

// Mirrors LoginForm — see comment there.
const POST_AUTH_REDIRECT_KEY = "phdbuddy.postAuthRedirect";

export function SignupForm() {
  const { signUpWithEmail, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const nextParam = searchParams.get("next");
  const next = nextParam ?? "/app/projects";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast({
        variant: "destructive",
        title: "Contraseña demasiado corta",
        description: "Usa al menos 8 caracteres.",
      });
      return;
    }
    setSubmitting(true);
    try {
      await signUpWithEmail(email, password, fullName.trim() || undefined);
      toast({
        title: "Te damos la bienvenida a PHDBuddy",
        description: "Tu cuenta se ha creado correctamente.",
      });
      navigate(next, { replace: true });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo crear la cuenta",
        description: err instanceof Error ? err.message : "Inténtalo de nuevo.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    try {
      if (nextParam) {
        sessionStorage.setItem(POST_AUTH_REDIRECT_KEY, nextParam);
      }
      await signInWithGoogle();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falló el inicio de sesión con Google",
        description: err instanceof Error ? err.message : "Inténtalo de nuevo.",
      });
    }
  }

  return (
    <div className="space-y-6">
      <GoogleButton onClick={handleGoogle} disabled={submitting} label="Registrarse con Google" />

      <div className="relative">
        <Separator />
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs uppercase text-muted-foreground">
          o
        </span>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="fullName">Nombre completo</Label>
          <Input
            id="fullName"
            type="text"
            placeholder="Ada Lovelace"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
          />
        </div>
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
            minLength={8}
            autoComplete="new-password"
          />
          <p className="text-xs text-muted-foreground">Al menos 8 caracteres.</p>
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Crear cuenta
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        ¿Ya tienes cuenta?{" "}
        <Link
          to={nextParam ? `/login?next=${encodeURIComponent(nextParam)}` : "/login"}
          className="font-medium text-primary hover:underline"
        >
          Iniciar sesión
        </Link>
      </p>
    </div>
  );
}
