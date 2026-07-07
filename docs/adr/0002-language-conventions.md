# 0002 — Language conventions: español para docs, inglés para código

- **Estado:** accepted
- **Fecha:** 2026-07-06

## Contexto

La spec funcional del cliente está en español. El equipo es hispanohablante. Al mismo tiempo, el código, las librerías, las convenciones de la industria y las herramientas (git, GitHub, npm, error messages) son en inglés.

Convivir con ambos idiomas requiere una convención explícita para no ir mezclándolos ad-hoc y que el código termine ilegible.

## Decisión

- **En español:**
  - Specs de producto y dominio (`specs/features/*/spec.md`).
  - Plans (`specs/features/*/plan.md`) — narrativa; los nombres técnicos van en inglés.
  - Glosario (`specs/glossary.md`).
  - Constitution — narrativa; los nombres técnicos van en inglés.
  - ADRs de producto o negocio.
  - Copy visible al usuario final (UI, emails, notificaciones).
  - Comentarios en código **solo** cuando explican una regla de dominio en español que el reader del código necesita conocer.

- **En inglés:**
  - Código en general (nombres de variables, funciones, tipos, componentes).
  - Nombres de tablas, columnas, migrations.
  - Tasks (`specs/features/*/tasks.md`) — son accionables técnicos.
  - Commits, PR titles y descripciones.
  - Mensajes de log y de error del sistema (los que quedan en logs).
  - ADRs puramente técnicas.

- **Excepciones justificadas:**
  - Términos del dominio en español que no traducen bien (`reserva`, `desplazada`, `prioritario`, `común`). Se pueden usar en código si están declarados en `specs/glossary.md`. Preferir enums con valores en inglés (`status = 'displaced'`) y una capa de i18n para display.
  - Nombres propios del cliente / marca — se mantienen.

## Consecuencias

**Positivas:**

- Contribuyentes técnicos externos (o herramientas AI) pueden leer el código sin barrera de idioma.
- El equipo puede razonar sobre el dominio en su idioma nativo.
- Menos ambigüedad al revisar PRs — la regla es clara.

**Negativas:**

- Requiere disciplina; es fácil que un comentario largo en español se cuele en el código.
- Traducir enums de dominio a inglés (ej. `displaced` en vez de `desplazada`) puede generar leves desconexiones con la spec. Mitigación: el glosario mapea término español ↔ identificador en código.

## Alternativas consideradas

- **Todo en español:** más natural para el equipo, pero rompe con las convenciones de la industria y complica la incorporación de herramientas y contribuyentes.
- **Todo en inglés:** más "estándar" pero fuerza al equipo a traducir mentalmente conceptos que ya tienen nombre en su idioma, y aleja al cliente de los docs que debería poder leer.
