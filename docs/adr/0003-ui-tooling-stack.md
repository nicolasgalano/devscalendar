# 0003 — UI & tooling stack: pnpm + Tailwind + shadcn on demand + Vitest/Playwright

- **Estado:** accepted — la parte de **estilos y componentes** quedó reemplazada por [0006](./0006-tailwind-v4-base-ui-design-system.md) al implementarse `002`. El resto (pnpm, Zod, Vitest, Playwright) sigue vigente.
- **Fecha:** 2026-07-06

## Contexto

El stack base viene fijado (Next.js + Supabase + Vercel — ADR 0001), pero queda por definir el ecosistema de herramientas alrededor: package manager, framework de estilos, librería de componentes y stack de testing. Estas decisiones aplican transversalmente al proyecto.

## Decisión

- **Package manager: pnpm.** Rápido, eficiente en disco (store global), workspaces nativos si más adelante se separa `packages/`. Es el default recomendado por muchas guías modernas del ecosistema Next.js.
- **Estilos: Tailwind CSS.** Utility-first, cero runtime, DX consolidada. Instalado y configurado desde el scaffold inicial.
- **Componentes: shadcn/ui, agregados on-demand.** No se corre `shadcn init` de entrada — el primer componente se agrega cuando aparece la necesidad (probablemente al arrancar feature 003-calendar-ui: Button, Dialog, Input, Select, DropdownMenu). Se comitean como código propio en `src/components/ui/`.
- **Validación: Zod.** Para validar env vars, payloads de API, y forms.
- **Testing:**
  - **Unit + integration:** Vitest (compatible con Vite, rápido, API tipo Jest).
  - **E2E:** Playwright (multi-browser, screenshots, buen debugging).
  - **DB tests:** ejecutados contra un Supabase local (via CLI) desde el mismo runner de Vitest.

## Consecuencias

**Positivas:**

- Todo el stack es "quiet defaults" bien testeado en la industria — pocos surprises.
- shadcn on-demand evita instalar componentes que nunca vamos a usar y mantiene el bundle chico al inicio.
- Zod + TypeScript strict + Tailwind strict permiten un pipeline de errores tempranos muy sólido.

**Negativas:**

- Vitest tiene menos ecosistema de plugins que Jest, aunque suficiente para lo que necesitamos.
- shadcn requiere copiar/actualizar componentes manualmente (esa es su virtud y su costo).

## Alternativas consideradas

- **npm en vez de pnpm:** simpler pero más lento y consume más disco. Suficiente pero peor para monorepos futuros.
- **Chakra / Mantine / MUI:** más completos out-of-the-box pero acoplan al estilo del vendor y son más difíciles de personalizar para el calendario, que es la UI diferenciadora.
- **Jest + Testing Library:** funciona; Vitest es más rápido y encaja mejor con el ecosistema moderno.
- **Cypress:** válido para E2E; Playwright tiene mejor soporte multi-browser y mejor debugging.
