# Harness SDD — DevsCalendar

Este directorio es el corazón del **Spec-Driven Development** del proyecto. Todo lo que se implementa nace de un spec acá.

## Flujo por feature

```
┌──────────┐   ┌────────┐   ┌───────┐   ┌──────────────┐
│  spec.md │ → │ plan.md │ → │tasks.md│ → │ implementación│
└──────────┘   └────────┘   └───────┘   └──────────────┘
    QUÉ           CÓMO         PASOS         CÓDIGO
   y POR QUÉ    (alto nivel)  (accionable)
```

### 1. `spec.md` — QUÉ y POR QUÉ (español)

- User stories con acceptance criteria en formato Given/When/Then.
- Alcance dentro y fuera.
- Preguntas abiertas que hay que confirmar con el cliente antes de codear.
- Referencias a la spec funcional maestra (`devscalendar-specs.md`).

### 2. `plan.md` — CÓMO alto nivel (español para narrativa, inglés para nombres técnicos)

- Arquitectura de la feature.
- Cambios de modelo de datos (tablas Supabase, RLS policies).
- Superficie de API (rutas, contratos).
- Componentes de UI principales.
- Dependencias de otras features.
- Riesgos y mitigaciones.

### 3. `tasks.md` — PASOS ejecutables (inglés)

- Checklist granular. Cada task chica, verificable, con criterio de "done".
- Ordenadas por dependencia.
- Incluir tests como tasks propias (no como afterthought).

## Convenciones

- Numeración de features: `NNN-<slug-kebab-case>` (ej. `003-calendar-ui`). No renombrar una vez asignado.
- Los stubs de features en `features/` son puntos de partida — se van a expandir cuando la feature entre en desarrollo.
- Cuando se toma una decisión no obvia durante el plan o la implementación, se documenta como ADR en `docs/adr/`.
- El spec maestro (`devscalendar-specs.md`) es la fuente de verdad de producto. Los specs por feature no lo contradicen — lo detallan.

## Cómo crear una feature nueva

```
cp -r specs/templates specs/features/NNN-mi-feature
```

Después editar los tres archivos.

## Estado de las features del MVP

Ver `features/README.md` para el índice y estado de cada feature.
