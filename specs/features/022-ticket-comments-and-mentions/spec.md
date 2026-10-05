# Spec — Comentarios de tickets con @menciones

- **ID:** 022-ticket-comments-and-mentions
- **Estado:** draft
- **Referencias:** `015-project-membership-and-tickets` (tabla `tickets`, RLS `can_view_project`, guard de contributor-scope, patrón de audit de tickets). `019-ticket-rich-editor` (RICH_TEXT_SCHEMA, renderer server, `<RichTextViewer>`, `<RichTextEditor>`, validador Zod). `010-notifications-and-audit` (patrón de trigger que escribe la notificación en la misma transacción, ADR 0012; `src/lib/notifications/events.ts` para el copy).

---

## 1. Objetivo

Sumar **hilo de comentarios por ticket** al detalle (`/tickets/[key]`), con dos capacidades no negociables:

1. **Cada comentario es un doc rich text.** Se escribe con el mismo editor Tiptap que la descripción (feature 019), se guarda como `jsonb`, se renderiza server-side. No hay una segunda "versión ligera" del editor — la única fuente de verdad de "qué es un doc válido" sigue siendo `RICH_TEXT_SCHEMA`.
2. **Menciones con `@`.** Escribir `@` adentro del editor abre un autocompletado que lista los miembros del proyecto; elegir una persona inserta un nodo `mention` con `user_id`. Cada mención genera **una notificación al mencionado** (patrón in-app + email de `010`) — es lo que le da a la feature su valor real: te enterás porque alguien te llama, no porque revisás todos los tickets.

Además, cada comentario nuevo dispara una notificación **a los interesados del ticket** (assignee + creador + PM primario, menos el actor y los ya mencionados para evitar el doble aviso). No queremos que la conversación pase debajo del radar del PM.

**Fuera del alcance (a propósito):**

- **Threading / respuestas a un comentario.** Un solo hilo plano por ticket. Cuando alguien quiera responder a otro comentario, lo mencion(a con `@` y listo. Slack, Linear y GitHub arrancaron todos así; el árbol de replies se puede sumar como fase 2 sin migration destructiva (un `parent_id nullable` es aditivo).
- **Reacciones / emojis / like.** Los comentarios son texto; si algo merece "+1", que lo diga con palabras. Es scope creep típico de features de comentarios y no hay pedido detrás.
- **Editar el historial visible ("editado el DD/MM").** Sí se guarda `updated_at`, pero la UI no muestra "editado" en el MVP. Se puede sumar como refinement.
- **Menciones de grupos / roles** (`@pms`, `@devs`, `@team`). Solo personas. Grupos son otro producto — quién los define, qué pasa cuando alguien entra/sale del grupo, etc.
- **Comentarios en attachments o en líneas específicas de la descripción.** El hilo es del ticket, no de sus partes.
- **Reglas de edición basadas en ventana de tiempo.** Autor puede editar/borrar siempre; PM primario y admin también. No hay "solo 5 min después de escribirlo". Simple.

---

## 2. Contexto

Hoy el detalle del ticket (`src/components/tickets/ticket-detail.tsx`) muestra descripción (019), adjuntos (020), horas cargadas (016) y meta (asignado, prioridad, sprint, etc.). **No hay hilo de conversación.** Cuando un dev tiene una duda, la manda por Slack o WhatsApp, se resuelve fuera del sistema, y el ticket queda sin trazabilidad. Esto arrastra dos costos:

- **La decisión se pierde.** Semanas después, al revisar por qué el ticket quedó como quedó, no hay dónde mirar. El commit message a veces alcanza; muchas veces no.
- **Los nuevos que entran al proyecto no tienen contexto.** El ticket dice qué hay que hacer, pero no cómo se llegó ahí, qué se descartó, qué preguntaron y qué se contestó.

El pedido concreto del usuario ("JIRA: Comentarios!") viene de operar Jira o Linear y esperar la misma UX: un stream de comentarios abajo del ticket, con menciones que notifican. **No es una feature de análisis; es la aplicación de un patrón conocido.**

**Por qué rich text y no un textarea.** El costo de sumar Tiptap ya está pagado (bundle client de ~90 KB gzipped, cargado con `dynamic({ ssr:false })` en 019). El editor de la descripción y el de comentarios pueden compartir la instancia — se importan del mismo lugar. En cambio, dos editores distintos (uno rich, otro plano) es fricción para el usuario (hago Ctrl+B y no pasa nada) y superficie de bugs. Con un solo editor, si mañana se suma un nodo (imagen, tabla, mention de rol) todos los lugares lo heredan.

**Por qué menciones y no "sub".** Un follow/watch requiere UI para gestionar la lista y decidir qué eventos disparan. Mención es una acción explícita del autor: "necesito que Fulana vea esto". El costo de escribir `@` es cero; el valor es un aviso dirigido. Follow queda como fase 2 si aparece la necesidad.

**Por qué también avisar al assignee/creador/PM sin mención.** Un comentario en tu ticket no requiere que te nombren para que te importe. Slack y Linear los avisan; Jira también (configurable, pero por default sí). Sin este aviso el uso real cae — la conversación se vuelve invisible salvo que revises todos los tickets abiertos, que nadie hace.

**Por qué el aviso al PM primario.** Alineado con la spec 023 (que suma al PM primario a los cambios de status): el PM es dueño operativo del proyecto. Un dev y un contributor conversando en un ticket es la conversación que el PM más necesita ver. Duplicar al assignee/creador cuando alguno de ellos también es PM se resuelve con la deduplicación estándar del `notify_user()` (no se avisa dos veces).

**Por qué mencionados y notif de comentario son eventos distintos.** El copy y el ranking en la bandeja son distintos: "te mencionaron" es más urgente que "hay actividad en un ticket que te interesa". Separar los tipos permite que la UI muestre badges distintos (o filtre) sin heurísticas por payload.

---

## 3. User stories

- **US-1 · Escribir un comentario** — Como cualquier usuario con permiso de lectura sobre el proyecto (`can_view_project`), quiero escribir un comentario en un ticket, con el mismo editor rich text que tiene la descripción — negrita, cursiva, listas, checklist, código, links — para dejar la conversación adentro del ticket y no en Slack.
- **US-2 · Mencionar a alguien** — Como autor de un comentario, quiero escribir `@` y ver una lista de personas del proyecto para elegir a quién mencionar; la persona elegida queda como un token visible en el comentario (nombre + estilo distintivo), y recibe una notificación in-app y por email diciéndole que la mencioné en este ticket.
- **US-3 · Enterarme de un comentario en mi ticket** — Como assignee o creador de un ticket, quiero recibir una notificación cuando alguien comenta ahí, para no tener que revisar todos mis tickets a mano.
- **US-4 · Enterarme de comentarios en mis proyectos** — Como PM primario del proyecto, quiero recibir una notificación de cada comentario en sus tickets, para no perderme decisiones que se toman por escrito.
- **US-5 · Editar mi comentario** — Como autor de un comentario, quiero poder editarlo después de publicarlo (típico caso: typo, agregar un link). El comentario editado se guarda como el nuevo cuerpo — no hay historial visible.
- **US-6 · Borrar mi comentario** — Como autor, PM primario o admin, quiero poder borrar un comentario. El feed reordena solo. Queda trazabilidad en `audit_log` (patrón `020` con snapshot completo en delete).
- **US-7 · Ver el hilo ordenado** — Como cualquier usuario del proyecto, quiero ver los comentarios del ticket en orden **cronológico ascendente** (los primeros arriba, los últimos abajo) — coherente con el patrón de Linear/Slack, no con el de Jira que los pone del último al primero.
- **US-8 · Contador de comentarios en la lista** — Como usuario que navega el backlog o el kanban, quiero ver la cantidad de comentarios en cada card, para identificar de un vistazo dónde hay discusión activa.

---

## 4. Acceptance criteria

### US-1 · Escribir un comentario

- **AC-1.1** — Given estoy en `/tickets/[key]` y tengo `can_view_project(ticket.project_id)` = true, when scroll al pie del detalle, then veo una sección **"Comentarios"** con el editor rich text listo para escribir. El editor arranca vacío, con placeholder "Escribí un comentario…".
- **AC-1.2** — Given tipeo contenido válido y hago click en "Comentar" (o Cmd/Ctrl+Enter), when el server responde 201, then el comentario aparece en el feed inmediatamente arriba del editor, el editor se vacía, y el foco vuelve al editor.
- **AC-1.3** — Given el doc del comentario es inválido (excede `RICH_TEXT_MAX_PLAIN_LENGTH` de texto plano, contiene nodos no permitidos, `href` con protocolo no whitelisted), when se intenta publicar, then el server responde 400 con el mismo detalle que rechaza la descripción, y el editor queda con el contenido intacto (no se pierde lo escrito).
- **AC-1.4** — Given estoy sin permiso de lectura del proyecto (`can_view_project` = false), when intento cargar la página, then la fila del ticket ya no la veo por la RLS (el 404 sale antes de llegar acá). La sección de comentarios nunca se renderiza para "casi-outsiders".
- **AC-1.5** — Given tengo `can_view_project` pero no soy contributor+ del proyecto (`viewer`), when intento publicar, then el server acepta igual **— comentar no requiere contributor**. Cualquier `viewer` del proyecto puede aportar (es el patrón de Linear y GitHub: leer un ticket implica poder comentar).
- **AC-1.6** — Given publico un comentario, when se persiste, then queda una fila en `ticket_comments` con `body_doc` (validado contra `RICH_TEXT_SCHEMA`), `author_id = auth.uid()`, `ticket_id`, `created_at = now()`, `updated_at = now()`.

### US-2 · Menciones con `@`

- **AC-2.1** — Given estoy escribiendo un comentario y tipeo `@`, when tipeo, then aparece un popover con los miembros activos del proyecto (`project_members` join `profiles.active = true`), ordenados por nombre. El popover filtra por match en `full_name` o `email`.
- **AC-2.2** — Given elijo una persona del popover (click o Enter), when se inserta, then el editor coloca un nodo `mention` con attrs `{ user_id, label }` (label = nombre para mostrar). Visualmente aparece como un chip/badge con el color del proyecto o un estilo distintivo (a definir en el plan, alineado con `DESIGN.md`).
- **AC-2.3** — Given publico el comentario con un `mention`, when el server valida, then el `user_id` mencionado tiene que ser un miembro activo del proyecto — si no lo es (id de otro proyecto, id inexistente, usuario `active = false`), el server responde 422 con `mention_target_invalid`. La regla vive en el validador del doc.
- **AC-2.4** — Given publiqué el comentario con `@Fulana`, when el trigger de notif corre, then Fulana recibe **una única notificación de tipo `ticket_mentioned`** — aunque el comentario la mencione dos o más veces (deduplicación por `user_id + comment_id`).
- **AC-2.5** — Given publiqué un comentario que menciona a alguien que también es assignee/creador/PM primario del ticket, when el trigger de notif corre, then esa persona recibe **solo el `ticket_mentioned`** — no también el `ticket_commented` genérico. Es la deduplicación estándar de `notify_user()` (ADR 0012), extendida al par `(user_id, ticket_id, batch)`: "no te aviso dos veces del mismo evento en la misma transacción".
- **AC-2.6** — Given yo mismo me menciono en un comentario mío (autolesión típica de testing), when el trigger corre, then **no me llega notificación** — el chequeo de "a nadie se le avisa de su propia acción" del `notify_user()` sigue aplicando.
- **AC-2.7** — Given un comentario menciona a alguien y después el autor lo edita para sacar la mención, when el update se persiste, then **no se rescinde la notificación ya enviada** — es un mensaje despachado, no hay "cancelar mail" en el mundo real. La bandeja in-app puede quedar con un aviso que ya no matchea el texto actual; se acepta.
- **AC-2.8** — Given edito un comentario y **sumo** una mención que antes no estaba, when el update se persiste, then el mencionado nuevo **sí** recibe `ticket_mentioned`. La diferencia con AC-2.7 es intencional: sumar es un acto explícito de llamar a alguien; sacar es corregir una redacción.

### US-3/4 · Notif a assignee / creador / PM primario

- **AC-3.1** — Given publico un comentario en un ticket con `assignee_id = A`, `created_by = B`, `project.pm_id = C`, when el trigger corre, then **A, B y C reciben una notificación de tipo `ticket_commented`**, menos:
  - **el actor** (yo, `auth.uid()`),
  - **los que ya fueron mencionados en el mismo comentario** (regla de AC-2.5),
  - **los null** (assignee sin asignar, PM primario sin definir).
- **AC-3.2** — Given tres personas coinciden (A = B = C, típico de tickets creados por el PM primario que se autoasigna), when el trigger corre, then esa persona recibe **una sola notificación** (deduplicación del `notify_user()`).
- **AC-3.3** — Given `RESEND_API_KEY` no está seteada (dev local sin credenciales), when el trigger corre, then las filas de `notifications` quedan con `email_status = 'pending'` y la bandeja in-app las muestra igual — sin romper (patrón `010`).

### US-5 · Editar

- **AC-5.1** — Given soy el autor del comentario, when hago click en "Editar" en el kebab del comentario, then el comentario se reemplaza por el editor con el `body_doc` actual precargado, y aparecen los botones "Guardar" y "Cancelar".
- **AC-5.2** — Given no soy el autor, when miro un comentario que no es mío, then el kebab **no muestra "Editar"** (aunque sea PM primario o admin — editar palabras que otro escribió es siempre inapropiado; el equivalente de admin es borrar, no reescribir).
- **AC-5.3** — Given estoy editando y guardo, when el server responde 200, then el comentario vuelve a modo lectura con el nuevo `body_doc`, `updated_at` avanza, y se dispara la lógica de AC-2.8 (si sumé menciones nuevas, se avisa).
- **AC-5.4** — Given estoy editando y cancelo, when hago click en "Cancelar", then el comentario vuelve a modo lectura con el `body_doc` original — sin persistir nada.
- **AC-5.5** — Given estoy editando y otro usuario editó el mismo comentario mientras tanto (imposible en la práctica salvo dos sesiones del mismo autor), when guardo, then aplico el chequeo `expected_updated_at` del `PATCH` (patrón 019 con checklist) y respondo 409 si difiere. La UI recarga el comentario y avisa "otra pestaña lo editó" — decisión menor a resolver en el plan.

### US-6 · Borrar

- **AC-6.1** — Given soy el autor **o** el PM primario del proyecto **o** un admin, when hago click en "Borrar" y confirmo, then el server responde 204 y el comentario desaparece del feed.
- **AC-6.2** — Given borro un comentario, when se persiste el delete, then queda una fila en `audit_log` con snapshot completo del `body_doc` borrado (patrón `020` con `attachments`, `016` con `time_entries`) — el diff no alcanza porque la fila ya no existe.
- **AC-6.3** — Given borro un comentario, when después miro las notificaciones que ese comentario disparó, then **siguen existiendo** (`on delete set null` en `notifications.related_id` para comentarios — o el equivalente que resuelva el plan). La bandeja muestra "te mencionaron en un comentario que ya no existe" — mejor que un mensaje sin origen o que la bandeja mienta.

### US-7 · Orden y render

- **AC-7.1** — Given el ticket tiene N comentarios, when abro el detalle, then aparecen ordenados por `created_at asc` (los más viejos arriba). El editor de "nuevo comentario" queda **debajo** del último comentario.
- **AC-7.2** — Given el ticket tiene ≥ 50 comentarios (caso extremo, pensable para tickets vivos de meses), when abro el detalle, then los **primeros 20** cargan por SSR y hay un botón "Ver anteriores" que carga los previos — evita render inicial de 50+ docs rich text. El paginado exacto se resuelve en el plan; el criterio es "no bloquear el TTI del detalle".
- **AC-7.3** — Given un comentario tiene menciones, when se renderiza server-side, then los tokens `mention` aparecen como `<span data-mention-user-id="...">@Nombre</span>` (o equivalente) con el estilo del sistema. Sin JS. El link a `/admin/users/[id]` es opcional (puede ser puramente decorativo en el MVP).
- **AC-7.4** — Given un comentario tiene una checklist (`taskItem`), when se renderiza en el feed, then **las casillas NO son interactivas** — un comentario es un enunciado histórico, no una lista viva del ticket. El nodo `taskItem` se renderiza como checkbox visualmente pero deshabilitado. (Distinto de la descripción, donde el hydrator de 019 sí las hace interactivas.)

### US-8 · Contador en el listado

- **AC-8.1** — Given navego a `/projects/[key]/backlog` o al kanban de un sprint, when veo cada card de ticket, then muestra un icono de "chat" con el número de comentarios (`count(*)`) a la derecha del título. Cero comentarios: no se muestra el icono.
- **AC-8.2** — Given hay 100+ comentarios en un ticket, when veo la card, then el número se muestra como está (`147`), sin truncar a "99+". No queremos vender inflación falsa; si un ticket tiene 147 comentarios, quizá el problema es que necesita partirse.
- **AC-8.3** — Given la consulta que arma la lista de tickets, when se agrega el count, then **no se hace N+1**: es una subquery agregada en la misma consulta, o un `count` calculado con `left join` + `group by`. La regla es "cero requests adicionales por card".

---

## 5. Alcance

**Dentro:**

- **Migration:** tabla `ticket_comments` (id uuid pk, ticket_id fk restrict, author_id fk restrict, body_doc jsonb not null, created_at, updated_at). RLS por `can_view_project(ticket.project_id)` para read/insert, autor para update, autor+PM primario+admin para delete. Grants a `authenticated` (incluye `DELETE` — segunda vez en el proyecto tras `016`; documentar en CLAUDE.md).
- **Extender `RICH_TEXT_SCHEMA`:** sumar nodo `mention` con attrs `{ user_id: string (uuid), label: string }`. Actualizar los tres consumidores (Tiptap extension, validador Zod, renderer server). Mantener consistencia con la regla de 019 ("cambiar el schema es cambiar los tres a la vez").
- **Extender `NODES_DISABLED_IN_019`:** sacar `mention` de esa lista para el editor de comentarios (y sumarlo al de la descripción como bonus, si el plan lo justifica — igual queda a decisión en Q-3).
- **Trigger de notificación:** `notify_ticket_comment_events` que corre `after insert or update on ticket_comments`, extrae menciones del `body_doc`, y llama a `notify_user_for_ticket()` con `ticket_mentioned` para cada mencionado y `ticket_commented` para assignee/creador/PM primario menos los ya notificados y el actor.
- **Extender `notification_type` enum:** sumar `ticket_commented`, `ticket_mentioned`. Copy en `src/lib/notifications/events.ts` (in-app + email en español, patrón 010).
- **Extender `audit_log`:** trigger `audit_ticket_comment_events` que loguea insert/update/delete. En delete guarda snapshot completo (patrón 020).
- **API:**
  - `POST /api/tickets/[id]/comments` → body `{ body_doc }` → 201 con la fila creada.
  - `PATCH /api/tickets/[id]/comments/[commentId]` → body `{ body_doc, expected_updated_at }` → 200 / 409.
  - `DELETE /api/tickets/[id]/comments/[commentId]` → 204.
- **Endpoint de miembros para el autocompletado:** `GET /api/projects/[id]/members?q=<term>` → 200 con `{ user_id, full_name, avatar_url? }[]`. Filtra por `active = true` y por match en nombre/email. Máximo 8 resultados por request (típico de mentions). Autorización: `can_view_project`.
- **UI:**
  - Componente `<TicketComments>` server-side dentro de `<TicketDetail>` (fetch inicial de comentarios + count) — se coloca después de `<TicketTimeEntries>`.
  - Componente `<CommentEditor>` client — reusa `<RichTextEditor>` de 019 con la extensión `Mention` habilitada.
  - Componente `<CommentItem>` server — reusa `renderDocToHtml` con soporte para `mention`.
  - Sumar count al `<TicketList>` (backlog) y al kanban (`/projects/[key]/board` y `/projects/[key]/sprint`).
- **Notif in-app:** links a `/tickets/[key]#comment-<id>` (anchor scroll al comentario). El copy y el link se resuelven en el plan.
- **Migration script:** ninguno — la tabla arranca vacía.
- **Tests:**
  - Smoke: RLS de `ticket_comments` (viewer puede leer/comentar, no-miembro no puede leer, autor puede editar/borrar, PM/admin puede borrar).
  - Integration: trigger de notificación cubre las combinaciones de AC-3.1 y AC-2.5 (dedup correcta). Trigger de audit guarda snapshot en delete.
  - Unit: validador rechaza `mention.user_id` que no es miembro activo (usando mock).
  - Unit: renderer server produce el HTML correcto para el nodo `mention` sin JS.

**Fuera:**

- **Threading.** Como se dijo en §1.
- **Reacciones / like.**
- **Follow explícito del ticket** (subscribirse sin ser assignee/creador/PM/mencionado). Fase 2.
- **Rendering del "editado" en la UI** (aunque `updated_at` sí se persiste).
- **Menciones a grupos / roles.**
- **Preview de link (unfurl) en el editor.** El link se muestra como link, sin card. Es una feature de otro nivel.
- **Notificaciones agrupadas ("3 comentarios nuevos en TICKET-42").** Una por evento. Si el volumen justifica agrupar, es un cambio del pipeline de emails, no de la spec de comentarios.
- **Editor de menciones cross-project.** Si un ticket del proyecto X quiere mencionar a alguien que está solo en el proyecto Y, no se puede. El autocompletado se limita a miembros del proyecto del ticket.
- **Historial de ediciones visible** ("versión 1, versión 2"). El `audit_log` lo tiene para forensics, pero no se expone en la UI del comentario.
- **Ampliar el detalle a proyecto/entidades no-tickets** (comentarios en bookings, en clientes, etc.). Solo tickets.

---

## 6. Preguntas abiertas

- **Q-1 · Alcance del aviso al PM primario.** Está pedido "notif de status → PM" en la spec 023, y acá se aplica la misma regla al comentario. **Preferencia inicial: sí, avisar al PM primario también en `ticket_commented`.** Es lo coherente. Riesgo: PMs con muchos proyectos activos reciben mucho ruido — si aparece, se ajusta con preferencias por-usuario en una fase 2 (no en el MVP).
- **Q-2 · ¿El nodo `mention` se habilita también en la descripción del ticket (019) o solo en comentarios?** **Preferencia inicial: solo en comentarios en el MVP.** Cambiar el editor de la descripción arrastra migración de tickets viejos si se quiere aprovechar; la descripción está pensada como "definición" y no como conversación. Si aparece pedido explícito, es aditivo. Si se cierra "también en descripción", el trigger de notif del `PATCH` de tickets necesita el mismo tratamiento (extraer menciones nuevas y avisar) — dos veces la lógica.
- **Q-3 · Copy del email para `ticket_commented` y `ticket_mentioned`.** **Preferencia inicial:**
  - Mentioned: subject "Te mencionaron en {TICKET-key}: {título}". Body: "{Autor} te mencionó en un comentario: <cita del texto plano truncado a 240 chars>. [Ver en DevsCalendar]".
  - Commented: subject "Nuevo comentario en {TICKET-key}: {título}". Body: "{Autor} comentó: <cita truncada>. [Ver en DevsCalendar]".
  Definitivo en el plan.
- **Q-4 · ¿El link a `/tickets/[key]` en el email lleva `#comment-<id>` como anchor?** **Preferencia inicial: sí.** El destino carga con scroll al comentario. Si el comentario fue borrado, cae al ticket sin scroll (comportamiento default del anchor). Sin costo adicional del server.
- **Q-5 · ¿Autocompletado del `@` filtra por match "inicio" o "contains"?** Ej.: tipeo `@ni` — ¿matchea "Nicolás" (inicio) o también "Antonia" (contiene "ni")? **Preferencia inicial: contains, case-insensitive, sobre nombre y email.** Es lo que hace Slack/Linear. Un usuario con nombre corto tipea 2-3 chars y ya lo encuentra.
- **Q-6 · Estilo visual de la mención.** ¿Chip con fondo, texto en color, subrayado? **Preferencia inicial: chip con `bg-brand-50 text-brand-800` inline con el texto** — parecido a Linear. `DESIGN.md` decide el hex final. Consistente entre editor y viewer.
- **Q-7 · ¿Mostrar el comentario que se está editando como "sesión bloqueada" para otros?** Dos sesiones del mismo autor editando en paralelo es un caso raro pero posible. **Preferencia inicial: no bloquear** — resolver con el `expected_updated_at` de AC-5.5, que ya cubre el caso al server. UI-level lock es costo sin valor real.
- **Q-8 · ¿El count de comentarios se actualiza en tiempo real (Supabase Realtime) al abrir la card, o solo al recargar la lista?** **Preferencia inicial: solo al recargar.** Realtime en el backlog y en el kanban es una feature no pedida y con costo (canales, reconexión, RLS de realtime). El count nuevo aparece al navegar a otra ruta y volver.
- **Q-9 · ¿El editor de comentario soporta multi-línea con Enter, o Enter publica?** **Preferencia inicial: Enter = nuevo párrafo, Cmd/Ctrl+Enter = publicar.** Es el patrón de Linear y Slack (el segundo lo hizo dominante). Con el rich text de por medio, un solo Enter que publica es muy fácil de disparar sin querer.
- **Q-10 · ¿Se guarda `edited_at` distinto de `updated_at` para diferenciar "edición de contenido" de "cualquier update de la fila"?** **Preferencia inicial: no**, `updated_at` alcanza. La única cosa que se puede cambiar en un comentario después de crearlo es el `body_doc` — no hay campos administrativos. Si un día se suma "editado el DD/MM" en la UI, `updated_at != created_at` es suficiente para decidir.

---

## 7. Riesgos

- **R-1 · Explosión de notificaciones** — Ticket vivo con 20 miembros y 3 menciones por comentario × 10 comentarios/día. Bandejas saturadas, emails ignorados. **Mitigación:** dedupe estricta en el trigger (AC-2.5, AC-3.2), y roadmap para preferencias por-usuario en fase 2 (silenciar un ticket, elegir "solo menciones"). Aceptar el ruido inicial es OK — el equipo es chico y controla el pedido antes de que sea un problema.
- **R-2 · Mención a alguien que ya no es miembro** — Autor menciona `@Fulana`, PM saca a Fulana del proyecto, edito el comentario o miro el feed. **Mitigación:** el label queda en el JSON (no depende de una lookup vivo), el chip se renderiza igual. Si se hace click, el link a `/admin/users/[id]` cae en 404 o en "usuario no accesible". Aceptar: el rastro histórico vale más que la coherencia con el estado actual. La restricción vive solo al **crear/editar** el comentario (AC-2.3).
- **R-3 · Menciones spam / abuso** — Alguien menciona a los 20 miembros del proyecto en cada comentario para generar ruido. **Mitigación:** aceptar. El equipo es chico, hay `audit_log`, y la solución social gana a la técnica. Si aparece, se limita en el server (máx 10 menciones distintas por comentario).
- **R-4 · Contador de comentarios lento en listas grandes** — Backlog de 500 tickets con `count(*)` por card puede bajar el performance del listado. **Mitigación:** AC-8.3 exige "cero requests adicionales" — resolver con `count` en la query principal (subselect o agregado). En el plan se decide entre `left join + group by`, subquery correlacionada, o materializar `tickets.comment_count int` con trigger. Empezar por el más simple; ajustar si aparece el problema.
- **R-5 · Race con edición del ticket** — Editar el ticket entero (patch de status) mientras alguien comenta. Actualmente `PATCH /api/tickets` compara `expected_updated_at` con `tickets.updated_at`. Los comentarios **no** actualizan `tickets.updated_at`, así que no hay carrera. **Mitigación:** aceptada, ninguna acción. Documentar en el plan.
- **R-6 · `RICH_TEXT_SCHEMA` compartido con la descripción** — Sumar `mention` al schema significa que un cliente puede mandar un doc de **descripción** con menciones y el validador lo acepta (porque el schema es único). Si Q-2 cierra en "solo comentarios", hay que agregar una regla de exclusión al validador de descripción (`NODES_DISABLED_IN_DESCRIPTION`, análogo a `NODES_DISABLED_IN_019`). **Mitigación:** dependiente de Q-2. Si la respuesta es "también en descripción", nada que hacer.
- **R-7 · Feed inicial pesado en tickets viejos** — Ticket con 200 comentarios rich text = HTML server-render largo. **Mitigación:** AC-7.2 pagina a 20 iniciales + "Ver anteriores". Plan decide si es paginación offset o por cursor.
- **R-8 · Mención con `user_id` que no es UUID válido / que apunta a un `service_role`** — El validador Zod tiene que rechazar cualquier cosa que no sea UUID de una fila de `profiles` con `active = true`. **Mitigación:** guardas en dos capas — validador cliente (chequeo de shape) + validador server (lookup contra `profiles`).
- **R-9 · Notificaciones duplicadas si el trigger se dispara por INSERT y UPDATE del mismo comentario en la misma transacción** — Edición rápida ("publiqué → me di cuenta del typo → edité en 3 segundos"). **Mitigación:** el trigger de mención dispara solo por menciones **nuevas** en el UPDATE (comparar `body_doc` viejo vs nuevo), no reenvía las que ya estaban.

---

## 8. Dependencias

- **015-project-membership-and-tickets** — dueña de `tickets`, `project_members`, RLS `can_view_project`, patrón de audit de tickets, guard de contributor-scope. Esta feature **no** re-implementa nada; hereda.
- **019-ticket-rich-editor** — dueña de `RICH_TEXT_SCHEMA`, `<RichTextEditor>`, `<RichTextViewer>`, renderer server, validador. Esta feature **extiende** el schema sumando el nodo `mention` — cambio compartido, hay que ser cuidadosos con el impacto en descripciones existentes (R-6, Q-2).
- **010-notifications-and-audit** — dueña del patrón "trigger escribe la fila en la misma transacción, dispatch aparte" (ADR 0012). Esta feature suma dos `notification_type` nuevos.
- **020-ticket-attachments** — patrón de audit con snapshot completo en delete (aplicable al delete de comentarios). Sin conflicto.
- **023-notify-pm-on-status-change** — spec hermana. La regla "avisar al PM primario" que aplica a status change es la misma que aplica acá al comentario. Independientes técnicamente (dos triggers distintos), pero la lógica de "quién es interesado del ticket" debería vivir en un helper común (`ticket_stakeholders(ticket_id)` → `set of user_id`). **A definir en el plan** si vale sacarlo a un helper compartido o dejarlo duplicado en cada trigger.

---

## 9. Compatibilidad con features futuras

- **Threading (respuestas a un comentario).** Aditivo: `parent_id uuid null references ticket_comments(id) on delete cascade`. El feed pasa a renderizar árbol en lugar de plano. Los comentarios existentes quedan como raíz.
- **Reacciones.** Tabla nueva `ticket_comment_reactions (comment_id, user_id, emoji, primary key (comment_id, user_id, emoji))`. Sin cambios al schema del comentario.
- **Follow / watch.** Tabla `ticket_watchers (ticket_id, user_id)`. El trigger de comentarios suma a los watchers como destinatarios de `ticket_commented`. Sin cambios al comentario.
- **Preferencias por-usuario ("silenciar este ticket", "solo menciones").** Tabla `notification_preferences (user_id, type, muted_target_id)` — filtro adentro de `notify_user()`. No requiere cambios al comentario.
- **Menciones de grupos.** Sumar tipo `mention` con `attrs.kind = 'user' | 'group'` y `attrs.target_id`. El trigger expande grupos a usuarios en el momento del dispatch (snapshot de miembros al notificar, no vinculado dinámicamente).
- **Realtime en el feed de comentarios (nuevo comentario aparece sin recargar).** Supabase Realtime sobre `ticket_comments` filtrado por `ticket_id`. RLS de realtime necesita configuración. Sin cambios al schema.
- **Historial de ediciones visible.** Nueva tabla `ticket_comment_revisions (comment_id, revision_no, body_doc, edited_at, edited_by)`. Trigger en update de `ticket_comments` copia la versión previa. UI muestra "editado el DD/MM (ver historial)".
- **Comentarios en otras entidades (bookings, proyectos).** Refactor de `ticket_comments` a `comments` con `subject_type + subject_id`. Migration destructiva; se hace cuando aparezca el caso concreto, no antes.
