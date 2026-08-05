# 0006 — Tailwind v4 (CSS-first), shadcn sobre Base UI, y DESIGN.md como autoridad

- **Estado:** accepted
- **Fecha:** 2026-08-04
- **Reemplaza parcialmente:** 0003 (la parte de estilos y componentes)

## Contexto

`0003` fijó "Tailwind CSS" y "shadcn/ui agregado on-demand" sin atarse a versiones. Al llegar el primer uso real de shadcn (feature `002`, pantallas de administración) aparecieron dos cosas que esa decisión no contemplaba:

1. El CLI actual de shadcn genera componentes para **Tailwind v4** (`@import "tailwindcss"`, theming con `@theme`, sin `tailwind.config.ts`). El repo estaba en **v3** con pipeline PostCSS clásico. El output no compilaba: las clases de color no generaban CSS.
2. El preset por defecto (Nova) construye sobre **Base UI**, no sobre Radix, que es lo que la mayoría asocia con shadcn.

En paralelo, las primeras pantallas quedaron genéricas: los defaults de shadcn (filas de 48px, inputs de 40px, radios de 10px) son cómodos para un sitio y demasiado holgados para una herramienta densa que se usa ocho horas por día.

## Decisión

- **Tailwind v4, CSS-first.** Se eliminó `tailwind.config.ts`; el theming vive en `src/app/globals.css` con `@theme inline`. `postcss.config.mjs` usa `@tailwindcss/postcss` (ya no `tailwindcss` + `autoprefixer`).
- **shadcn preset Nova sobre Base UI.** Los componentes se comitean en `src/components/ui/` y se ajustan a la escala de densidad **en el momento de instalarlos**.
- **`DESIGN.md` manda sobre los defaults de shadcn y sobre cualquier criterio estético propio.** Define tokens de color, escala tipográfica, densidad, estados de interacción y una checklist de 15 puntos que toda pantalla tiene que pasar antes de darse por terminada. `CLAUDE.md` obliga a leerlo antes de crear o modificar una vista.

El mapeo de radios en `globals.css` está elegido para que el `rounded-lg` que shadcn genera caiga en los 4px que pide `DESIGN.md`, y el `rounded-xl` del dialog en 6px. Así los componentes nuevos cumplen la escala sin editar cada archivo.

## Consecuencias

**Positivas:**

- El output del CLI de shadcn funciona sin parches, hoy y en las próximas instalaciones.
- Tailwind v4 es sensiblemente más rápido y el theming en CSS deja los tokens en un solo lugar, legible sin saber Tailwind.
- `DESIGN.md` convierte "que se vea bien" en algo verificable. La checklist se recorre punto por punto y se reporta.

**Negativas / a mitigar:**

- Base UI tiene menos ejemplos en la comunidad que Radix, y su API difiere en detalles que muerden: los componentes polimórficos usan `render={...}` en vez de `asChild`, y un `Button` que renderiza un `<a>` necesita `nativeButton={false}` o tira un warning de accesibilidad en runtime.
- Tailwind v4 rompe recetas de v3 encontradas en internet (`theme.extend`, plugins, `@apply` en algunos contextos). El equipo tiene que buscar documentación de v4 explícitamente.
- Cada componente nuevo de shadcn llega con las alturas y radios del vendor: hay que ajustarlo al instalarlo o la escala se degrada de a poco.

## Alternativas consideradas

- **Quedarse en Tailwind v3 y adaptar a mano el output de shadcn:** mantiene el stack declarado en `0003`, pero obliga a reescribir el CSS generado en cada `shadcn add`, para siempre. Se descartó por costo recurrente.
- **Preset de shadcn sobre Radix:** más material de referencia disponible, pero el CLI actual empuja Nova/Base UI como default; forzar Radix era pelearse con la herramienta en cada instalación.
- **No adoptar un documento de diseño y decidir caso por caso:** era el estado previo. Producía pantallas correctas pero indistinguibles entre sí, y ninguna forma objetiva de decir si una vista estaba terminada.
