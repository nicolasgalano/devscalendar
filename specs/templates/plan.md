# Plan — <Nombre de la feature>

- **ID:** NNN-<slug>
- **Estado:** draft | ready-to-implement | in-progress | done
- **Spec de referencia:** `./spec.md`

---

## 1. Resumen técnico

Una o dos oraciones sobre **cómo** se va a construir la feature a alto nivel.

---

## 2. Arquitectura

Diagrama conceptual (ASCII / mermaid) o descripción de los componentes involucrados y cómo se comunican.

```
[client] → [next.js route handler] → [supabase (rls-protected)]
                     ↓
             [external api: google/jira/slack]
```

---

## 3. Modelo de datos

### Tablas nuevas

```sql
-- table_name
-- columns, types, constraints
-- FK, unique, checks
```

### Cambios a tablas existentes

- `<table>`: agregar columna `<col>` (`<type>`), motivo.

### RLS policies

- `<table>` select/insert/update/delete: <política breve>.

### Índices

- `<table>(cols)` — motivo.

---

## 4. API surface

### Route handlers Next.js

| Método | Ruta | Body / query | Response | Auth |
| :---- | :---- | :---- | :---- | :---- |
| POST | `/api/...` | ... | ... | PM, Admin |

### Server actions (si aplica)

- `<action>(input)` → `<output>` — motivo.

---

## 5. UI

### Componentes principales

- `<Component>` — responsabilidad, dónde se ubica en la ruta.

### Estados clave

- Loading / empty / error / success — cómo se representan.

### Interacciones críticas

- <interacción y comportamiento esperado>.

---

## 6. Integraciones externas

Si la feature toca Google Calendar / Jira / Slack, detallar:

- Endpoints usados.
- Scopes / permisos OAuth.
- Manejo de rate limits y errores.
- Retries y backoff.

---

## 7. Dependencias entre features

Qué necesita estar mergeado antes. Qué desbloquea.

---

## 8. Riesgos y mitigaciones

- **R-1** — <riesgo técnico>. **Mitigación:** ...

---

## 9. Alternativas consideradas

Brevemente, qué otras rutas se descartaron y por qué. Si alguna es reversible o vale la pena revisitar, dejarlo anotado.

---

## 10. Testing strategy

- **Unit:** qué se cubre.
- **Integration (DB):** qué escenarios.
- **E2E:** qué flujos críticos.
- **Manual:** qué requiere ojos humanos (típicamente UI del calendario).

---

## 11. Rollout

- Feature flag: sí/no. Nombre.
- Migraciones destructivas: sí/no.
- Plan de rollback.
