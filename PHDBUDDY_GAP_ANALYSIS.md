# PHDBuddy → Plan de evolución hacia paridad ATLAS.ti

> Análisis del estado actual del repo `samuelq11235-hub/phdbuddy` y plan de implementación con prompts listos para Cursor.

---

## 1. Lo que YA tienes (no rehacer)

Estado: **base sólida, ~40% del camino hecho**. Tu stack difiere del PRD original — lo bueno es que tu stack actual es más simple y rápido de iterar:

| Capa | Tu stack | PRD genérico | Decisión |
|---|---|---|---|
| Frontend | Vite + React 18 + React Router | Next.js App Router | **Mantener Vite**. No migres. |
| Backend | Supabase (Postgres + Edge Functions Deno) | Next.js API + Prisma | **Mantener Supabase**. Es perfecto para esto. |
| Auth | Supabase Auth + Google OAuth | Auth.js | **Mantener** |
| Embeddings | Voyage AI `voyage-3-lite` (1024 dim) | OpenAI text-embedding-3-small | **Mantener Voyage** (mejor calidad) |
| LLM | Anthropic Claude Sonnet | Anthropic | ✅ |
| Editor de texto | DOM-based con `getBoundingClientRect` + offsets | TipTap | **Mantener tu approach DOM** — funciona, más liviano |

### Funciones implementadas

- ✅ Autenticación (email + Google OAuth)
- ✅ Proyectos (con metadatos: research_question, methodology)
- ✅ Documentos (upload, extracción de texto PDF, status pipeline)
- ✅ Document chunks + embeddings con pgvector
- ✅ Codebook jerárquico (con `parent_id` — soporta árbol)
- ✅ Citas con `start_offset`/`end_offset` + embeddings
- ✅ `quotation_codes` (m2m con `created_by_ai` y `ai_confidence`)
- ✅ Memos con tipos (`analytic | methodological | theoretical | reflective`) y links a códigos/citas/docs
- ✅ AI suggestions queue (review-before-accept) — patrón excelente
- ✅ Chat sessions + messages con citations JSONB
- ✅ 7 Edge Functions: process-document, ai-auto-code, apply-suggestion, suggest-codes-for-quote, cluster-themes, project-chat, embed-quotation
- ✅ DocumentTextViewer con selección de texto y dialog de creación de citas
- ✅ Code Network (panel de coocurrencia básico, vía función SQL `code_cooccurrence`)
- ✅ Triggers de denormalización para counters
- ✅ RLS por usuario en cada tabla

---

## 2. Gap vs ATLAS.ti — lo que FALTA

Ordenado por valor/esfuerzo:

### 🔴 Crítico (lo que más echará en falta un usuario de ATLAS.ti)

1. **Code Groups** (agrupación lógica de códigos, distinta del árbol jerárquico). Tu `codes.parent_id` es un árbol, pero ATLAS.ti tiene además "code groups" como tags transversales (un código puede estar en múltiples grupos).
2. **Margen lateral con barras de códigos** apiladas en el visor del documento. Es el diferenciador visual #1 de ATLAS.ti. Tu `DocumentTextViewer` resalta texto pero no tiene gutter.
3. **Network View editable** (tipo whiteboard). Tu `CodeNetworkPanel` es un layout calculado de coocurrencia, **no editable**. Falta:
   - Drag & drop de nodos
   - Crear edges manualmente con tipo de relación
   - Persistencia del layout
   - Tipos de relación personalizables
4. **Code-Document Matrix** (tabla de códigos × documentos con conteos + heatmap). No existe.
5. **Query Tool** (constructor visual de búsquedas booleanas con códigos). No existe.

### 🟡 Importante

6. **Multimedia**: imágenes, audio, vídeo. Solo tienes texto/PDF.
7. **Sentiment / opinion mining**. No hay edge function para esto.
8. **Word cloud / Treemap / Sankey**. Solo tienes la red de coocurrencia.
9. **Inter-coder agreement** (Cohen's kappa, Krippendorff alpha). Tu README lo tiene en roadmap, no implementado.
10. **Colaboración multi-usuario**. RLS actualmente es `auth.uid() = user_id` — un proyecto pertenece a UN usuario. Falta tabla `project_members` con roles.
11. **Exportación** (QDA-XML, CSV, DOCX, HTML).
12. **In-vivo coding** (atajo: usar el texto seleccionado literal como nombre de código).
13. **Code merging** (fusionar 2 códigos: trasladar todas las quotation_codes y borrar el origen).

### 🟢 Nice-to-have

14. Encuestas (CSV/XLSX importadas como mini-documentos).
15. Geo-data.
16. Realtime collaboration (presencia, cursores).
17. Stripe / pricing tiers.
18. Onboarding tutorial.

---

## 3. Roadmap recomendado (orden de fases en Cursor)

Cada fase debe estar mergeada y probada antes de la siguiente. Diseñé el orden para **no romper lo que ya funciona** y maximizar valor entregable rápido.

| Fase | Objetivo | Esfuerzo | Riesgo |
|---|---|---|---|
| **F1** | Code Groups + UI mejorada del Codebook | 1–2 días | Bajo |
| **F2** | Margen lateral con barras de códigos | 2–3 días | Medio (DOM tricky) |
| **F3** | Code-Document Matrix + Sentiment | 2 días | Bajo |
| **F4** | Network View editable (React Flow) | 3–4 días | Medio |
| **F5** | Multi-usuario: project_members + invitaciones | 3–4 días | **Alto** (toca RLS) |
| **F6** | Exportación (CSV + Markdown + QDA-XML) | 2–3 días | Bajo |
| **F7** | Inter-coder agreement | 2 días | Bajo |
| **F8** | Multimedia: imágenes (Konva) | 2–3 días | Medio |
| **F9** | Multimedia: audio (Wavesurfer + Whisper) | 3–4 días | Alto |
| **F10** | Multimedia: vídeo | 2–3 días | Medio |
| **F11** | Query Tool visual | 2–3 días | Medio |

**Recomendación**: con F1–F7 ya tienes paridad funcional con la mayoría de ATLAS.ti para texto/PDF. Eso es vendible. F8–F10 son una segunda iteración para entrar a competir directamente.

---

## 4. Notas sobre tu arquitectura

### Cosas que están bien y debes mantener

- **`ai_suggestions` con `status` enum**: el patrón "AI propone, humano revisa" es exactamente lo correcto. Mantenlo y extiéndelo a sentiment/themes.
- **`created_by_ai` boolean en codes/quotations**: provenencia auditable. ✅
- **Triggers de counters denormalizados**: rápidos para mostrar listados. ✅
- **Edge Functions con `_shared/` (claude.ts, voyage.ts, prompts.ts)**: estructura limpia. Sigue ese patrón al añadir funciones nuevas.

### Cosas a corregir / mejorar

- **RLS solo por `user_id`**: bloquea colaboración. Hay que evolucionar a `project_members` (Fase 5). Esto es **el cambio más invasivo** de todo el roadmap. Hazlo en una sola PR grande con tests.
- **No hay tests**: ni unitarios ni e2e. Añade Playwright al menos para el flow crítico (login → crear proyecto → subir doc → crear cita → autocode → chat). Si no, cada fase nueva podría romper algo silenciosamente.
- **No hay `code_groups`**: hay que añadir tabla y UI. Tu `parent_id` se queda para jerarquía conceptual.
- **`document_chunks` y `quotations` ambos tienen `embedding(1024)`**: bien, pero confirma que `cluster-themes` usa el de quotations (es lo correcto, no chunks).
- **Faltan índices compuestos** para queries frecuentes. Ejemplo: `quotation_codes(project_id, code_id)` para coocurrencia.

---

## 5. Prompts listos para Cursor (uno por fase)

Pega cada bloque tal cual al iniciar la fase correspondiente. Asume que `PRD.md` y `PHDBUDDY_GAP_ANALYSIS.md` (este archivo) están en la raíz del repo y que Cursor tiene acceso al codebase.

> **Antes de empezar**, crea un `.cursorrules` con esto:
>
> ```
> Antes de implementar cualquier feature, lee PHDBUDDY_GAP_ANALYSIS.md.
> Stack obligatorio: Vite + React 18 + Supabase (Postgres + Edge Functions Deno).
> NO migres a Next.js, NO cambies de Prisma, NO reemplaces Voyage por OpenAI.
> Sigue el patrón existente: hooks con TanStack Query en frontend/src/hooks/,
> componentes shadcn en frontend/src/components/ui/, edge functions con
> _shared/ para código compartido.
> Las migraciones SQL siguen el formato YYYYMMDDHHMMSS_descripcion.sql.
> Cada nueva tabla DEBE tener RLS habilitada y policies que respeten project ownership.
> Antes de modificar RLS, verifica si existe project_members (tras la Fase 5).
> ```

---

### 🟢 Prompt Fase 1 — Code Groups + Codebook UI mejorado

```
Lee PHDBUDDY_GAP_ANALYSIS.md sección 2 (gaps) y 4 (notas de arquitectura).

Implementa "Code Groups" como agrupación transversal de códigos
(distinta de parent_id que es jerarquía).

1. Migración SQL nueva en supabase/migrations/:
   - Tabla `code_groups` (id, project_id, user_id, name, color, created_at, updated_at)
   - Tabla `code_group_members` (code_id, code_group_id, primary key compuesta)
   - RLS por user_id consistente con el patrón existente
   - Trigger set_updated_at en code_groups
   - Índices: code_group_members(code_group_id), code_group_members(code_id)

2. Tipos en frontend/src/types/database.ts: añadir CodeGroup y CodeGroupMember.

3. Hook frontend/src/hooks/useCodeGroups.ts siguiendo patrón de useCodes.ts
   (TanStack Query con queries y mutations: list, create, update, delete,
   addCodeToGroup, removeCodeFromGroup).

4. Componente CodebookPanel.tsx: añadir vista "Por grupo" como toggle
   junto a la actual jerárquica. En modo grupo, mostrar accordions por
   group con sus códigos dentro, y un grupo especial "Sin agrupar".

5. NewCodeDialog.tsx: añadir multi-select de groups (opcional al crear).

6. Botones bulk en codebook: "Asignar a grupo" tras seleccionar múltiples
   códigos con checkbox.

NO toques: la edge function ai-auto-code, los embeddings, ni el chat.
NO añadas dependencias nuevas — usa los Radix primitives ya instalados.
```

---

### 🟢 Prompt Fase 2 — Margen de códigos en el visor

```
Lee PHDBUDDY_GAP_ANALYSIS.md (gap #2 sección 2).

Añade un margen lateral derecho al DocumentTextViewer con barras verticales
apiladas que indican qué códigos cubren cada rango de texto. Es la UX
icónica de ATLAS.ti.

Especificación:

1. Modifica frontend/src/components/documents/DocumentTextViewer.tsx para
   tener un layout 2-col: columna del texto (flex-1) + columna del margen
   (ancho fijo 80–120px).

2. Para cada quotation, calcula su posición vertical en el margen así:
   - Después del render, mide el bounding rect del span correspondiente
     a esa quotation (data-quotation-id).
   - La barra del margen se posiciona absolute con `top: rect.top -
     containerRect.top` y altura = `rect.height`.
   - Ancho de barra: 4px. Margen entre barras: 2px.

3. Si N códigos cubren el mismo rango, apila N barras horizontalmente
   en el margen (cada una con el color de su código).

4. Hover sobre una barra: tooltip con nombre del código y conteo de citas.

5. Click sobre una barra: abre el panel lateral derecho con la quotation
   y permite editar/borrar.

6. Recalcular posiciones en:
   - Resize de ventana (ResizeObserver sobre el contenedor)
   - Cambios en quotations (useEffect dep)

7. Añade un componente CodeMargin.tsx separado que reciba
   `quotations: QuotationWithCodes[]` y `containerRef`.

CRÍTICO: NO uses TipTap ni reescribas el editor. Mantén el approach actual
de DOM con offsets — añade el margen encima.
NO modifiques el modelo de datos.
Test manual: con 3 quotations solapadas en el mismo párrafo y cada una con
2 códigos diferentes, deben verse 6 barras apiladas correctamente alineadas.
```

---

### 🟢 Prompt Fase 3 — Code-Document Matrix + Sentiment

```
Lee PHDBUDDY_GAP_ANALYSIS.md (gaps #4 y #7).

Implementa dos features:

PARTE A — Code-Document Matrix:

1. Función SQL en migración nueva: code_document_matrix(p_project_id uuid)
   returns table(code_id uuid, document_id uuid, count int).
   Cuenta quotations agrupando por (code_id, document_id).

2. Hook useCodeDocumentMatrix(projectId) en frontend/src/hooks/useCodes.ts.

3. Nueva pestaña "Matriz" en ProjectWorkspacePage (añade a VALID_TABS).

4. Componente CodeDocumentMatrix.tsx en frontend/src/components/codes/:
   - Tabla con códigos en filas, documentos en columnas, conteos en celdas.
   - Heatmap: opacidad de fondo proporcional a count/maxCount usando el
     color del código.
   - Filtros: por code_group, por document.kind.
   - Click en celda → navega a /app/p/:id/d/:docId con queryparam para
     filtrar quotations por código.
   - Export CSV (botón).

PARTE B — Sentiment analysis:

5. Nueva edge function supabase/functions/analyze-sentiment/index.ts:
   - Input: { quotation_ids: string[] } o { project_id: string } para todas.
   - Para cada quotation, Claude devuelve JSON estructurado:
     { polarity: -1..1, label: "positive"|"negative"|"neutral"|"mixed",
       aspects: [{aspect: string, polarity: number}], emotions: string[] }
   - Persistir en nueva tabla `quotation_sentiment` (quotation_id PK,
     polarity, label, aspects jsonb, emotions text[], model, created_at).
   - Reusar shared/claude.ts y un nuevo prompt SENTIMENT_SYSTEM en prompts.ts.

6. UI: en QuotationCard mostrar un dot de color (verde/rojo/gris/amarillo)
   según label. En el QuotationsPanel, filtro por sentiment.

7. Botón "Analizar sentimiento" en QuotationsPanel (bulk action sobre
   las quotations visibles).

NO mezcles esto con auto-code. Sentiment es una operación separada.
NO crees códigos automáticos por sentimiento (al menos en esta fase).
```

---

### 🟢 Prompt Fase 4 — Network View editable

```
Lee PHDBUDDY_GAP_ANALYSIS.md (gap #3).

Sustituye el actual CodeNetworkPanel (que es un layout calculado readonly)
por un editor de grafos persistente con React Flow.

1. Instala: npm install reactflow@11 dagre

2. Migración SQL nueva:
   - Tabla `networks` (id, project_id, user_id, name, layout jsonb, created_at, updated_at)
   - Tabla `relation_types` (id, project_id, user_id, name, color, symmetric bool, created_at)
     Seed automático en el primer acceso del proyecto: "is-cause-of",
     "is-part-of", "contradicts", "is-associated-with", "is-property-of"
     (insert si project no tiene relation_types).
   - Tabla `links` (id, project_id, user_id, source_type, source_id,
     target_type, target_id, relation_type_id, comment, created_at).
     CHECK source_type IN ('code','quotation','memo','document').
   - RLS estándar por user_id. Triggers set_updated_at.

3. Tipos en database.ts: Network, RelationType, Link.

4. Hooks useNetworks, useRelationTypes, useLinks en frontend/src/hooks/.

5. Reemplaza CodeNetworkPanel.tsx por NetworkEditor.tsx:
   - Toolbar superior: selector de Network actual, botón "Nuevo network",
     botón "Añadir desde codebook" (modal multi-select de codes), botón
     "Auto-layout (dagre)".
   - React Flow con nodos custom (CodeNode con color del código y
     groundedness como tamaño).
   - Crear edge → modal con selector de RelationType + comment.
   - Doble click en edge → editar.
   - Drag de nodos persiste posición en `networks.layout` (debounced 1s).
   - Botón "Sugerir conexiones (IA)": llama edge function
     suggest-relations que dado el set de códigos del network propone
     edges con razonamiento.

6. Nueva edge function suggest-relations:
   - Input: { network_id }
   - Reúne códigos del network + sample de quotations por código.
   - Claude propone JSON: [{source, target, relation_type, rationale}].
   - Persiste en ai_suggestions con kind='theme' (reusa el queue) o
     añade kind='relation' al enum y úsalo aquí.

7. Mantén la vista actual de "coocurrencia automática" como una pestaña
   secundaria del panel Network ("Coocurrencia") — es información distinta
   y útil. Renómbrala internamente CooccurrenceView.

CRÍTICO: el grafo debe persistir entre sesiones. Si el usuario cierra y
vuelve, ve exactamente lo que dejó. Test manual obligatorio.
```

---

### 🔴 Prompt Fase 5 — Multi-usuario (CAMBIO INVASIVO)

```
Lee PHDBUDDY_GAP_ANALYSIS.md sección 4 nota sobre RLS y gap #10.

⚠️ Esta fase modifica RLS en TODAS las tablas. Hazlo en UNA SOLA PR.
Antes de implementar, crea un branch dedicado y haz dump de la BD prod
si hay datos.

1. Migración SQL nueva (la más grande del proyecto):

   a) Crear tabla `project_members`:
      - id uuid pk
      - project_id uuid fk
      - user_id uuid fk auth.users
      - role enum ('owner','admin','coder','viewer')
      - created_at, updated_at
      - unique(project_id, user_id)

   b) Función helper `is_project_member(p_project_id uuid, p_user_id uuid)
      returns bool` con security definer que checkea project_members.

   c) Función helper `project_role(p_project_id uuid, p_user_id uuid)
      returns text` que devuelve el role o null.

   d) Migración de datos: para cada project existente, insertar un row
      en project_members con role='owner' y user_id = projects.user_id.

   e) Reescribir RLS policies en TODAS las tablas afectadas:
      projects, documents, document_chunks, codes, quotations,
      quotation_codes, memos, ai_suggestions, chat_sessions, chat_messages,
      networks, relation_types, links, code_groups, code_group_members.

      Patrón:
      - SELECT: is_project_member(project_id, auth.uid())
      - INSERT/UPDATE: role IN ('owner','admin','coder')
      - DELETE: role IN ('owner','admin') o ownership del row si role='coder'

      Viewers solo SELECT. Coders SELECT/INSERT/UPDATE/DELETE de SUS rows.
      Admins gestionan todo el contenido del proyecto. Owner además
      gestiona membership.

   f) NO borres la columna user_id de las tablas — sigue siendo "quién creó
      esta entidad" para attribution. Solo cambia las RLS.

2. Crear tabla `project_invitations`:
   - id, project_id, email, role, token (uuid), expires_at, accepted_at, created_by

3. Edge function nueva: send-invitation:
   - Genera token, persiste en project_invitations.
   - Envía email con Resend o Supabase Auth admin invite.
   - Frontend: ruta /invite/:token que pide login y vincula al proyecto.

4. Edge function nueva: accept-invitation.

5. UI:
   - Pestaña "Members" en ProjectWorkspacePage (solo para owner/admin).
   - Lista de miembros con role + dropdown para cambiar role.
   - Form "Invitar por email" con select de role.
   - Lista de invitaciones pendientes con botón "Reenviar" / "Cancelar".

6. Actualiza TODOS los hooks que hagan inserts: ya NO se debe pasar
   user_id explícito si la policy lo deduce; pero sí mantén el campo
   por attribution. Asegúrate que `created_by_user_id` o equivalente
   queda con auth.uid().

7. Tests e2e Playwright OBLIGATORIOS para esta fase:
   - User A crea proyecto, invita a User B como coder.
   - User B acepta, ve el proyecto, crea quotation.
   - User A ve la quotation de User B.
   - User C (no invitado) NO ve el proyecto.
   - User B intenta cambiar role de A: falla.
   - Owner A degrada a B a viewer: B ya no puede crear quotations.

NO toques las edge functions de IA en esta fase salvo lo mínimo
necesario para que respeten membership en sus queries internas
(usa service_role pero filtra explícitamente).
```

---

### 🟢 Prompt Fase 6 — Exportación

```
Lee PHDBUDDY_GAP_ANALYSIS.md (gap #11).

Añade exportación del proyecto en 4 formatos.

1. Edge function nueva supabase/functions/export-project:
   - Input: { project_id, format: 'csv'|'markdown'|'qdaxml'|'docx' }
   - Verifica is_project_member (tras Fase 5).
   - Recopila: project, documents, codes, code_groups, quotations,
     quotation_codes, memos, networks, links.

2. Generadores en _shared/exporters/:

   a) csv.ts: tabla plana de quotations
      cols: quotation_id, document_title, content, codes (comma-joined),
            comment, created_at, sentiment_label.

   b) markdown.ts: reporte estructurado:
      ```
      # {project.name}
      ## Pregunta de investigación
      ## Codebook (con groundedness)
      ## Citas por código (cada código con sus quotations literales)
      ## Memos
      ```

   c) qdaxml.ts: estándar REFI-QDA (https://www.qdasoftware.org/refi-qda-project)
      - Genera XML con `<Project>`, `<Sources>`, `<CodeBook>`, `<Codes>`,
        `<PlainTextSelection>` por quotation, `<Note>` por memo.
      - Encodea posiciones como startPosition/endPosition.
      - Empaqueta en .qdpx (zip con project.qde + Sources/).

   d) docx.ts: usa la librería `docx` (npm) en Deno via esm.sh.
      Reporte similar al markdown pero formateado.

3. Storage: sube el archivo generado a un bucket Supabase 'exports/'
   con expiry 24h, devuelve signed URL.

4. UI: botón "Exportar" en ProjectWorkspacePage header con dropdown de
   formatos. Muestra toast con link de descarga.

5. Importación inversa (mínimo): solo QDA-XML.
   - Edge function import-project: parsea .qdpx, crea project + entidades.
   - UI: botón "Importar proyecto" en /app/projects con file picker.

NO bloquees el frontend mientras se genera: usa el patrón ai_suggestions
o crea una tabla `export_jobs` con status. Para empezar, generación
síncrona en la edge function está OK si el proyecto es pequeño.
```

---

### 🟢 Prompt Fase 7 — Inter-coder Agreement

```
Lee PHDBUDDY_GAP_ANALYSIS.md (gap #9). Requiere Fase 5 completada.

Implementa métricas de acuerdo entre codificadores.

1. Función SQL inter_coder_agreement(p_project_id, p_user_a, p_user_b,
   p_document_ids uuid[]):

   Algoritmo:
   - Para cada par (document, character_position), determina qué código(s)
     aplicó cada usuario en esa posición.
   - Construye matriz de decisiones por unidad (unidad = quotation_codes
     creadas por cada usuario, contadas como "presencia/ausencia" de
     cada código).
   - Calcula:
     * Cohen's kappa por código (presencia/ausencia binaria por unidad)
     * Krippendorff alpha global (nivel nominal)
     * % acuerdo simple
   - Devuelve JSON con métricas globales + tabla por código.

   Implementa el cálculo en plpgsql o crea edge function compute-agreement
   en TypeScript (más fácil de testear).

2. Hook useInterCoderAgreement(projectId, userA, userB, documentIds).

3. Nueva pestaña "Agreement" en ProjectWorkspacePage:
   - Selector de 2 usuarios miembros del proyecto.
   - Selector multi de documentos (default: todos).
   - Tabla con kappa por código (color: verde >0.8, amarillo 0.6-0.8,
     rojo <0.6).
   - Cabecera con métricas globales: alpha, % acuerdo, n unidades.
   - Botón "Mostrar discrepancias" → lista de quotations donde A y B
     codificaron distinto.

4. Test con datos sintéticos: dos users codifican los mismos 10 párrafos,
   verifica que kappa=1 si codifican igual y kappa=0 si codifican aleatorio.

Referencia: Krippendorff K. (2018). Content Analysis. Cap. 12.
```

---

### 🟡 Prompt Fase 8 — Multimedia: Imágenes

```
Lee PHDBUDDY_GAP_ANALYSIS.md (gap #6).

Soporte para documents tipo IMAGE con anotaciones rectangulares.

1. Migración: añadir 'image' al enum document_kind. Modifica el CHECK.

2. Estructura de quotations: actualmente usas start_offset/end_offset (ints).
   Para imágenes necesitas bbox. Decisión:

   - Opción A: añadir columna `selection_meta jsonb` a quotations que
     contenga { type: 'text'|'image_area'|'timerange', ... } — y deja
     start_offset/end_offset null para no-texto.
   - Opción B: nueva tabla quotation_image_areas con quotation_id y
     bbox/page.

   Recomendado: Opción A (menos cambios estructurales). Migra haciéndolo
   nullable y añadiendo selection_meta.

3. Edge function process-document: añadir branch para image kind.
   - Para imágenes: extraer texto con OCR (Tesseract via WASM) o llamar
     Claude con la imagen para descripción + transcripción de texto si
     hay. Persistir en full_text para que sea buscable.

4. Componente nuevo ImageDocumentViewer.tsx:
   - Usa Konva.js (npm install konva react-konva).
   - Stage con la imagen como Layer base.
   - Layer encima para crear/mostrar Rect annotations.
   - Mouse drag → crea rectángulo → abre AddQuotationDialog con
     selection={ type: 'image_area', bbox: [x,y,w,h] }.

5. AddQuotationDialog: render condicional según selection.type. Para
   imágenes muestra un preview del crop.

6. Storage: bucket 'documents/' acepta jpg/png/webp. Validación de tamaño
   (max 20MB).

NO toques audio/video todavía. Esto se queda en imágenes estáticas.
```

---

### 🟡 Prompt Fase 9 — Multimedia: Audio

```
Requiere Fase 8 (selection_meta jsonb).

Soporte para audio con transcripción Whisper y citas por timerange.

1. Añadir 'audio' al enum document_kind.

2. Edge function process-document: branch para audio.
   - Sube archivo a Storage.
   - Llama OpenAI Whisper API (NO uses Claude para transcripción).
     Variable de entorno OPENAI_API_KEY (nueva).
   - Whisper devuelve segments con start/end en segundos + texto.
   - Persiste en nueva tabla document_transcript:
     (document_id, segment_index, start_ms int, end_ms int, text, speaker text nullable).
   - full_text = concat de todos los segments para búsqueda.

3. Componente AudioDocumentViewer.tsx:
   - Wavesurfer.js (npm install wavesurfer.js).
   - Reproductor con waveform.
   - Lista de segments transcritos sincronizada (click → seek).
   - Selección de rango temporal con drag en la waveform → AddQuotationDialog
     con selection={type:'timerange', startMs, endMs}.
   - Highlight de quotations existentes como regiones coloreadas en la waveform.

4. quotations.content para audio = el texto transcrito de ese rango
   (concat de segments cuyo timeframe intersecta).

5. Embeddings: igual que texto, sobre quotation.content.

Limita inicialmente a archivos < 100MB y < 1 hora de duración.
```

---

### 🟡 Prompt Fase 10 — Multimedia: Vídeo

```
Requiere Fase 9.

1. Añadir 'video' al enum.

2. process-document para vídeo:
   - Extrae audio con ffmpeg en la edge function (Deno tiene wasm-ffmpeg).
     Alternativa: client-side con ffmpeg.wasm antes de subir.
   - Pasa el audio extraído a Whisper igual que en Fase 9.
   - Genera N thumbnails (cada 10s) y guarda paths.

3. VideoDocumentViewer.tsx:
   - <video> nativo con controls.
   - Timeline custom debajo con thumbnails.
   - Selección de rango → AddQuotationDialog con timerange.
   - Quotations existentes como bandas en el timeline.

No implementes selección de áreas espaciales del frame (eso sería v3).
```

---

### 🟡 Prompt Fase 11 — Query Tool visual

```
Lee PHDBUDDY_GAP_ANALYSIS.md (gap #5).

Constructor visual de consultas booleanas sobre códigos.

1. Componente QueryBuilder.tsx:
   - Árbol de operadores: AND, OR, NOT, COOCCURS_WITH, IN_DOCUMENT.
   - Hojas: code selector, document selector, sentiment filter.
   - Drag & drop para reordenar nodos.

2. Función SQL execute_query(p_project_id, p_query jsonb) returns
   table(quotation_id uuid):
   - Recursivamente evalúa el árbol.
   - Operadores básicos: intersect/union de sets de quotation_id.

3. Vista de resultados con conteo y lista paginada de quotations.

4. Botón "Guardar query" → tabla saved_queries (id, project_id, name, definition jsonb).

5. Botón "Convertir a code" → crea code nuevo con todas las quotations
   resultado autocodificadas con ese código.
```

---

## 6. Reglas de oro al usar Cursor con este repo

1. **Una fase por PR**. Si Cursor empieza a tocar 30 archivos, ciérrale y reduce el scope.
2. **Lee siempre el archivo antes de editar**. Pídele a Cursor: "primero lee X.tsx completo, luego propón el cambio".
3. **No dejes que migre el stack**. Cursor a veces sugiere "esto sería más fácil con Next.js" — ignóralo. Tu stack actual es deliberado.
4. **Las RLS son sagradas**. Si una fase añade tabla, exige RLS en el mismo prompt.
5. **Edge Functions: usa siempre `_shared/`**. Reutiliza claude.ts, voyage.ts, prompts.ts. No dupliques.
6. **Cada migración SQL nueva debe ser idempotente** (use IF NOT EXISTS donde aplique) y timestamp posterior a las existentes.
7. **Tras cada fase, prueba el flow completo manualmente** antes de pasar a la siguiente. Lo que se rompe silenciosamente cuesta 10× arreglarlo después.
