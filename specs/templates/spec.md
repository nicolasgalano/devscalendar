# Spec — <Nombre de la feature>

- **ID:** NNN-<slug>
- **Estado:** draft | ready-to-plan | in-progress | done | blocked
- **Owner:** <nombre>
- **Referencias en la spec funcional:** Sección X, Y

---

## 1. Objetivo

Una o dos oraciones que respondan **qué** hace esta feature y **por qué** existe. Sin detalles de implementación.

---

## 2. Contexto

Qué problema del negocio resuelve. A quién impacta. Qué depende de esto que hoy no se puede hacer.

---

## 3. User stories

Formato: `Como <rol>, quiero <capacidad>, para <beneficio>`.

- **US-1** — Como <rol>, quiero <capacidad>, para <beneficio>.
- **US-2** — ...

---

## 4. Acceptance criteria

Por cada user story, en formato **Given / When / Then**.

### US-1

- **AC-1.1** — Given <estado inicial>, when <acción>, then <resultado observable>.
- **AC-1.2** — ...

### US-2

- **AC-2.1** — ...

---

## 5. Alcance

### Dentro

- ...

### Fuera (explícito)

- ...

---

## 6. Dependencias

- Features previas necesarias: NNN-slug, NNN-slug
- Externas: Google Calendar API / Jira / Slack / etc.
- Datos maestros que deben existir: ...

---

## 7. Preguntas abiertas

Trackear preguntas pendientes de confirmación con el cliente (referenciar Sección 11 de la spec funcional cuando aplique).

- **Q-1** — <pregunta>. **Recomendación por defecto:** <recomendación>. **Bloquea:** <sí/no, y qué>.

---

## 8. Métricas de éxito

Cómo sabemos que la feature funciona en producción. Ejemplos: "0 doble-bookings detectados en un mes", "≥95% de reservas se aprueban en <24h".

---

## 9. Riesgos conocidos

- **R-1** — <riesgo>. **Mitigación:** ...

---

## 10. Notas

Cualquier contexto relevante que no entre en las secciones anteriores.
