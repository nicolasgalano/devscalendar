# DESIGN.md

Sistema de diseño de DevsCalendar: el panel interno donde los PMs reservan tiempo de desarrolladores sobre proyectos y los devs aprueban o rechazan esas reservas.

**Cómo usar este archivo:** `CLAUDE.md` ya incluye la línea que obliga a leerlo antes de crear o modificar cualquier vista. Este documento manda sobre los defaults de shadcn/ui y sobre cualquier criterio estético propio. Al terminar una pantalla, verificá la checklist de la sección 13.

**Vocabulario:** usar siempre los términos del producto (`reserva`, `proyecto`, `cliente`, `desarrollador`, `PM`, `prioritario`), nunca los de la base de datos (`booking`, `profile`, `high`). Ver `docs/adr/0002-language-conventions.md`.

---

## 1. Qué es este producto

Una herramienta interna de planificación de recursos. Los PMs la usan durante toda su jornada para reservar horas de desarrolladores sobre proyectos; los desarrolladores la usan para confirmar o rechazar esas reservas; los administradores mantienen los datos maestros.

Consecuencias directas, no negociables:

- **No es un sitio web.** No hay hero, no hay contenedor centrado, no hay secciones con aire de landing.
- **La densidad es una feature.** El calendario tiene que mostrar la mayor cantidad de días, carriles y bloques por pantalla. Cada píxel de padding decorativo le cuesta contexto al usuario.
- **Se usa ocho horas por día.** El diseño tiene que aguantar la mirada repetida: bajo contraste cromático de fondo, alto contraste tipográfico, cero animación gratuita.
- **Lo que reclama atención es la información principal.** Si un PM entra y no sabe en tres segundos qué reservas le rechazaron, cuáles le desplazaron y dónde hay un conflicto, el diseño falló.

## 2. Dirección estética

Base de consola densa y neutra, con un sistema de señalización por encima.

La personalidad no viene del color ni de una tipografía decorativa: viene de la densidad, de las hairlines, de la numeración tabular y de un sistema de estado visiblemente riguroso. La apuesta visual del producto es una sola: **fuera del calendario, el color aparece solo cuando algo reclama atención.** Todo lo demás es gris.

Prohibido explícitamente:

- Gradientes de cualquier tipo, incluidos los sutiles en botones o headers.
- Sombras decorativas. Solo se permite sombra en elementos flotantes reales (dropdown, popover, dialog, toast).
- Emojis en la interfaz.
- Border-radius mayor a 6px.
- Ilustraciones genéricas de stock en empty states.
- Colores de marca aplicados a superficies grandes.
- Glassmorphism, blur de fondo, efectos de vidrio.

### La excepción del calendario

La spec funcional (§4.2) pide que los bloques del calendario se coloreen **por proyecto o por desarrollador**, conmutable según el modo de agrupación. Eso es color categórico sobre superficies, y contradice la regla de arriba. Es una excepción deliberada y acotada, con tres condiciones:

1. La paleta categórica **solo** se usa dentro de la grilla del calendario. Nunca en tablas, formularios, navegación ni badges.
2. Los colores categóricos son de baja saturación y luminosidad pareja, para que las señales de atención (conflicto, desplazada, rechazada) se lean **por encima** de ellos y no compitan.
3. El color categórico nunca es el único identificador del bloque: el bloque siempre muestra desarrollador y proyecto en texto.

### La paleta categórica

Definida en `003-calendar-ui`. Ocho hues, dos tokens cada uno: `--cat-N-surface` (relleno del bloque) y `--cat-N-line` (barra izquierda de 2px). El texto del bloque va **siempre** en `--foreground`, nunca en un color derivado del hue.

| # | Hue | | # | Hue |
| --- | --- | --- | --- | --- |
| 1 | pizarra | | 5 | verde azulado |
| 2 | índigo | | 6 | verde |
| 3 | azul | | 7 | violeta |
| 4 | cian | | 8 | rosa |

Tres reglas que no se negocian:

1. **La paleta excluye ámbar, naranja y rojo.** Están reservados para `--priority-high`, `--attention` y `--danger`. Un bloque naranja "color por proyecto" sería indistinguible de uno que reclama acción, que es justo lo que prohíbe la condición 2 de arriba.
2. **Las ocho superficies tienen la misma luminancia** (1.30:1 contra el fondo en claro, dispersión 0.0045). No es cosmético: si un hue pesa más que otro, la grilla sugiere una importancia que no existe.
3. **La asignación es un hash determinístico del uuid** (`src/lib/calendar/palette.ts`), siguiendo el eje de agrupación activo. Dos entidades pueden compartir hue; es aceptable porque el bloque siempre muestra desarrollador y proyecto en texto.

Cuando una reserva está **rechazada o desplazada**, la barra izquierda cambia de su color categórico a `--attention`. Así la señal de atención se lee por encima del color de identidad, en vez de competir con él.

## 3. Tokens de color

Definidos en `src/app/globals.css` y expuestos a Tailwind v4 con `@theme inline`. **Nunca hardcodear un hex en un componente.**

```css
:root {
  --background: #ffffff;
  --foreground: #18181b;
  --surface: #fafafa;
  --surface-hover: #f4f4f5;
  --surface-active: #eff4fe;

  --muted: #f4f4f5;
  --muted-foreground: #71717a;
  --secondary-foreground: #52525b;

  --border: #e4e4e7;
  --border-strong: #d4d4d8;
  --input: #e4e4e7;

  --primary: #2f6feb;
  --primary-foreground: #ffffff;
  --ring: #2f6feb;

  /* Prioridad de proyecto — dos niveles (spec funcional §7). */
  --priority-high: #ea580c;      /* prioritario */
  --priority-high-bg: #fff7ed;
  --priority-normal: #52525b;    /* común: gris, a propósito */
  --priority-normal-bg: #f4f4f5;

  /* Reclama acción del usuario: reserva rechazada o desplazada. */
  --attention: #a16207;
  --attention-bg: #fefce8;

  /* Bloqueo o daño: conflicto de reserva, acciones destructivas.
     Ajustado en 003: #dc2626 daba 4.41:1 sobre --danger-bg, por debajo de AA. */
  --danger: #cf2020;
  --danger-bg: #fef2f2;

  --radius: 4px;
}

.dark {
  --background: #0a0a0b;
  --foreground: #fafafa;
  --surface: #141416;
  --surface-hover: #1c1c1f;
  --surface-active: #16233d;

  --muted: #1c1c1f;
  --muted-foreground: #71717a;
  --secondary-foreground: #a1a1aa;

  --border: #27272a;
  --border-strong: #3f3f46;
  --input: #27272a;

  --primary: #4b86f0;
  --primary-foreground: #0a0a0b;
  --ring: #4b86f0;

  --priority-high: #fb923c;
  --priority-high-bg: #291708;
  --priority-normal: #a1a1aa;
  --priority-normal-bg: #1c1c1f;

  --attention: #facc15;
  --attention-bg: #241d05;

  --danger: #f87171;
  --danger-bg: #2a1315;
}
```

### Reglas de uso del color

1. **Un solo acento.** `--primary` se usa para: item activo de navegación, links, foco, y la única acción primaria de cada vista. Nada más.
2. **Fuera del calendario, el color solo señala prioridad o algo que reclama acción.** Prioridad de proyecto, reserva rechazada, reserva desplazada y conflicto son los únicos sistemas cromáticos.
3. **El estado normal de una reserva no lleva color.** Pendiente, aprobada y cancelada se comunican con icono y peso tipográfico. Solo rechazada, desplazada y en conflicto suman color, porque exigen que alguien haga algo.
4. **Prioridad común no lleva color.** Usa el gris neutro. Si todo tiene color, nada resalta.
5. **Cero color en superficies grandes.** Fondos, headers, sidebar y cards son siempre neutros. La grilla del calendario es la única excepción (§2).
6. **El dark mode no es una inversión.** Los fondos oscuros son casi negros con superficies elevadas apenas más claras; los acentos suben en luminosidad y bajan en saturación respecto del modo claro.

> **Nota sobre la escala de prioridad.** Hoy hay dos niveles porque así lo pidió el cliente (spec funcional §7) y así está el modelo de datos (`normal` | `high`). La Q-2 de la spec deja abierto pasar a un esquema numérico P0–P3. Si eso se resuelve, la escala se extiende agregando tokens intermedios entre `--priority-normal` y `--priority-high`; **este documento no decide esa pregunta**, la spec funcional manda.

### Dark mode

Implementado con `next-themes`, clase `.dark` en `<html>`, con las tres opciones: claro, oscuro, sistema. Por defecto: sistema. La elección se persiste y se aplica antes del primer paint para evitar el flash de tema incorrecto.

**Toda pantalla que se construya tiene que revisarse en ambos modos antes de darse por terminada.**

## 4. Tipografía

| Rol | Familia | Uso |
| --- | --- | --- |
| Interfaz | Archivo (variable) | Todo el texto de la aplicación |
| Datos | JetBrains Mono | Horarios, duraciones, fechas, ids de reserva, tickets de Jira |

No hay tipografía display separada. En una herramienta densa, el título de página es la misma familia a 20px con tracking ajustado. Esa contención es deliberada.

```css
body {
  font-family: Archivo, ui-sans-serif, system-ui, sans-serif;
  font-feature-settings: "cv05" 1;
}
.font-data { font-family: "JetBrains Mono", ui-monospace, monospace; }
```

**Números tabulares obligatorios.** Cualquier columna o celda con números (horarios, duraciones, contadores de ocupación, fechas) lleva `font-variant-numeric: tabular-nums` — la utilidad `.font-data` ya lo aplica. Sin esto las columnas bailan y la grilla se vuelve ilegible.

### Escala

| Token | Tamaño / interlineado | Uso |
| --- | --- | --- |
| `text-caption` | 11px / 16px | Metadatos, horarios dentro de un bloque, labels de columna |
| `text-ui` | 13px / 18px | Base de la aplicación: filas de tabla, labels, inputs |
| `text-emphasis` | 14px / 20px | Títulos de fila, nombres de cliente o proyecto, valores destacados |
| `text-section` | 16px / 24px | Encabezados de sección y de card |
| `text-title` | 20px / 28px, tracking -0.01em | Título de página |

**Solo dos pesos: 400 y 500.** Nunca 600 ni 700. En una interfaz densa el peso alto es ruido.

Los labels de columna van en `text-caption`, peso 500, color `--muted-foreground`, en formato oración. Sin mayúsculas sostenidas ni letter-spacing exagerado.

## 5. Espaciado, densidad y radios

Escala de espaciado: `4 · 8 · 12 · 16 · 24 · 32`. Nada intermedio, nada mayor a 32px dentro de una vista de trabajo.

| Elemento | Alto |
| --- | --- |
| Fila de tabla | 36px (modo compacto: 32px) |
| Input, select, botón | 32px |
| Item de navegación | 32px |
| Barra superior | 48px |

**Los defaults de shadcn son demasiado altos para este producto** y ya están sobrescritos en `src/components/ui/`. Si se instala un componente nuevo con `h-10` o `py-4`, ajustalo a esta escala en el momento de instalarlo, no después.

Radios: `4px` en controles e inputs, `6px` en cards y popovers, `0` en filas de tabla. Los avatares son el único elemento circular. El mapeo de `--radius-*` en `globals.css` hace que el `rounded-lg` de shadcn caiga en 4px y el `rounded-xl` del dialog en 6px, sin tocar cada componente.

Bordes: `1px solid var(--border)` siempre. La separación entre filas es un borde inferior, nunca un `gap` ni un `box-shadow`.

### Densidad de la grilla del calendario

Definida en `003-calendar-ui`:

| Elemento | Medida |
| --- | --- |
| Franja de 30 min (vista Día) | 24px de alto |
| Carril (dev o proyecto) | 160px de ancho mínimo, con scroll horizontal |
| Columna de horas | 56px |
| Celda de día (vista Mes) | 96px de alto mínimo |
| Celda de día (vista Año) | 12px |

La vista Día muestra por defecto **09:00–17:00**, la jornada real (Q-F), y el rango se calcula siempre como `min(09:00, primer inicio) … max(17:00, último fin)`. Reservar fuera de horario es excepcional pero está permitido (Q-G), así que la grilla se estira: **nunca se recorta una reserva**. Las franjas fuera de la jornada van con fondo `--muted`.

Encabezados y cuerpo comparten **un solo `grid-template-columns`**; la separación entre ambas filas se declara una vez con `row-gap`, no con un margen por columna.

## 6. Layout de la aplicación

```
┌──────────┬────────────────────────────────────────────────┐
│ sidebar  │ barra superior 48px · ubicación + acciones     │
│ 240px    ├────────────────────────────────────────────────┤
│ fija     │                                                │
│          │  contenido — ancho completo, padding 24px      │
│          │                                                │
└──────────┴────────────────────────────────────────────────┘
```

- **El shell ocupa el 100% del viewport. No hay contenedor centrado con ancho máximo.**
- Sidebar de 240px, fija, colapsable a 56px (solo iconos) con la preferencia persistida.
- El único lugar donde se aplica ancho máximo es en formularios y texto corrido de lectura: `max-width: 640px`. **Nunca en el calendario, tablas o listas.**
- El scroll vive en el área de contenido, no en la página. La barra superior y los encabezados de tabla quedan fijos (`position: sticky`).
- Breakpoint de colapso del sidebar: 1024px. Por debajo pasa a drawer.
- Las pantallas de autenticación (`/login`, `/pending-access`) quedan fuera del shell: son formularios centrados y angostos, y esa es la excepción correcta.

Implementado en `src/components/app-shell.tsx`, aplicado por el route group `src/app/(app)/`.

## 7. Estados de interacción

Esta sección existe porque es la que más se omite. **Todo elemento interactivo define los cinco estados.** Un componente sin estado activo o sin foco visible no está terminado.

### Navegación

| Estado | Tratamiento |
| --- | --- |
| Default | Texto `--secondary-foreground`, fondo transparente, icono al 100% |
| Hover | Fondo `--surface-hover`, texto `--foreground` |
| **Activo** | Fondo `--surface-active`, texto `--primary`, peso 500, barra de 2px en `--primary` sobre el borde izquierdo del item |
| Foco | `outline: 2px solid var(--ring); outline-offset: -2px` |
| Deshabilitado | Opacidad 50%, `cursor: not-allowed` |

El item activo lleva `aria-current="page"`. **La determinación de activo es por coincidencia de segmento de ruta, no por igualdad exacta:** una ruta de detalle como `/admin/projects/42` mantiene activo el item `Proyectos`.

### Filas de tabla

Default transparente · hover `--surface-hover` · seleccionada `--surface-active` con barra de 2px a la izquierda · foco con outline de 2px hacia adentro.

Cuando una tabla tenga vista de detalle asociada, sus filas se navegan con flechas y `Enter` abre el detalle. Mientras no exista esa vista, no se implementa navegación por teclado en filas: una fila focusable que no lleva a ningún lado es una trampa para el usuario de teclado.

### Botones

Una sola acción primaria por vista. Todo lo demás es secundario (borde, fondo transparente) o fantasma. Los botones destructivos son secundarios con texto en `--danger`, nunca rojos sólidos, salvo dentro de un diálogo de confirmación.

Cuando una lista está vacía, la acción primaria vive en el empty state y desaparece del encabezado: así se cumple a la vez "un botón con verbo en el vacío" (§9) y "una sola acción primaria por vista".

Evitar botones deshabilitados: mantenelos activos y explicá el problema al usarlos. Si hay que deshabilitar, el motivo va en un tooltip.

## 8. Sistema de estado

### Prioridad de proyecto

Badge de 20px de alto, `text-caption` peso 500, radio 4px, fondo `--priority-{nivel}-bg`, texto `--priority-{nivel}`. Sin borde.

Niveles: `prioritario` · `común`. El común usa el gris neutro por diseño.

### Estado de una reserva

Los cinco estados de la spec funcional (§5.2) se comunican con **icono de línea + texto**, no con color de fondo:

| Estado | Icono | Color del texto |
| --- | --- | --- |
| Pendiente | `circle-dashed` | `--secondary-foreground` |
| Aprobada | `circle-check` | `--secondary-foreground` |
| Cancelada | `circle-slash` | `--muted-foreground` |
| **Rechazada** | `circle-x` | `--attention` |
| **Desplazada** | `arrow-right-left` | `--attention` |

Rechazada y desplazada llevan color porque obligan al PM a reasignar; el resto no. Las reservas canceladas bajan el título de su fila o bloque a `--muted-foreground`.

### Conflicto

Un conflicto (doble booking, o realocación bloqueada entre proyectos del mismo nivel — spec §7.1) se marca con icono `alert-triangle` y texto en `--danger`, más una explicación de una línea de qué lo bloquea. **Nunca solo el color:** el motivo siempre está en texto.

**Advertir y bloquear no comparten tratamiento.** Lo que impide seguir usa `alert-triangle` sobre `--danger`; lo que solo avisa —reservar fuera de la jornada o en un feriado, que es excepcional pero está permitido (Q-G)— usa `circle-alert` sobre `--attention` y deja el botón de guardar activo. Si las dos cosas se vieran igual, el usuario aprendería a ignorar las dos.

### Ocupación de un desarrollador

Barra horizontal de 56×4px con radio 2px, acompañada de las horas en tipografía de datos (`.font-data`). Neutra por debajo del 100% de la capacidad del día; en `--attention` al llegar al 100%; en `--danger` por encima (sobreasignación).

**El color nunca es el único portador de información.** Las horas asignadas se muestran siempre en texto al lado de la barra.

### Rampa de ocupación (vistas Mes y Año)

Misma lógica aplicada a la celda de un día completo. Ocupación = horas reservadas / (desarrolladores considerados × 8 h), donde la jornada es 09:00–17:00 (Q-F).

| Ocupación | Fondo |
| --- | --- |
| Día no laborable | `--muted`, número en `--secondary-foreground` |
| 0% | `--load-0` (transparente) |
| 1–33% | `--load-1` |
| 34–66% | `--load-2` |
| 67–99% | `--load-3` |
| 100% | `--attention-bg` |
| >100% | `--danger-bg` |

Fines de semana y feriados argentinos tienen capacidad 0: no se les calcula porcentaje, y si tienen reservas se marcan como sobreasignados. Un sábado con reservas es raro y por eso tiene que saltar a la vista.

**El número del día y el contador de reservas van en `--foreground`, nunca en `--muted-foreground`:** medido en `003`, ese token cae a 3.27:1 sobre `--load-3` y a 4.40:1 sobre `--muted`, ambos por debajo de AA. El contador está siempre en texto; la rampa es refuerzo.

### Desarrollador asignado

Avatar circular de 20px con iniciales sobre `--muted` cuando no hay foto, seguido del nombre abreviado (`M. Rojas`). Sin asignar se muestra como avatar punteado con la palabra `Sin asignar` en `--muted-foreground`, y es un control clickeable, no texto muerto.

## 9. Estados de datos

Toda vista que cargue datos implementa los cuatro. Ninguno es opcional.

- **Cargando:** skeletons con la forma exacta del contenido final, respetando el alto de fila de 36px. Nunca un spinner centrado en la página. Sin animación de pulso si el usuario tiene `prefers-reduced-motion`. Usar `TableSkeleton` desde un `loading.tsx`.
- **Vacío:** título que nombra el espacio, una línea de explicación y un botón con verbo. Sin ilustración. Ejemplo: `Sin reservas esta semana` / `Las reservas que crees para tu equipo aparecen acá.` / `Crear reserva`.
- **Sin resultados de filtro:** distinto del vacío. Dice qué filtro está aplicado y ofrece limpiarlo. El calendario es filtrable por cliente, proyecto, desarrollador, PM, estado y prioridad (spec §4.4): este estado va a ser frecuente.
- **Error:** qué pasó y qué hacer, en una línea, con botón de reintentar. Sin prefijo `Error:`, sin primera persona, sin exponer el mensaje crudo de la excepción.

Componentes disponibles: `EmptyState`, `NoResultsState`, `TableSkeleton`, y el error boundary de `src/app/(app)/error.tsx`.

## 10. Movimiento

Duraciones: 120ms para cambios de estado, 180ms para entrada de popovers y drawers. Curva `cubic-bezier(0.2, 0, 0, 1)`.

Solo se animan `opacity` y `transform`. Nada de animar alto, ancho o color de fondo. Arrastrar y soltar bloques en el calendario sigue la misma regla: se transforma el bloque, no se reflowea la grilla.

Respetar `prefers-reduced-motion: reduce` desactivando toda transición no esencial.

## 11. Microcopy

- Español rioplatense neutro, en formato oración siempre. Nunca capitalización de título ni mayúsculas sostenidas.
- Los botones empiezan con verbo y tienen entre una y tres palabras: `Crear reserva`, `Aprobar reserva`, `Asignar desarrollador`. Nunca `Aceptar`, `Enviar` ni `Confirmar` sueltos.
- La acción conserva su nombre en todo el flujo: el botón `Aprobar` produce el aviso `Aprobada`.
- Nombrar las cosas como las nombra el PM, no como las nombra la base de datos: `reserva`, no `booking`; `prioritario`, no `high`.
- Sin `por favor`, sin `exitosamente`, sin signos de exclamación.
- Los placeholders muestran un ejemplo real de entrada válida, no repiten el label.
- Las fechas recientes van en relativo (`hace 2 h`) con la fecha absoluta en el `title`. Más de siete días, fecha absoluta. Los horarios de una reserva siempre son absolutos (`09:00–13:00`), nunca relativos.

## 12. Accesibilidad

- Contraste mínimo AA: 4.5:1 en texto, 3:1 en bordes de controles. Verificar en ambos temas.
- Foco visible en todo elemento interactivo. Prohibido `outline: none` sin reemplazo.
- Todo icono sin texto lleva `aria-label`; los decorativos llevan `aria-hidden="true"`.
- La aplicación se opera completa con teclado. Los diálogos atrapan el foco y lo devuelven al cerrarse.
- Los cambios de estado asíncronos se anuncian en una región `aria-live`.
- El calendario necesita una alternativa no visual: los bloques son elementos enfocables con un nombre accesible que incluya desarrollador, proyecto, horario y estado.

## 13. Checklist antes de dar una pantalla por terminada

Recorrer esta lista de forma explícita y reportar el resultado punto por punto.

1. ¿El layout ocupa el ancho completo, sin contenedor centrado con ancho máximo?
2. ¿El item de navegación correspondiente aparece activo, incluso en rutas de detalle?
3. ¿Todos los elementos interactivos tienen los cinco estados definidos?
4. ¿El foco de teclado es visible en cada control?
5. ¿Se ve correcta en modo claro y en modo oscuro?
6. ¿Todos los colores salen de tokens, sin ningún hex hardcodeado?
7. ¿Las alturas de fila y de control respetan la escala de densidad, y no los defaults de shadcn?
8. ¿Las celdas numéricas (horarios, duraciones, contadores) usan numeración tabular?
9. ¿Están implementados los cuatro estados de datos: cargando, vacío, sin resultados y error?
10. ¿El color aparece únicamente en prioridad y en lo que reclama acción, más el acento único de navegación y acción primaria — y el categórico solo dentro del calendario?
11. ¿Hay una sola acción primaria en la vista?
12. ¿La información codificada por color está también disponible como texto o icono?
13. ¿El microcopy usa el vocabulario del producto, en formato oración y con verbos al principio?
14. ¿Se respeta `prefers-reduced-motion`?
15. ¿Funciona a 1280px y a 1440px de ancho, y colapsa correctamente por debajo de 1024px?

## 14. Estado de aplicación del sistema

Aplicado en la feature `002-entities-admin`:

- Tokens, escala tipográfica, densidad y radios en `src/app/globals.css`.
- Shell de ancho completo con sidebar colapsable y navegación con estado activo por segmento.
- Dark mode con las tres opciones.
- Componentes de shadcn ajustados a la escala de densidad.
- Vistas `/`, `/login`, `/pending-access` y `/admin/*` con los cuatro estados de datos.

Aplicado en la feature `003-calendar-ui`:

- **Paleta categórica** (§2) y **rampa de ocupación** (§8), con contraste verificado en ambos temas.
- **Densidad de la grilla** (§5): franjas, carriles y celdas de mes y año.
- **Estados de reserva** (§8) — `BookingStatusTag`, usado en el bloque y en su detalle. `004`/`005` lo reusan.
- **Estado "sin resultados de filtro"** (§9), que además nombra el filtro aplicado y ofrece limpiarlo.
- Ajuste de `--danger` a `#cf2020`: el valor anterior no llegaba a AA sobre `--danger-bg`.

Aplicado en la feature `004-bookings`:

- **Estado de conflicto** (§8) — `alert-triangle`, texto en `--danger`, el motivo en palabras y un link a la reserva que bloquea, en el diálogo de reserva. El color no porta nada que no esté también escrito.
- **Botón con verbo en el empty state del calendario** (§9) — `Crear reserva`, que además es la única acción primaria de la vista: vive en el encabezado cuando hay reservas y se muda al empty state cuando no las hay (§7).
- **Advertencias sin bloqueo** (§8, la excepción de Q-G) — jornada y día no laborable se advierten en `--attention` con `circle-alert`, nunca en `--danger` y nunca deshabilitando guardar. `alert-triangle` queda reservado para el conflicto, que sí impide seguir.
- **Diálogo de confirmación destructivo** (§7) — cancelar una reserva es terminal, así que pasa por confirmación; es el único lugar donde el botón destructivo lleva fondo propio.

Pendiente, por depender de features todavía no construidas:

- **Navegación por teclado en filas** (§7) — cuando exista una vista de detalle a la que abrir.
- **Barra de ocupación individual** (§8) — la rampa por día ya existe; la barra de 56×4px por desarrollador llega con la vista de detalle de una persona.
