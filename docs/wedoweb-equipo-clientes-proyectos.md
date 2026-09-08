# WeDo Web — Equipo, clientes y proyectos

Documento de datos estructurados para ingesta automática.
Fuente: captura de la planilla de asignación (Google Sheets) + confirmación verbal de roles y mails por parte del CTO.
Fecha de relevamiento: 7 sep 2026.

**Nota para el sistema que consuma este doc:** los campos marcados `null` o con bloque `PENDIENTE` no deben inferirse ni completarse por defecto. Los slugs (`id`) son estables y pensados como clave primaria.

---

## 1. Personas

| id | nombre | email | rol | en planilla |
|---|---|---|---|---|
| `emiliano` | Emiliano ("Emi") | emiliano@wedoweb.co | Developer | sí |
| `cris` | Cris | cris@wedoweb.co | Developer | sí |
| `brenda` | Brenda | brenda@wedoweb.co | Project Manager | no |
| `lucia` | Lucía | lucia@wedoweb.co | Project Manager | no |
| `nico` | Nicolás Galano | nico@wedoweb.co | CTO | sí |
| `matias` | Matías / "Mati" | null | **sin definir** | sí |
| `bruno` | Bruno | null | **sin definir** | sí |

### Advertencias sobre esta tabla

- **Dominio de los mails asumido.** El CTO los dictó truncados (`@wedo...`). Se completó con `wedoweb.co` porque es hoy el dominio principal del Google Workspace. La organización tiene una migración planificada a `wedoweb.io` (ADR-0001), así que estas direcciones **van a cambiar**. No tratarlas como identificador permanente: usar el campo `id`.
- `matias` y `bruno` aparecen asignados a proyectos en la planilla pero **no tienen rol ni mail confirmado**. Matías figura en 8 proyectos, la segunda carga más alta de todas. Hipótesis abiertas: dev externo/freelance, persona del lado del cliente, o planilla desactualizada. No resuelto.
- La planilla lista 5 personas en su leyenda de colores (Emi, Cris, Matías, Nico, Bruno). Los dos PMs no figuran en ninguna fila.
- La columna de asignación de la planilla está rotulada "Dev" para todas las filas: **la planilla no distingue rol**.

---

## 2. Clientes

| id | nombre | modalidad |
|---|---|---|
| `consensus` | Consensus | recurrente |
| `andocia` | Andocia | recurrente |
| `outcomes-rocket` | Outcomes Rocket | en transición a recurrente |
| `colegio-franco` | Colegio Franco | recurrente |
| `iloan` | iLoan | recurrente |
| `latin-securities` | Latin Securities | recurrente |
| `ee-reed-east` | EE Reed East | **sin etiquetar** |
| `hendy` | Hendy | recurrente |
| `brechner` | Brechner (Shakespear) | **sin etiquetar** |

---

## 3. Proyectos y asignaciones

| id | proyecto | cliente | asignados |
|---|---|---|---|
| `etapro` | EtaPro | `consensus` | `emiliano` |
| `hilco` | Hilco | `consensus` | `cris`, `nico` |
| `htm` | HTM | `andocia` | `cris`, `matias` |
| `andocia-varios` | Varios | `andocia` | `cris`, `matias` |
| `pempal` | PemPal | `outcomes-rocket` | `cris`, `matias` |
| `or-site` | OR Site | `outcomes-rocket` | `matias`, `cris` |
| `retia` | Retia | `outcomes-rocket` | `cris` |
| `or-otros` | Otros | `outcomes-rocket` | `matias` |
| `cfa` | CFA | `colegio-franco` | `emiliano`, `matias`, `cris` |
| `icentral` | iCentral | `iloan` | `emiliano` |
| `iloan-wp-a` | iLoan WP | `iloan` | `matias` |
| `iloan-wp-b` | iLoan WP | `iloan` | `cris` |
| `delta` | Delta | `latin-securities` | **ninguno** |
| `ee-reed-east-proy` | (sin nombre) | `ee-reed-east` | `emiliano`, `cris`, `matias`, `bruno` |
| `hendy-proy` | Hendy | `hendy` | `emiliano` |
| `brechner-proy` | Brechner | `brechner` | `cris`, `emiliano` |

### Notas de lectura

- `hilco`: `nico` aparece en la fila inmediatamente inferior a Hilco, sin nombre de proyecto propio. Se interpretó como parte de Hilco. **Verificar.**
- `iloan-wp-a` / `iloan-wp-b`: el nombre "iLoan WP" aparece dos veces en filas separadas, no como un bloque con dos asignados. Puede ser un mismo proyecto mal agrupado o dos proyectos distintos con el mismo nombre. **Sin resolver — se cargaron como dos registros para no perder información.**
- `ee-reed-east-proy`: único bloque sin nombre de proyecto. Tiene 4 asignados, la mayor concentración de gente de toda la planilla.
- `delta`: sin nadie asignado en la planilla.

---

## 4. Carga por persona

| persona | proyectos | cantidad |
|---|---|---|
| `cris` | hilco, htm, andocia-varios, pempal, or-site, retia, cfa, iloan-wp-b, ee-reed-east-proy, brechner-proy | 10 |
| `matias` | htm, andocia-varios, pempal, or-site, or-otros, cfa, iloan-wp-a, ee-reed-east-proy | 8 |
| `emiliano` | etapro, cfa, icentral, ee-reed-east-proy, hendy-proy, brechner-proy | 6 |
| `nico` | hilco | 1 |
| `bruno` | ee-reed-east-proy | 1 |
| `brenda` | — | 0 |
| `lucia` | — | 0 |

**Concentración detectada:** `cris` es el único asignado de los dos devs internos en la totalidad de `andocia` y de `outcomes-rocket` (4 proyectos). Bus factor 1 sobre dos clientes recurrentes completos.

---

## 5. PENDIENTE — huecos de datos a completar

Ordenados por impacto sobre la integridad del modelo:

1. **Asignación de PMs por cliente.** `brenda` y `lucia` son PMs confirmados pero no existe registro de qué cliente o proyecto lleva cada una. Este dato no está en ninguna fuente escrita.
2. **Rol de `matias`.** 8 proyectos asignados, rol desconocido.
3. **Rol de `bruno`.** 1 proyecto asignado, rol desconocido.
4. **Filas 36–38 de la planilla están ocultas**, entre el bloque `iloan` y el de `latin-securities`. Puede haber un cliente o proyecto no relevado.
5. **Mails de `matias` y `bruno`** — si son internos, deberían tener casilla; si no la tienen, es evidencia de que son externos.
6. **Dominio real de los mails** (`wedoweb.co` vs `wedoweb.io`) — confirmar antes de usar los emails como identificador en cualquier integración.
7. **Nombre del proyecto de `ee-reed-east`** y su modalidad (recurrente / no recurrente).
8. **Modalidad de `brechner`** (recurrente / no recurrente).
9. **Responsable de `delta`.**

## 6. Normalizaciones aplicadas

- "Mati" y "Matias" unificados en `matias`. La planilla usa las tres formas ("Matías", "Matias", "Mati").
- "Emi" resuelto a `emiliano` según el mail dictado.
- "Branda" (primera mención verbal) corregido a **Brenda** según el mail `brenda@`.
- "Nico" resuelto a Nicolás Galano (CTO, titular del vault).
