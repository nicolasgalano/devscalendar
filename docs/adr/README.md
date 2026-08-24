# Architecture Decision Records (ADRs)

Registro de decisiones técnicas y de arquitectura que no son obvias a partir del código o el spec funcional.

## Cuándo escribir un ADR

- Se elige entre varias alternativas y la razón es útil para el futuro.
- Se toma una decisión que afecta a más de una feature.
- Se define una convención transversal (idioma, testing, deploy, etc.).
- Se decide **no** hacer algo por razones no obvias.

**No** hace falta ADR para: convenciones triviales, decisiones locales a una feature (van en su `plan.md`), o cosas ya cubiertas en la constitution.

## Formato

Cada ADR es un archivo `NNNN-<slug>.md`. Se usa el formato corto:

```markdown
# NNNN — Título de la decisión

- **Estado:** proposed | accepted | superseded by NNNN | deprecated
- **Fecha:** YYYY-MM-DD
- **Contexto:** qué situación motiva la decisión.
- **Decisión:** qué se decidió, en una o dos oraciones.
- **Consecuencias:** qué implica esta decisión (positivas, negativas, neutrales).
- **Alternativas consideradas:** brevemente.
```

## Índice

| # | Título | Estado |
| :---- | :---- | :---- |
| 0001 | Tech stack: Next.js + Supabase + Vercel | accepted |
| 0002 | Language conventions: español para docs, inglés para código | accepted |
| 0003 | UI & tooling stack: pnpm + Tailwind + shadcn on demand + Vitest/Playwright | accepted (estilos y componentes reemplazados por 0006) |
| 0004 | Invitación por email: el rol se pre-asigna y el trigger lo consume | accepted |
| 0005 | `audit_log` mínimo en 002, extensible por 010 | accepted |
| 0006 | Tailwind v4 (CSS-first), shadcn sobre Base UI, y DESIGN.md como autoridad | accepted |
| 0007 | Calendario propio sobre CSS grid, en vez de una librería | accepted |
| 0008 | El anti doble-booking vive en dos capas, no en una | accepted |
