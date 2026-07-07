**Especificación Funcional**

**Plataforma de Planificación de Recursos**

*Calendario de asignación de desarrolladores por proyecto*

Documento de alcance para desarrollo y estimación

Versión 0.1 — Borrador · Julio 2026

# **Índice**

# **1\. Resumen ejecutivo**

La plataforma es una herramienta de planificación de recursos (resource scheduling) orientada a equipos de desarrollo de software. Su función central es permitir que los Project Managers (PM) reserven tiempo de desarrolladores sobre proyectos específicos, visualizando toda la asignación en un calendario gráfico similar a Google Calendar.

El sistema resuelve tres problemas concretos del cliente: (1) evitar que dos PMs reserven al mismo desarrollador en el mismo bloque de tiempo (doble-booking), (2) dar visibilidad de quién trabaja en qué proyecto y cuándo, filtrable por múltiples dimensiones, y (3) formalizar el compromiso del desarrollador mediante un flujo de aprobación con notificación a su Google Calendar.

Complementan la propuesta una jerarquía de prioridad entre proyectos —que permite realocar recursos de proyectos comunes hacia proyectos prioritarios— y la integración con Slack y Jira para asociar cada bloque de tiempo a un ticket concreto.

| Objetivo del documento Servir de base para la estimación de esfuerzo y la planificación del desarrollo. Dejar explícitos los supuestos y las decisiones de producto que aún deben confirmarse con el cliente (ver Sección 11). No es un documento de diseño técnico ni de UI final; describe el QUÉ, no el CÓMO de implementación. |
| :---- |

# **2\. Objetivos y alcance**

## **2.1 Objetivos**

* **Visualización:** un calendario gráfico que muestre la asignación de desarrolladores a proyectos por franjas horarias, con vistas de día, mes y año.

* **Reserva sin conflictos:** impedir que un desarrollador quede asignado a dos proyectos en el mismo bloque de tiempo.

* **Compromiso formal:** que el desarrollador apruebe cada asignación y la reciba en su Google Calendar.

* **Priorización:** permitir que proyectos prioritarios reasignen recursos según reglas definidas.

* **Trazabilidad:** vincular cada bloque de tiempo a un ticket de Jira o a un canal/hilo de Slack.

## **2.2 Dentro de alcance (MVP propuesto)**

* Calendario con vistas día / mes / año y navegación por click en el cuadrito de un día.

* Creación, edición y borrado de reservas (bloques) por parte de PMs.

* Filtros por cliente, proyecto, desarrollador y PM.

* Flujo de aprobación / rechazo del desarrollador.

* Detección y bloqueo de doble-booking.

* Dos niveles de prioridad de proyecto y regla de realocación.

* Integración push con Google Calendar.

* Integración con Jira y/o Slack para asociar tickets.

## **2.3 Fuera de alcance (fases posteriores)**

* Registro de horas efectivamente trabajadas (time tracking) y su comparación contra lo planificado.

* Facturación y reportes financieros por cliente/proyecto.

* Gestión de vacaciones, licencias y feriados (se sugiere para Fase 2; ver supuestos).

* Optimización automática de asignaciones (sugerencias de quién asignar).

* App móvil nativa (se asume web responsive en el MVP).

# **3\. Roles y permisos**

Se identifican los siguientes roles. Los permisos son una propuesta inicial y deben validarse con el cliente.

| Rol | Descripción | Permisos clave |
| :---- | :---- | :---- |
| Administrador | Gestiona la plataforma, usuarios, clientes y proyectos. | ABM de usuarios, clientes, proyectos y prioridades; ve todo. |
| PM (Project Manager) | Planifica y reserva recursos para sus proyectos. | Crea/edita reservas en sus proyectos; ve el calendario global; realoca según prioridad. |
| Desarrollador | Recurso que es asignado a bloques de trabajo. | Aprueba/rechaza asignaciones; ve su propio calendario; ve (opcional) el global en modo lectura. |
| Cliente (opcional) | Stakeholder externo con visibilidad limitada. | Ve el avance/planificación de sus propios proyectos en modo lectura. A confirmar si aplica. |

| Decisión abierta ¿El desarrollador puede ver el calendario global de todos, o solo su propia agenda? Recomendación: ver el global en modo lectura ayuda a la coordinación, pero puede exponer información sensible entre clientes. |
| :---- |

# **4\. Módulo Calendario (visualización)**

Es la pantalla principal. Debe sentirse tan fluida y clara como Google Calendar.

## **4.1 Vistas**

| Vista | Qué muestra | Interacción |
| :---- | :---- | :---- |
| Año | Cuadrícula de 12 meses; cada mes con sus días. | Click en un mes → abre vista Mes. |
| Mes | Cuadraditos por día. Cada día indica densidad de ocupación (ej. color/contador de asignaciones). | Click en un día → abre vista Día. |
| Día | Franjas horarias (timeline) estilo Google Calendar, con los bloques de asignación posicionados por horario. | Crear/editar/mover bloques; ver detalle. |

## **4.2 Representación de los bloques**

* **Color por proyecto o por desarrollador,** conmutable según el modo de agrupación elegido.

* Cada bloque muestra: desarrollador, proyecto, cliente, franja horaria y estado (pendiente / aprobado / rechazado).

* Los bloques prioritarios se distinguen visualmente (ej. borde o ícono).

* Solapamientos válidos (distintos devs) se muestran en paralelo, como en Google Calendar.

## **4.3 Modos de agrupación**

* **Por desarrollador:** cada columna/carril es un desarrollador; se ve la carga de cada persona.

* **Por proyecto:** cada carril es un proyecto; se ve quién trabaja en él ese día.

* **Ambos (combinado):** matriz o agrupación anidada. Confirmar viabilidad de UI; puede simplificarse en el MVP.

## **4.4 Filtros**

El calendario se puede filtrar (de forma combinable) por:

* Cliente

* Proyecto

* Desarrollador

* PM

* Estado (pendiente / aprobado / rechazado)

* Prioridad (prioritario / común)

# **5\. Módulo de Reservas (asignación de tiempo)**

## **5.1 Creación de una reserva**

Un PM crea una reserva (bloque) indicando:

* Desarrollador a asignar.

* Proyecto (y por herencia, cliente).

* Fecha y franja horaria (inicio–fin), o cantidad de horas.

* Ticket asociado de Jira o referencia de Slack (ver Sección 8).

* Nota/descripción opcional.

## **5.2 Estados de una reserva**

| Estado | Significado | Transiciones |
| :---- | :---- | :---- |
| Pendiente | Creada por el PM, esperando respuesta del dev. | → Aprobada / Rechazada / Cancelada |
| Aprobada | El dev confirmó. Se refleja en su Google Calendar. | → Cancelada / Desplazada |
| Rechazada | El dev no aceptó. El PM debe reasignar. | → (nueva reserva) |
| Cancelada | El PM la eliminó. | — (final) |
| Desplazada | Fue pisada por una realocación de mayor prioridad. | → notifica al PM anterior |

**Nota sobre el estado 'Desplazada':** es un estado propuesto para que una realocación por prioridad no borre silenciosamente la reserva anterior, sino que la marque y notifique. Ver Sección 7 y Sección 11\.

# **6\. Flujo de aprobación del desarrollador**

Es el mecanismo que convierte una intención del PM en un compromiso confirmado del desarrollador.

### **Secuencia**

1. El PM crea la reserva → queda en estado Pendiente.

2. El desarrollador recibe una notificación (in-app \+ Slack/email, a definir).

3. El desarrollador Aprueba o Rechaza.

4. Si aprueba: se crea/actualiza el evento en su Google Calendar y el bloque pasa a Aprobado.

5. Si rechaza: el PM es notificado y debe reasignar.

| Decisión abierta — aprobación y prioridad ¿La realocación por prioridad (Sección 7\) saltea también la aprobación del desarrollador, o solo la del PM anterior? Recomendación: el override de prioridad saltea la aprobación del PM anterior pero NO la del desarrollador. El dev siempre confirma que efectivamente puede/va a trabajar en ese bloque. |
| :---- |

# **7\. Jerarquía de prioridad y realocación**

El cliente pidió dos niveles: proyecto prioritario y proyecto común. La regla central es que un proyecto prioritario puede realocar a un desarrollador que estaba reservado por un proyecto de menor prioridad, sin requerir la aprobación previa del PM anterior.

## **7.1 Regla de realocación**

| Situación | ¿Permite realocar? | Consecuencia |
| :---- | :---- | :---- |
| Prioritario sobre Común | Sí, sin aprobación del PM anterior. | La reserva común pasa a 'Desplazada'; se notifica al PM anterior y al dev. |
| Común sobre Prioritario | No. | Se bloquea; el PM ve el conflicto. |
| Mismo nivel (conflicto) | No automático. | Requiere resolución manual / negociación entre PMs. |

## **7.2 Puntos a resolver**

* **Empate de prioridad:** con solo dos niveles, dos proyectos 'prioritarios' en conflicto no se resuelven solos. Se sugiere evaluar un esquema numérico (P0–P3) a futuro.

* **Aprobación del dev en realocación:** ver Sección 6\. Aunque se saltee al PM anterior, se recomienda mantener la del dev.

* **Notificaciones:** toda realocación debe notificar al PM desplazado y al desarrollador, para evitar sorpresas.

* **Auditoría:** registrar quién realocó, cuándo y sobre qué reserva, para trazabilidad.

# **8\. Integraciones**

## **8.1 Google Calendar**

* **Push (MVP):** al aprobarse una reserva, se crea un evento en el Google Calendar del desarrollador con proyecto, franja y link al ticket.

* **Actualización/borrado:** cambios o cancelaciones de la reserva se reflejan en el evento.

* **Sync bidireccional (a evaluar):** leer los eventos existentes del dev (reuniones, etc.) para considerarlos tiempo ocupado y prevenir doble-booking real. Mayor esfuerzo; se sugiere Fase 2\.

## **8.2 Jira**

* Asociar un ticket de Jira a la reserva (buscador de tickets por proyecto).

* Mostrar en el bloque el código y estado del ticket.

* **Opcional:** registrar en el ticket que hay tiempo planificado / cambiar su estado. A confirmar.

## **8.3 Slack**

* Enviar notificaciones de asignación, aprobación pendiente y realocación al desarrollador y al PM.

* Asociar un canal o hilo de Slack a la reserva como referencia de contexto.

* **Opcional:** aprobar/rechazar la reserva directamente desde un mensaje de Slack (botones interactivos).

| Decisión abierta — Jira o Slack El pedido dice que el proyecto se vincula a 'Slack o Jira'. ¿Son alternativas (uno u otro por proyecto) o ambos simultáneamente? Recomendación: soportar ambos, y que cada proyecto configure cuál usa como fuente de tickets. |
| :---- |

# **9\. Caso de uso principal**

**Título:** Reservar a un desarrollador para un proyecto en un bloque de tiempo.

| Campo | Detalle |
| :---- | :---- |
| Actor | PM |
| Precondición | El proyecto existe y tiene prioridad asignada; el desarrollador existe en el sistema. |
| Disparador | El PM necesita a Cristian el miércoles por X horas para el proyecto A. |

### **Flujo principal**

6. El PM abre el calendario y navega al día (miércoles).

7. Crea una reserva: Cristian, proyecto A, franja horaria, ticket de Jira asociado.

8. El sistema verifica que Cristian no tenga otra reserva aprobada en esa franja.

9. La reserva queda Pendiente y Cristian es notificado.

10. Cristian aprueba → se crea el evento en su Google Calendar y el bloque pasa a Aprobado.

### **Flujos alternativos**

* **A. Bloque ocupado por proyecto común y el nuevo es prioritario:** el sistema permite realocar; la reserva anterior pasa a Desplazada y su PM es notificado. Cristian debe aprobar la nueva.

* **B. Bloque ocupado y el nuevo NO es de mayor prioridad:** el sistema bloquea la reserva y muestra el conflicto; el PM elige otra franja u otro dev.

* **C. Cristian rechaza:** el PM es notificado y reasigna.

# **10\. Modelo de datos (conceptual)**

Entidades principales y sus relaciones. Es un modelo conceptual, no el esquema físico definitivo.

| Entidad | Atributos clave | Relaciones |
| :---- | :---- | :---- |
| Cliente | id, nombre | 1 — N Proyectos |
| Proyecto | id, nombre, prioridad (prioritario/común), integración (Jira/Slack) | N — 1 Cliente; N — 1 PM; 1 — N Reservas |
| Usuario | id, nombre, email, rol | PM o Desarrollador o Admin |
| Reserva (bloque) | id, fecha, inicio, fin, estado, prioridad heredada, ticket\_ref | N — 1 Proyecto; N — 1 Desarrollador; N — 1 PM creador |
| Ticket | id externo, sistema (Jira/Slack), estado | N — N Reservas (ref.) |
| Notificación | id, tipo, destinatario, estado | N — 1 Usuario |
| Auditoría | id, acción, actor, timestamp, reserva\_ref | registro de realocaciones y cambios |

# **11\. Supuestos y decisiones abiertas**

Los siguientes puntos afectan directamente la estimación y deben confirmarse antes de comenzar.

| \# | Pregunta / Supuesto | Recomendación por defecto |
| :---- | :---- | :---- |
| 1 | ¿El override de prioridad saltea también la aprobación del dev? | No: el dev siempre aprueba. |
| 2 | ¿Alcanzan 2 niveles de prioridad o conviene un esquema numérico? | MVP con 2; diseñar para escalar a P0–P3. |
| 3 | ¿Google Calendar es solo push o sync bidireccional? | Push en MVP; bidireccional en Fase 2\. |
| 4 | ¿Jira y Slack son alternativos o ambos por proyecto? | Ambos, configurable por proyecto. |
| 5 | ¿El desarrollador ve el calendario global o solo el suyo? | Global en modo lectura. |
| 6 | ¿El rol Cliente accede a la plataforma? | A confirmar; probablemente Fase 2\. |
| 7 | ¿Se gestionan vacaciones/licencias/feriados? | Fuera del MVP; Fase 2\. |
| 8 | ¿Unidad de reserva: franja horaria exacta o bloques de X horas? | Franja horaria (inicio–fin), como Google Calendar. |
| 9 | ¿Notificaciones por email, Slack, in-app o todas? | In-app \+ Slack; email opcional. |
| 10 | ¿Multi-timezone (equipos distribuidos)? | Confirmar; impacta el manejo de horarios. |

# **12\. Requisitos no funcionales**

* **Usabilidad:** la experiencia del calendario debe ser fluida y familiar (referencia: Google Calendar).

* **Rendimiento:** el calendario debe cargar rápido incluso con muchos devs y proyectos; considerar carga por rango de fechas.

* **Concurrencia:** prevención de doble-booking a nivel de datos (bloqueo/validación), no solo en UI, para evitar reservas simultáneas conflictivas.

* **Seguridad:** autenticación (idealmente SSO con Google), autorización por rol, y aislamiento de datos entre clientes.

* **Auditoría:** registro de realocaciones, aprobaciones y cambios de estado.

* **Responsive:** uso cómodo en navegador de escritorio; adaptación razonable a tablet/móvil.

# **13\. Fases sugeridas**

| Fase | Contenido | Objetivo |
| :---- | :---- | :---- |
| Fase 1 — MVP | Calendario (día/mes/año), reservas, filtros, aprobación del dev, anti doble-booking, 2 prioridades, push a Google Calendar, vínculo con Jira/Slack. | Cubrir el caso de uso principal end-to-end. |
| Fase 2 | Sync bidireccional de Google Calendar, vacaciones/licencias, aprobación desde Slack, esquema de prioridad ampliado, acceso de Cliente. | Robustez y adopción. |
| Fase 3 | Time tracking, reportes/facturación, sugerencias de asignación. | Analítica y valor de negocio. |

Este documento es un borrador (v0.1). Una vez confirmadas las decisiones abiertas de la Sección 11, se puede convertir en la especificación definitiva y avanzar con la estimación de esfuerzo.