import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Loader2, Mail, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAcceptInvitation } from "@/hooks/useMembers";
import { useToast } from "@/hooks/use-toast";

// Lifecycle states for the accept-invitation flow:
// • idle      — token captured, waiting for the user to act / for auth.
// • accepting — the edge function is processing.
// • accepted  — success; auto-redirects to the project.
// • error     — surface the message from the edge function.
type Phase = "idle" | "accepting" | "accepted" | "error";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const accept = useAcceptInvitation();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<{
    projectId: string;
    projectName: string | null;
    role: string;
  } | null>(null);

  useEffect(() => {
    if (!token) {
      setPhase("error");
      setErrorMsg("Token de invitación no presente en la URL.");
    }
  }, [token]);

  async function handleAccept() {
    if (!token) return;
    setPhase("accepting");
    setErrorMsg(null);
    try {
      const resp = await accept.mutateAsync(token);
      setAccepted({
        projectId: resp.projectId,
        projectName: resp.projectName,
        role: resp.role,
      });
      setPhase("accepted");
      toast({
        title: "Invitación aceptada",
        description: resp.projectName
          ? `Ahora formas parte de ${resp.projectName}.`
          : "Bienvenida al proyecto.",
      });
      setTimeout(() => navigate(`/app/p/${resp.projectId}`), 1200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error al aceptar la invitación";
      setErrorMsg(message);
      setPhase("error");
    }
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 py-12">
      <div className="w-full rounded-2xl border bg-card p-8 shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Mail className="h-6 w-6 text-primary" />
        </div>
        <h1 className="mt-4 text-center text-2xl font-bold tracking-tight">
          Invitación a un proyecto
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Has sido invitado/a a colaborar en un proyecto de PHDBuddy.
        </p>

        <div className="mt-6">
          {!session ? (
            <UnauthenticatedView token={token} />
          ) : phase === "accepted" && accepted ? (
            <AcceptedView
              projectName={accepted.projectName}
              projectId={accepted.projectId}
              role={accepted.role}
            />
          ) : phase === "error" ? (
            <ErrorView message={errorMsg} onRetry={handleAccept} />
          ) : (
            <Button
              onClick={handleAccept}
              disabled={phase === "accepting"}
              className="w-full"
              size="lg"
            >
              {phase === "accepting" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Aceptando...
                </>
              ) : (
                "Aceptar invitación"
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function UnauthenticatedView({ token }: { token?: string }) {
  // We bounce through /login with the invite path stashed in `from`
  // state — the existing ProtectedRoute pattern would push us to
  // /app/projects post-login otherwise.
  const inviteHref = token ? `/invite/${token}` : "/invite";
  return (
    <div className="space-y-3">
      <p className="text-center text-sm text-muted-foreground">
        Inicia sesión con la cuenta a la que se envió la invitación para aceptarla.
      </p>
      <Button asChild className="w-full" size="lg">
        <Link to={`/login?next=${encodeURIComponent(inviteHref)}`}>
          Iniciar sesión
        </Link>
      </Button>
      <Button asChild variant="outline" className="w-full">
        <Link to={`/signup?next=${encodeURIComponent(inviteHref)}`}>
          Crear cuenta
        </Link>
      </Button>
    </div>
  );
}

function AcceptedView({
  projectName,
  projectId,
  role,
}: {
  projectName: string | null;
  projectId: string;
  role: string;
}) {
  return (
    <div className="space-y-3 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
        <CheckCircle2 className="h-6 w-6 text-emerald-600" />
      </div>
      <p className="text-sm text-muted-foreground">
        Bienvenida a <span className="font-medium text-foreground">{projectName ?? "el proyecto"}</span> con rol{" "}
        <span className="font-medium text-foreground">{role}</span>.
      </p>
      <Button asChild className="w-full">
        <Link to={`/app/p/${projectId}`}>Abrir el proyecto</Link>
      </Button>
    </div>
  );
}

function ErrorView({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-3 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <ShieldAlert className="h-6 w-6 text-destructive" />
      </div>
      <p className="text-sm text-destructive">{message ?? "No se pudo aceptar la invitación."}</p>
      <Button onClick={onRetry} variant="outline" className="w-full">
        Reintentar
      </Button>
      <Button asChild variant="ghost" className="w-full">
        <Link to="/app/projects">Ir a mis proyectos</Link>
      </Button>
    </div>
  );
}
