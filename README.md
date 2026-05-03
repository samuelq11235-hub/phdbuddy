# PHDBuddy

> **Análisis cualitativo nativo con IA** — una alternativa moderna y basada en la web a Atlas.ti / NVivo / MAXQDA, con la IA como colaboradora de primera clase.

PHDBuddy convierte montones de entrevistas, transcripciones, grupos focales y notas de campo en un proyecto de investigación codificado, consultable y rico en temas. Mantiene el rigor que las personas investigadoras esperan de un CAQDAS — proyectos, codebooks, citas, memos, redes — y potencia cada paso con IA fundamentada y auditable.

## Lo que lo hace diferente

| Capacidad | CAQDAS tradicional | **PHDBuddy** |
| --- | --- | --- |
| Codificación | Resaltado y asignación manuales | Manual + auto-codificación con IA (revisar antes de aceptar) |
| Sugerencia de códigos al leer | Ninguna | Sugerencias en línea desde tu codebook + propuesta de nuevos |
| Descubrimiento de temas | Clustering manual | Clustering semántico + temas etiquetados por Claude |
| "¿Qué dicen las personas participantes sobre X?" | Recuperación booleana | RAG conversacional con citas a nivel de cita textual |
| Redes de códigos | Complemento aparte | Visualización de co-ocurrencia integrada |
| Instalación | Software de escritorio pesado | Nativo en la web, comparte un enlace |

## Funcionalidades

- **Proyectos** con pregunta de investigación + metodología que viajan como contexto a cada llamada de IA.
- **Documentos** — sube PDF, pega transcripciones, con metadatos de tipo (entrevista, grupo focal, notas de campo, encuesta, literatura, ...).
- **Codebook jerárquico** con colores, descripciones, contadores de uso y procedencia IA-vs-humana.
- **Citas** — resalta cualquier texto en el visor del documento, asigna códigos, añade comentarios analíticos; embebidas en pgvector.
- **Auto-codificación con IA** — Claude lee un documento y propone un codebook + citas literales vinculadas a esos códigos. Tú apruebas qué entra a tu proyecto.
- **Sugerencias de codificación en línea** — al crear una cita, PHDBuddy sugiere los mejores códigos de tu codebook (similitud semántica + LLM) y propone códigos nuevos solo cuando ninguno encaja.
- **Descubrimiento de temas** — agrupa todas tus citas por similitud semántica y deja que Claude etiquete cada cluster con una descripción temática fundamentada.
- **Chat del proyecto (RAG)** — pregunta "¿qué dicen las personas participantes sobre la ansiedad?" y obtén respuestas con citas tipo `[Q3]`, `[C2]` que enlazan a citas y fragmentos específicos.
- **Red de co-ocurrencia de códigos** — visualiza qué códigos aparecen juntos en tus citas.
- **Memos** — notas analíticas, metodológicas, teóricas y reflexivas vinculadas a códigos / citas / documentos.

## Stack tecnológico

| Capa | Tecnología |
| --- | --- |
| Frontend | Vite, React 18, TypeScript, React Router, Tailwind, Shadcn UI, TanStack Query |
| Backend | Supabase (Postgres + pgvector, Auth, Storage, Edge Functions sobre Deno) |
| IA | Anthropic Claude (Sonnet 4.5) para codificación, etiquetas de temas y chat |
| Embeddings | Voyage AI `voyage-3-lite` (1024 dim) para recuperación semántica y clustering |

## Estructura del repositorio

```
PHDBuddy/
├── frontend/                 # SPA Vite + React (Shadcn UI)
│   └── src/
│       ├── components/       # projects, documents, codes, quotations, memos, ai, network, layout, ui
│       ├── hooks/            # useProjects, useDocuments, useCodes, useQuotations, useMemos, useChat, useAISuggestions
│       ├── pages/            # Landing, Login, Signup, Projects, ProjectWorkspace, DocumentViewer, Settings
│       ├── lib/              # supabase, api, utils
│       └── types/database.ts # Tipos CAQDAS escritos a mano
└── supabase/
    ├── migrations/           # Esquema Postgres + pgvector + RLS + triggers + RPCs
    └── functions/            # Edge Functions (Deno)
        ├── process-document/        # Extraer → fragmentar → incrustar
        ├── ai-auto-code/            # Claude propone codebook + citas
        ├── apply-suggestion/        # Materializa las sugerencias aceptadas
        ├── suggest-codes-for-quote/ # Sugerencias de codificación en línea
        ├── cluster-themes/          # Clustering semántico + etiquetas de Claude
        ├── project-chat/            # Análisis conversacional RAG
        ├── embed-quotation/         # Genera el embedding de una cita
        └── _shared/                 # Claude, Voyage, PDF, chunking, CORS, prompts
```

## Requisitos previos

- **Proyecto Supabase** — regístrate en [supabase.com](https://supabase.com).
- **Clave de API de Anthropic** — desde [console.anthropic.com](https://console.anthropic.com).
- **Clave de API de Voyage AI** — desde [voyageai.com](https://www.voyageai.com).
- **Credenciales OAuth de Google** (opcional) — desde la [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
- **Node.js 20+** y **npm** para el frontend.
- **Supabase CLI** (`npm i -g supabase`) para migraciones y despliegues de edge functions.

## Configuración

### 1. Instala las dependencias del frontend

```bash
cd frontend
npm install
cp .env.example .env.local
```

Edita `frontend/.env.local`:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key
```

### 2. Aplica las migraciones

```bash
cd ..
supabase login
supabase link --project-ref your-project-ref
supabase db push
```

Esto ejecuta:

- `20260501000000_init.sql` (auth + perfiles + bucket de Storage + extensión pgvector)
- `20260501020000_caqdas_pivot.sql` (el esquema CAQDAS completo con triggers y RPCs)

La segunda migración elimina las tablas legadas de resumen de papers (`summaries`, `conclusions`, `connections`, `external_papers`) y crea el nuevo dominio: `projects`, `documents`, `document_chunks`, `codes`, `quotations`, `quotation_codes`, `memos`, `ai_suggestions`, `chat_sessions`, `chat_messages`. Hay RLS aplicada en cada tabla propiedad del usuario.

### 3. Configura los secretos de las Edge Functions

```bash
supabase secrets set \
  ANTHROPIC_API_KEY=sk-ant-... \
  VOYAGE_API_KEY=pa-...
```

### 4. Despliega las Edge Functions

```bash
supabase functions deploy process-document
supabase functions deploy ai-auto-code
supabase functions deploy apply-suggestion
supabase functions deploy suggest-codes-for-quote
supabase functions deploy cluster-themes
supabase functions deploy project-chat
supabase functions deploy embed-quotation
```

### 5. Configura Google OAuth (opcional)

En Supabase: **Authentication → Providers → Google**. Añade tus credenciales de cliente y configura las URLs de redirección:

- Local: `http://localhost:5173/auth/callback`
- Producción: `https://tu-dominio.com/auth/callback`

En **Authentication → URL Configuration** define la Site URL y añade la URL de callback a las redirecciones permitidas.

### 6. Ejecuta la app

```bash
cd frontend
npm run dev
```

Abre [http://localhost:5173](http://localhost:5173).

## Cómo fluye un análisis típico

1. **Crea un proyecto** — define su pregunta de investigación y metodología. Viajan como contexto en cada llamada de IA.
2. **Sube fuentes** — entrevistas, transcripciones, notas de campo (PDF, TXT, MD) o pega texto en línea. Cada documento se extrae, se fragmenta en segmentos de ~800 tokens y se incrusta con Voyage.
3. **Auto-codifica el primer documento** — Claude propone un codebook inicial más 6-20 citas literales vinculadas a esos códigos. Revisa, desmarca lo que no te convenza y aplica. Se crean `codes`, `quotations` y `quotation_codes` reales.
4. **Sigue leyendo, codifica en línea** — abre cualquier documento; resalta un pasaje; PHDBuddy hace flotar una píldora "Crear cita". El diálogo sugiere códigos existentes (semántico + LLM) y permite crear nuevos al vuelo. Las citas se incrustan en segundo plano para chat y temas.
5. **Descubre temas** — en la pestaña de Citas, pulsa "Descubrir temas". Las citas se agrupan por similitud coseno en un espacio de 1024 dimensiones, y Claude etiqueta cada cluster con un nombre de tema + descripción fundamentada.
6. **Conversa con tu proyecto** — haz preguntas analíticas en lenguaje natural. Las respuestas citan a citas `[Q3]` y a fragmentos de documento `[C2]` específicos. Si falta evidencia, el modelo lo dice.
7. **Visualiza la red** — observa qué códigos co-ocurren en citas compartidas. Grosor de la conexión ≈ número de co-ocurrencias. Tamaño del nodo ≈ uso total del código.
8. **Memoriza durante todo el proceso** — memos analíticos / metodológicos / teóricos / reflexivos mantienen tu trazabilidad auditable.

## Desarrollo local con Supabase CLI

```bash
cd PHDBuddy
cp supabase/.env.example supabase/.env  # rellena las claves
supabase start
supabase functions serve --env-file supabase/.env
```

Actualiza `frontend/.env.local` con las URLs locales que imprime `supabase start`, y luego ejecuta `npm run dev` en `frontend/`.

## Parámetros de personalización

- **Modelo de Claude** — `DEFAULT_MODEL` en `supabase/functions/_shared/claude.ts`.
- **Modelo / dimensión de embedding** — `voyage-3-lite` (1024) en `supabase/functions/_shared/voyage.ts`. Si cambias la dimensión, actualiza también cada columna `vector(1024)` en las migraciones.
- **Tamaño de fragmento** — `chunkText(rawText, 800, 80)` en `process-document`.
- **Ventana de auto-codificación** — `MAX_INPUT_CHARS` en `ai-auto-code/index.ts` (45.000 caracteres por defecto).
- **Umbral de clustering temático** — `similarityThreshold` (0.55 por defecto) en `cluster-themes`.
- **Prompts** — todos los prompts viven en `supabase/functions/_shared/prompts.ts`.

## Roadmap

- Codificación colaborativa en tiempo real entre varias personas (presencia + cursores compartidos).
- Métricas de fiabilidad inter-codificadora (κ de Cohen).
- Mentor de codificación (Claude critica el codebook por saturación teórica, redundancia, ambigüedad).
- Asistente de escritura de memos fundamentado en códigos / citas vinculados.
- Paquetes de exportación (PDF del codebook, matriz de citas en CSV, reporte temático en Markdown).
- Pipeline de transcripción de audio/vídeo (Whisper) para soltar una grabación y obtener una transcripción ya codificada.

## Licencia

MIT
