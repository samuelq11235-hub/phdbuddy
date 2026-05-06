import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { supabase } from "@/lib/supabase";

// Set by LoginForm/SignupForm before triggering Google OAuth so we can
// land back on the right page (e.g. /invite/<token>) after the round-trip.
const POST_AUTH_REDIRECT_KEY = "phdbuddy.postAuthRedirect";

export default function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data.session) {
        navigate("/login", { replace: true });
        return;
      }
      const stashed = sessionStorage.getItem(POST_AUTH_REDIRECT_KEY);
      if (stashed) {
        sessionStorage.removeItem(POST_AUTH_REDIRECT_KEY);
        // Defensive: only allow same-origin paths to avoid open-redirect.
        if (stashed.startsWith("/")) {
          navigate(stashed, { replace: true });
          return;
        }
      }
      navigate("/app/projects", { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Iniciando sesión...
      </div>
    </div>
  );
}
