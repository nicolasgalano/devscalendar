# ADR 0011 — Roles múltiples como array, y `active` adentro de la pregunta de pertenencia

- **Fecha:** 2026-09-08
- **Estado:** aceptada
- **Feature:** `012-multiple-roles-and-active-enforcement`
- **Salda:** D-09 y D-01 de `docs/deuda-tecnica.md`

---

## Contexto

`profiles.role` guardaba **un** valor de un enum de tres. En el equipo hay gente
que es PM y admin, y con una sola columna había que elegir:

- Con `admin` opera todo pero **ningún proyecto puede nombrarla responsable**,
  porque `projects.pm_id` exigía `role = 'pm'` exacto en tres lugares.
- Con `pm` puede ser responsable, pero pierde `/admin/*` entero.

Para _operar_ reservas la diferencia casi no se nota, porque `admin` ya era
superconjunto de `pm`. El daño real es de **pertenencia**, y su peor consecuencia
todavía no se ve: `010` va a notificar al `pm_id` del proyecto, y si el
responsable nominal no es quien lo lleva, el aviso de "te desplazaron una reserva
confirmada" le llega a la persona equivocada.

En paralelo, `profiles.active` era una decoración: el único lugar del camino de
autorización que lo miraba era `src/app/(app)/layout.tsx`, un layout de UI. Las
rutas de API no tienen layout y ninguna policy lo consultaba, así que desactivar
a alguien le escondía la aplicación sin sacarle un solo permiso.

## Decisión

**1. Los roles son un array en la propia fila: `profiles.roles user_role[]`.**

**2. `current_user_role()` desaparece y la pregunta pasa a ser de pertenencia:**
`has_role(user_role)` y `has_any_role()`.

**3. Las dos funciones incluyen `and active`.** El chequeo de "esta persona sigue
habilitada" vive adentro de la misma pregunta que responde "qué es esta persona".

## Por qué un array y no una tabla `profile_roles`

La forma normalizada sería una junction table, y es la que elegiría si los roles
fueran por proyecto o si el conjunto de permisos fuera abierto. Acá no: son tres
valores fijos y globales.

Lo que decide es dónde vive la respuesta. `getCurrentProfile()` ya lee la fila de
`profiles` una vez por request y está memorizada con el `cache()` de React. Con
un array, "¿es admin?" no cuesta nada nuevo: ni una consulta, ni un embed, ni un
join adentro de una función que corre por cada fila que evalúa una policy. Con
una tabla aparte, `has_role()` pasa a ser un join y cada pantalla que muestre
roles tiene que traérselos por separado.

**Es reversible, y conviene decirlo:** si algún día los roles se vuelven por
proyecto —o aparece la necesidad de permisos arbitrarios— la tabla es el camino,
y el array migra a ella sin tocar la superficie de la API, porque lo que la app
consume es `hasRole()`, no la columna.

El precio del array es que Postgres no puede exigir unicidad dentro de él: un
`check` no lleva subconsulta. Se resuelve con un trigger que normaliza al
escribir —ordenado y sin repetidos—, que además hace que dos conjuntos iguales se
guarden idénticos y que un test pueda compararlos sin depender del orden en que
la UI mandó los checkboxes.

## Por qué `active` va adentro de `has_role()` y no al lado

Es la parte que parece un atajo y no lo es.

Una policy tiene **un** tiro: la expresión se evalúa y la fila entra o no entra.
Si `active` fuera una condición separada, habría que acordarse de sumarla en las
siete policies, en las dos funciones `security definer` y en cada policy futura —
y olvidarse **no falla**: deja pasar. La regla que se olvida sola es exactamente
la que produjo D-01.

Metiéndola adentro, hay un único lugar donde está escrito que un usuario
desactivado no es nadie, y todo lo que pregunta por un rol lo hereda, incluido lo
que se escriba después.

### Las dos excepciones, que son deliberadas

**`profiles: self read` no pasa por estas funciones.** Es `auth.uid() = id` y se
queda así. Un usuario desactivado tiene que poder leer su propia fila, o
`/pending-access` no tiene nada que mostrarle y queda rebotando sin entender por
qué. La autorización que importa no es "puede verse a sí mismo", es "puede hacer
algo".

**`profiles: team directory read` no suma `active`.** Esa policy filtra la fila
que se lee, no a quien lee, y el calendario imprime el nombre del desarrollador
asignado en cada bloque, para cualquier viewer. Si desactivar a alguien lo sacara
del directorio, sus reservas viejas perderían el nombre — que es el bug exacto
que la migration `…0005` fue escrita para arreglar. **Desactivar a alguien le
saca permisos; no le borra la historia.**

## Consecuencias

- **La navegación pasa a ser unión y no cascada.** El `if / else if` de
  `app-shell.tsx` funcionaba porque nadie podía ser dos cosas; ahora quien es dev
  y admin perdería una de las dos secciones según el orden en que estuviera
  escrito el ternario.
- **`admin` sigue sin ser un atajo para aprobar.** ADR 0009 no cambia: el guard
  de columnas compara `auth.uid()` contra `dev_id` **sin mirar el rol**, porque
  aprobar es un compromiso sobre el tiempo de una persona y no una operación
  administrativa. Lo que sí mejora es cómo se lee la regla de `/inbox`: el
  criterio nunca fue "no ser admin", era "ser el desarrollador" — y ahora un
  admin que además es dev tiene su bandeja, con toda razón.
- **La migration es destructiva y no tuvo dos fases.** Borra `profiles.role`, que
  es lo que leía el código deployado, así que entre `pnpm db:push` y el deploy de
  Vercel hubo una ventana con el sitio roto. Fue aceptable **solo** porque la app
  todavía no tiene usuarios. La próxima vez que haya gente adentro, esto va en
  dos fases: agregar, convivir, y borrar en una migration posterior.
- **Un usuario sin roles ya no es `null`, es `{}`.** Es el estado de quien espera
  en `/pending-access`, y quedarse sin roles desde la UI está prohibido (400): dar
  de baja a alguien es `active = false`, que además deja el rastro.

## Alternativas descartadas

- **Aceptar `admin` donde se exigía `pm`** (cinco líneas, sin migration). Deja el
  modelo mintiendo —la persona _no_ es PM y la app finge que sí—, no arregla la
  columna Rol de `/admin/users`, y sobre todo no arregla lo que motiva la deuda:
  `010` seguiría notificando a un `pm_id` elegido por descarte.
- **Chequear `active` solo en los guards de API.** Más barato y deja el agujero:
  cualquier camino que hable directo con PostgREST —incluido un Client Component
  de esta misma app— se lo saltea. Es la lección de ADR 0010: la regla tiene que
  estar donde no se pueda esquivar.
- **Dejar `role` como columna generada (`roles[1]`) para no romper el deploy.**
  Compra la ventana a cambio de arrastrar una columna que miente —¿cuál es "el"
  rol de alguien con dos?— y no salva al código viejo que _escribe_ `role`.
