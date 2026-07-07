# Glosario — DevsCalendar

Términos del dominio. Se mantienen en español porque son parte del lenguaje del cliente y no traducen limpiamente.

| Término | Definición | Notas |
| :---- | :---- | :---- |
| **Reserva** (booking) | Bloque de tiempo asignado a un desarrollador sobre un proyecto, en una franja horaria específica. La unidad atómica del sistema. | En código: `booking`. En UI: "reserva". |
| **Bloque** | Sinónimo de reserva, más orientado a la representación visual en el calendario. | Se usan como sinónimos. |
| **PM** (Project Manager) | Rol que crea y gestiona reservas para sus proyectos. | |
| **Desarrollador** / **Dev** | Rol que es asignado a reservas y las aprueba/rechaza. | |
| **Administrador** | Rol con ABM completo sobre usuarios, clientes, proyectos y prioridades. | |
| **Cliente** (entidad) | La empresa/organización dueña de uno o varios proyectos. No confundir con el rol "Cliente" (stakeholder externo con acceso de lectura, opcional). | En código: `client` (entidad) vs `client_user` (rol) — decidir en ADR. |
| **Proyecto** | Iniciativa perteneciente a un cliente. Tiene una prioridad (prioritario/común) y una integración configurada (Jira/Slack/ambas). | |
| **Prioritario** | Nivel de prioridad alto de un proyecto. Puede realocar recursos reservados por proyectos comunes. | En código: `priority = 'high'` (o `'priority'`), a definir. |
| **Común** | Nivel de prioridad estándar. Puede ser desplazado por reservas prioritarias. | En código: `priority = 'normal'` (o `'common'`), a definir. |
| **Aprobación** | Confirmación explícita del desarrollador de que acepta una reserva. Es requisito para que se refleje en Google Calendar. | Estados: `pending`, `approved`, `rejected`. |
| **Desplazada** | Estado de una reserva que fue pisada por una realocación de mayor prioridad. No se elimina — se marca y se notifica al PM anterior. | Estado terminal para esa reserva; se crea una nueva para el bloque. |
| **Realocación** | Acción de un PM prioritario que toma un bloque previamente reservado por un proyecto común. | Requiere aprobación del dev (recomendación por defecto — ver Sección 11 pregunta 1 de la spec). |
| **Doble-booking** | Situación en la que un desarrollador queda asignado a dos reservas aprobadas superpuestas en tiempo. Debe prevenirse a nivel DB. | |
| **Franja horaria** | Rango `[inicio, fin]` que define la ocupación de una reserva. Unidad de tiempo del sistema (no bloques fijos de N horas). | Ver Sección 11 pregunta 8 de la spec. |
| **Ticket** | Referencia externa a un ítem de trabajo en Jira o Slack (issue key o link a hilo). | |
| **Vista Día / Mes / Año** | Los tres modos de visualización del calendario (Sección 4.1 de la spec). | |
| **Agrupación por dev / por proyecto** | Los dos modos principales de organizar los carriles del calendario (Sección 4.3 de la spec). | |
