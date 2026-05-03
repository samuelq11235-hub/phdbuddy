import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Sparkles,
  Tags,
  MessageSquareQuote,
  Network,
  Wand2,
  FileText,
  Layers,
  Bot,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export default function LandingPage() {
  const { session, signInAnonymously } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [guestLoading, setGuestLoading] = useState(false);

  async function handleGuest() {
    setGuestLoading(true);
    try {
      await signInAnonymously();
      navigate("/app/projects", { replace: true });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falló el acceso de prueba",
        description: err instanceof Error ? err.message : "Inténtalo de nuevo.",
      });
      setGuestLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b px-4 py-4 sm:px-8">
        <Logo />
        <nav className="flex items-center gap-2">
          {session ? (
            <Button asChild>
              <Link to="/app/projects">
                Abrir mis proyectos
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost">
                <Link to="/login">Iniciar sesión</Link>
              </Button>
              <Button asChild>
                <Link to="/signup">Empezar</Link>
              </Button>
            </>
          )}
        </nav>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/15 via-background to-background"
            aria-hidden
          />
          <div className="mx-auto max-w-5xl px-4 py-24 text-center sm:py-32">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3 w-3" />
              La alternativa nativa con IA a Atlas.ti, NVivo y MAXQDA
            </div>
            <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-6xl">
              Análisis cualitativo,{" "}
              <span className="bg-gradient-to-r from-primary to-purple-500 bg-clip-text text-transparent">
                reinventado con IA
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
              Sube entrevistas, notas de campo, transcripciones y encuestas.
              PHDBuddy las codifica automáticamente con IA fundamentada en tus
              datos, descubre temas emergentes y te deja conversar con todo tu
              proyecto &mdash; sin perder el rigor del CAQDAS tradicional.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              {session ? (
                <Button asChild size="lg">
                  <Link to="/app/projects">
                    Abrir mis proyectos
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              ) : (
                <>
                  <Button size="lg" onClick={handleGuest} disabled={guestLoading}>
                    {guestLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-2 h-4 w-4" />
                    )}
                    Probar sin registro
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <Link to="/signup">
                      Crear cuenta
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </>
              )}
            </div>
            <p className="mt-6 text-xs text-muted-foreground">
              Pensado para teoría fundamentada, análisis temático, análisis de
              contenido y métodos mixtos.
            </p>
          </div>
        </section>

        {/* Por qué existimos */}
        <section className="border-t bg-muted/20">
          <div className="mx-auto max-w-6xl px-4 py-20">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight">
                Codificar no debería tomar semanas
              </h2>
              <p className="mt-3 text-muted-foreground">
                Las herramientas CAQDAS tradicionales se diseñaron antes de los
                LLM. PHDBuddy mantiene los flujos de trabajo en los que confían
                las personas investigadoras &mdash; citas, códigos, memos,
                redes &mdash; y los potencia con IA que tú siempre controlas.
              </p>
            </div>
            <div className="mt-16 grid gap-6 md:grid-cols-3">
              <Feature
                icon={Wand2}
                title="Auto-codificación con IA"
                description="Sube una transcripción y Claude propone un libro de códigos inicial junto con citas literales. Revisa, edita, acepta &mdash; nunca aceptación a ciegas."
              />
              <Feature
                icon={MessageSquareQuote}
                title="Codificación en línea"
                description="Resalta cualquier fragmento y PHDBuddy te sugiere códigos de tu codebook (semánticos + LLM). Aplícalos con un clic. Ágil y consistente."
              />
              <Feature
                icon={Layers}
                title="Descubrimiento de temas"
                description="Agrupa tus citas por significado, no por palabras clave. Cada cluster recibe una etiqueta temática generada por Claude y fundamentada en las citas reales."
              />
              <Feature
                icon={Bot}
                title="Conversa con tu proyecto"
                description="Pregunta &lsquo;¿qué dicen las personas participantes sobre la ansiedad?&rsquo; y obtén respuestas citadas a citas y pasajes específicos."
              />
              <Feature
                icon={Network}
                title="Redes de códigos"
                description="Visualiza cómo co-ocurren tus códigos. Observa la estructura emergente conforme avanza tu análisis &mdash; sin necesidad de otra herramienta de diagramación."
              />
              <Feature
                icon={FileText}
                title="Memos y rigor"
                description="Memos analíticos, metodológicos, teóricos y reflexivos vinculados a códigos, citas y documentos. Todo queda auditable."
              />
            </div>
          </div>
        </section>

        {/* Cómo funciona */}
        <section className="border-t">
          <div className="mx-auto max-w-5xl px-4 py-20">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight">Un flujo familiar, ahora con palanca</h2>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-4">
              <Step n="1" title="Crea un proyecto" desc="Define tu pregunta de investigación y metodología. PHDBuddy las usa de contexto en cada llamada a la IA." />
              <Step n="2" title="Sube tus fuentes" desc="PDF, texto plano, transcripciones. Las extraemos, fragmentamos e incrustamos para búsqueda semántica." />
              <Step n="3" title="Codifica con IA" desc="Auto-codifica un documento entero o elige códigos en línea. Construye tu codebook colaborando con el modelo." icon={Tags} />
              <Step n="4" title="Descubre y reporta" desc="Agrupa temas, explora redes de códigos, conversa con tus datos y escribe memos con citaciones." icon={Sparkles} />
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t bg-gradient-to-br from-primary/5 to-background">
          <div className="mx-auto max-w-3xl px-4 py-20 text-center">
            <h2 className="text-3xl font-bold tracking-tight">
              Menos tiempo codificando, más tiempo pensando
            </h2>
            <p className="mt-3 text-muted-foreground">
              Gratis durante el MVP. Sin tarjeta de crédito. Trae tus datos y
              empieza a analizar en minutos.
            </p>
            <Button asChild size="lg" className="mt-8">
              <Link to={session ? "/app/projects" : "/signup"}>
                {session ? "Abrir mis proyectos" : "Crear cuenta"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Logo showText={false} />
            <span>PHDBuddy &mdash; Análisis cualitativo nativo con IA</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Impulsado por Anthropic Claude, Voyage AI y Supabase.
          </p>
        </div>
      </footer>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function Step({
  n,
  title,
  desc,
  icon: Icon,
}: {
  n: string;
  title: string;
  desc: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="relative rounded-xl border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {n}
        </span>
        {Icon && <Icon className="h-4 w-4 text-primary" />}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}
