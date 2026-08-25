# Estrategia de testing

Cómo se prueba DevsCalendar, dónde corre cada nivel y por qué. **Leer esto antes de tocar tests, migrations o código que hable con Supabase.**

La restricción que define todo lo demás: **la máquina de desarrollo no puede correr Docker** (ni RAM ni disco), y **no hay un segundo proyecto de Supabase**. Así que los tests que necesitan servicios reales corren en CI, contra un stack que nace y muere con el job.

---

## 1. Los cinco niveles

| Nivel | Dónde corre | Contra qué | Comando |
| :---- | :---- | :---- | :---- |
| **Unitarios** | Local y CI | Nada. Funciones puras y Supabase mockeado | `pnpm test:unit` |
| **Smoke** | Solo CI | Stack efímero (PostgREST + GoTrue) | `pnpm test:smoke` |
| **Integración** | Solo CI | Stack efímero (RLS, triggers, constraints) | `pnpm test:integration` |
| **E2E** | Solo CI | Stack efímero + la app en el puerto 3100 | `pnpm test:e2e` |
| **Manual** | Tu navegador | Proyecto remoto de desarrollo | — |

**El único nivel que corre en tu máquina es el unitario.** Es deliberado: son 129 tests en unos 4 segundos, sin credenciales ni infraestructura, y cubren toda la lógica que no depende de un servidor.

### Qué usa mocks y qué usa servicios reales

- **Mockeado:** el cliente de Supabase en `tests/unit/`. El doble está en `tests/unit/helpers/supabase-mock.ts` y sirve para probar el mapeo de respuestas, qué filtros termina aplicando cada query y el manejo de errores.
- **Real:** todo lo demás. RLS, triggers, el `exclusion constraint`, los embeds de PostgREST y el login contra GoTrue se prueban contra servicios de verdad, nunca simulados.

**Los mocks no reemplazan a los tests de integración, los complementan.** Un mock que "verifique" una policy de RLS no verifica nada: estaría probando el mock.

---

## 2. Por qué un PostgreSQL suelto no alcanza

La tentación evidente, teniendo que correr algo en CI, es levantar un contenedor `postgres:15` y listo. No sirve, por dos motivos concretos:

**PostgREST resuelve los embeds en el servidor.** El calendario lee así:

```ts
dev:profiles!bookings_dev_id_fkey (id, full_name, email),
project:projects!inner ( id, name, client:clients!inner (id, name) )
```

Eso no es SQL: es una sintaxis que PostgREST traduce. `bookings` apunta **dos veces** a `profiles` (`dev_id` y `created_by`), así que sin el nombre del constraint la relación es ambigua y la query falla. El `!inner` decide si una fila que no matchea **desaparece** o vuelve con el embed en `null` — o sea, decide si el filtro por cliente filtra de verdad. Nada de eso existe en un Postgres pelado, y un mock tampoco lo puede ver: un typo en ese string pasa verde y rompe en runtime.

**GoTrue emite los JWT que la RLS usa para decidir.** Las policies preguntan por `auth.uid()`, que sale del token. Los tests inician sesión de verdad (`signInWithPassword`) para que la RLS reciba un usuario real. Sin GoTrue habría que falsificar el claim a mano, y estaríamos probando nuestra falsificación en lugar del camino que usa la app.

Por eso el stack efímero incluye Postgres **y** PostgREST **y** GoTrue.

---

## 3. El stack efímero en CI

`.github/workflows/tests.yml` levanta Supabase dentro del runner con el CLI, en una versión **fijada** (`SUPABASE_CLI_VERSION`) porque el formato de `supabase status` y los nombres de los contenedores cambian entre versiones.

### Qué se levanta y qué no

```
supabase start -x studio,storage-api,imgproxy,realtime,edge-runtime,logflare,vector,supavisor,postgres-meta
```

| Se levanta | Por qué |
| :---- | :---- |
| Postgres | El esquema, las policies, los triggers y el constraint |
| Kong | El gateway: publica `/rest/v1` y `/auth/v1` |
| PostgREST | Los embeds y filtros que usa la capa de queries |
| GoTrue | Login con contraseña y emisión de JWT |
| Mailpit | Liviano; le evita a GoTrue apuntar a un SMTP inexistente |

| Se excluye | Por qué |
| :---- | :---- |
| Studio, postgres-meta | Interfaz de administración; ningún test la usa |
| Storage, imgproxy | No hay archivos en el producto todavía |
| Realtime | No hay suscripciones |
| Edge Runtime | No hay edge functions |
| Supavisor | Pooler; las conexiones directas alcanzan |
| logflare, vector | Analytics, y `config.toml` ya las tiene en `enabled = false` |

Excluirlos es la diferencia entre un arranque que el runner aguanta cómodo y uno que se lleva la mayor parte del tiempo y de la RAM.

### Migrations y seed

`supabase start` ya aplica las migrations, pero el workflow corre además:

```
supabase db reset --local
```

Eso reconstruye la base **desde cero** con las migrations versionadas más `supabase/seed.sql`. Sirve de doble propósito: garantiza datos frescos y verifica que las migrations levanten una base limpia sin depender de ningún estado previo.

> `db reset` acá es seguro porque `--local` apunta al stack efímero. **Nunca correrlo contra un proyecto alojado:** por eso no existe un script `db:reset` en `package.json`.

### Credenciales

Salen del stack recién levantado (`supabase status -o env`) y se exponen **solo como variables del job**. Las claves se tachan con `::add-mask::`, así que aunque un paso las imprima por accidente no quedan en el log.

**En el workflow no hay ninguna URL, clave ni secret del proyecto remoto, y no hacen falta.** Los tests no pueden apuntar a un proyecto alojado aunque alguien lo intente: `tests/env.ts` rechaza cualquier URL que no sea local.

---

## 4. Identificación de los datos de prueba

`tests/run-id.ts` define un identificador por corrida:

- En CI: `${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}`. El *attempt* importa — un re-run conserva el `RUN_ID`, y sin él dos intentos compartirían identificador.
- Fuera de CI: `local-<uuid corto>`.

Se aplica por convención sobre campos que **ya existen**, sin agregar columnas al esquema productivo:

| Dato | Forma | Dónde se aplica |
| :---- | :---- | :---- |
| Emails | `test-<runId>-<etiqueta>@example.com` | `createTestUser()`, `createUser()` |
| Nombres | `[test:<runId>] <etiqueta>` | `createClientRow()`, `createProjectRow()`, specs E2E |

En los helpers de integración la convención se aplica **sola**: `createTestUser("mi-pm")` genera el email completo. Los specs E2E la aplican en sus propias constantes, porque esos nombres se usan también como locators y tienen que coincidir exactamente con lo que la app muestra.

> Si armás un locator por regex con un nombre etiquetado, pasalo por `escapeForRegExp()`. `[test:123]` dentro de un `new RegExp()` es una **clase de caracteres**, no texto literal, y el locator terminaría matcheando cualquier cosa.

Dentro del stack efímero, la limpieza por test sirve para el aislamiento entre archivos que corren en paralelo. **La garantía final no es esa limpieza: es que el stack entero se descarta al terminar el job**, con un paso `if: always()` que corre aunque los tests fallen o el job se cancele.

---

## 5. Pruebas manuales contra el proyecto remoto

El proyecto remoto de desarrollo es para **probar a mano en el navegador**, nunca para tests automáticos.

Si al hacerlo dejás datos:

1. Identificalos con la misma convención (`[test:<runId>]`, `test-<runId>-…@example.com`).
2. Limpiá **solo esa corrida**:

```bash
node scripts/cleanup-test-data.mjs --run-id=local-a1b2c3d4 --dry-run   # ver qué borraría
node scripts/cleanup-test-data.mjs --run-id=local-a1b2c3d4             # borrar
```

El script:

- **Exige un identificador válido** y no hace nada sin él.
- Filtra por el **prefijo exacto** de esa corrida, no por "todo lo que diga test".
- Borra **de hijos a padres** (reservas → auditoría → proyectos → clientes → usuarios), porque las FK de `projects` son `on delete restrict`.
- No trunca ni borra por filtros abiertos.

Reglas que no se negocian: no usar la `service_role` key desde el navegador, y no confundir este proyecto de desarrollo con el futuro de producción.

---

## 6. Cómo correr cada cosa

### En tu máquina

```bash
pnpm test:unit     # 129 tests, ~4s, sin infraestructura
pnpm typecheck
pnpm lint
```

Integración, smoke y E2E **no corren local**: necesitan el stack efímero. Si lo intentás, `tests/env.ts` corta con un mensaje que explica por qué.

### En CI

| Evento | Qué corre |
| :---- | :---- |
| Pull request | Todo: `static` (tipos, lint, unitarios) + `database` (integración, smoke, E2E) |
| Push a `main` | Todo |
| Manual (`workflow_dispatch`) | Todo |

Para dispararlo a mano: pestaña **Actions** → workflow **Tests** → **Run workflow** → elegir la rama.

El workflow tiene dos jobs en paralelo. `static` no toca Supabase y termina en menos de un minuto, así que un error de tipos se sabe enseguida sin esperar al stack.

### Artifacts de Playwright

Cuando los E2E fallan, el workflow sube `playwright-report/` y `test-results/` como artifact `playwright-report-<run_id>-<attempt>`, con 7 días de retención.

Para leerlo: **Actions** → la corrida fallida → sección **Artifacts** → descargar y descomprimir → abrir `playwright-report/index.html`. Ahí están el error, el screenshot del momento de la falla y el snapshot del DOM. `test-results/` trae además el `error-context.md` de cada test caído, que suele alcanzar sin abrir el reporte.

---

## 7. Agregar tests sin pegarle al proyecto remoto

- **Un test de lógica pura o de mapeo** → `tests/unit/`. Usá `createSupabaseMock()`.
- **Algo que dependa de RLS, un trigger o un constraint** → `tests/integration/`. Usá los helpers de `tests/integration/helpers.ts`: ya aplican la convención de identificación y ya pasan por el guard.
- **Algo que dependa de la sintaxis de PostgREST** (un embed nuevo, un filtro sobre columna embebida) → `tests/smoke/`. Mantenela chica: prueba el contrato con el servidor, no la lógica.
- **Un flujo de usuario completo** → `tests/e2e/`.

**Nunca leas `.env.local` desde un test.** Ese archivo apunta al proyecto remoto. Los tests toman las credenciales del entorno del job vía `loadTestEnv()`, que rechaza cualquier URL no local. Si escribís un test nuevo y "no encuentra las variables" en tu máquina, no es un bug: es el diseño diciéndote que ese test va a CI.

---

## 8. Cuando cambia el esquema

1. Agregá la migration en `supabase/migrations/`, con RLS y grants explícitos (ver `CLAUDE.md`).
2. Si hace falta, ampliá `supabase/seed.sql`. **Tiene que ser idempotente** (`on conflict`), porque se corre sobre bases que ya pueden tener datos.
3. Abrí un PR: CI reconstruye la base desde cero y corre todo. Si la migration no aplica limpia, el job falla ahí.
4. Con el PR en verde, aplicá al proyecto remoto de desarrollo: `pnpm db:push`.
5. Regenerá los tipos: `pnpm db:types`, y comiteá `src/types/database.ts`.

El orden importa: **CI primero, proyecto remoto después.** Es la única forma de que una migration rota se descubra contra una base descartable.

---

## 9. Cómo queda separada producción

La app lee la configuración de Supabase **solo** desde variables de entorno, validadas en `src/lib/env.ts`:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY   # solo servidor
```

No hay ninguna URL ni clave escrita en el código. Cuando llegue el lanzamiento, mover producción a un proyecto propio es:

1. Crear el proyecto de producción.
2. `supabase link` contra él y `pnpm db:push`.
3. Cargar las tres variables en el hosting (Vercel), por entorno.
4. Configurar Google OAuth en ese proyecto y agregar su redirect URI.

**No hay que reescribir nada de la aplicación**, y los tests no se enteran: siguen apuntando al stack efímero, y `tests/env.ts` los sigue bloqueando si alguien intenta apuntarlos a producción.

El proyecto remoto actual queda como **desarrollo**, no como producción.

---

## 10. Limitaciones conocidas

- **Integración, smoke y E2E no se pueden reproducir localmente.** Es el costo directo de no tener Docker. Cuando algo falla en CI, el ciclo de depuración pasa por leer los artifacts y pushear. Si esto empieza a doler de verdad, la salida es un segundo proyecto de Supabase o Docker en otra máquina — las dos están descartadas hoy por restricciones reales, no por preferencia.
- **`tests/perf/` quedó fuera de CI.** Sus presupuestos se calibraron contra un Postgres local (69 ms) y un runner compartido no es un banco de medición. Corre con `pnpm test:perf` contra un stack efímero, a mano, y sus números hay que recalibrarlos antes de volver a confiar en ellos.
- **Los mocks no validan la sintaxis de PostgREST.** Por eso existe la suite smoke. Si agregás un embed nuevo y no lo cubrís ahí, no hay nada que te avise hasta runtime.
- **Consumo del runner.** El stack recortado usa aproximadamente 1.5–2 GB de RAM y unos 2 GB de disco, dentro de los 7 GB / 14 GB del runner estándar de GitHub. El arranque ronda los 1–2 minutos, más la descarga de imágenes la primera vez. El job `database` tiene un techo de 45 minutos; el `static`, de 10.
