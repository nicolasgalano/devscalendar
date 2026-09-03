"use client";

import { useId, useState } from "react";
import { CircleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConflictNotice } from "@/components/calendar/booking-conflict";
import type { BookingConflict } from "@/lib/bookings/conflicts";
import { optionalField, toInstants, type BookingFormValues } from "@/lib/bookings/form";
import type { BookingFormOptions } from "@/lib/bookings/options";
import {
  canDisplace,
  describeDisplaceRefusal,
  type DisplaceRefusal,
} from "@/lib/bookings/priority";
import { isReschedule, type BookingSnapshot } from "@/lib/bookings/transitions";
import { describeBookingWarnings } from "@/lib/bookings/warnings";
import { formatLongDate, formatTimeRange } from "@/lib/calendar/format";
import { instantToIsoDate } from "@/lib/calendar/range";
import type { CalendarParams } from "@/lib/validation/calendar";

/** What the dialog is doing. Editing carries the row it is editing. */
export type BookingDialogSession =
  | { kind: "create"; initial: BookingFormValues }
  | {
      kind: "edit";
      bookingId: string;
      snapshot: BookingSnapshot;
      initial: BookingFormValues;
    };

/**
 * Alta y edición de una reserva.
 *
 * Un solo componente para los dos casos: los campos son los mismos, y la única
 * diferencia real —que el proyecto no se puede mover— se lee mejor como un campo
 * bloqueado que como un segundo formulario que hay que mantener en paralelo.
 */
export function BookingDialog({
  session,
  open,
  onOpenChange,
  onSaved,
  options,
  tz,
  params,
}: {
  session: BookingDialogSession;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  options: BookingFormOptions;
  tz: string;
  /** Current calendar state, to build the link to a conflicting booking. */
  params: CalendarParams;
}) {
  const fieldId = useId();
  const [form, setForm] = useState<BookingFormValues>(session.initial);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<BookingConflict | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // `006`: el motivo por el que la base se negó a desplazar, cuando se negó.
  // Mientras es `null`, la regla local decide si hay salida; una vez que el
  // servidor contestó, manda su respuesta.
  const [refusal, setRefusal] = useState<DisplaceRefusal | null>(null);
  const [confirmingDisplace, setConfirmingDisplace] = useState(false);

  const isEdit = session.kind === "edit";
  const instants = toInstants(form, tz);
  const warnings = describeBookingWarnings(form);

  // Q-E, dicho antes de guardar y no después: mover el horario o cambiar el
  // desarrollador de una reserva aprobada la devuelve a pendiente. Se calcula
  // con la misma función pura que aplica el PATCH, para que la advertencia y la
  // regla no puedan separarse.
  const willNeedReapproval =
    isEdit &&
    session.snapshot.status === "approved" &&
    instants !== null &&
    isReschedule(session.snapshot, {
      devId: form.devId,
      startsAt: instants.startsAt,
      endsAt: instants.endsAt,
    });

  const update = (patch: Partial<BookingFormValues>) =>
    setForm((current) => ({ ...current, ...patch }));

  // El texto del trigger se resuelve a mano: `SelectValue` sin hijos imprime el
  // valor crudo, y acá el valor es un uuid. Misma razón que en la barra de
  // filtros, donde el centinela terminaba en pantalla como `__all__`.
  const selectedProject = options.projects.find((project) => project.id === form.projectId);
  const selectedDev = options.devs.find((dev) => dev.id === form.devId);

  /**
   * `006` AC-1.1 — el conflicto tiene salida: el proyecto elegido es
   * prioritario y el que ocupa la franja no.
   *
   * **Solo en el alta.** La ruta de realocación crea; mover una reserva ya
   * existente encima de otra es el PATCH, que tiene su propia historia con Q-E
   * y no la abre esta feature.
   *
   * Es la misma función pura que usa la API, y la base la vuelve a aplicar
   * adentro de `reallocate_booking()`. Que la UI se adelante no la convierte en
   * la autoridad: si el mundo cambió entre esta pantalla y la escritura, gana
   * lo que conteste el servidor, y por eso `refusal` lo apaga.
   */
  const displaceableConflict =
    !isEdit &&
    conflict !== null &&
    refusal === null &&
    selectedProject !== undefined &&
    canDisplace(selectedProject.priority, conflict.projectPriority)
      ? conflict
      : null;

  const missingPrerequisite =
    options.projects.length === 0
      ? "No hay proyectos activos a tu nombre. Un administrador tiene que asignarte uno antes de que puedas reservar."
      : options.devs.length === 0
        ? "No hay desarrolladores activos. Un administrador tiene que dar de alta al menos uno."
        : null;

  /**
   * AC-1.1 — desplazar y reservar, ya confirmado por el PM.
   *
   * Ruta propia (`plan.md` §4) y **`confirmedDisplacing` con la reserva que el
   * PM efectivamente vio**: si en el momento de escribir la franja tiene otra
   * cosa, la operación se rechaza en vez de pisar algo que nadie miró.
   */
  async function handleDisplace() {
    if (!displaceableConflict || !instants || !form.projectId || !form.devId) return;

    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/bookings/reallocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: form.projectId,
          devId: form.devId,
          startsAt: instants.startsAt,
          endsAt: instants.endsAt,
          note: optionalField(form.note),
          ticketRef: optionalField(form.ticketRef),
          confirmedDisplacing: [displaceableConflict.id],
        }),
      });

      const body = await response.json();
      if (!response.ok) {
        setConfirmingDisplace(false);
        // El conflicto releído: el diálogo tiene que repintarse con lo que hay
        // ahora, no con lo que había cuando el PM abrió la confirmación.
        if (body.conflict) setConflict(body.conflict);
        // T4.3: `reason` y no el texto. Un empate y una prioridad insuficiente
        // se leen distinto —"hablalo" contra "no podés"— y el día que alguien
        // reescriba el copy esa diferencia no puede evaporarse con él.
        // `stale` no deja motivo: la franja cambió, así que la regla local
        // vuelve a evaluar y puede volver a ofrecer desplazar.
        setRefusal(body.reason === "tie" || body.reason === "insufficient" ? body.reason : null);
        setError(body.error ?? "No se pudo desplazar la reserva. Probá de nuevo.");
        return;
      }

      // Cerrarlo acá y no dejárselo a `onSaved()`: el padre solo baja el `open`
      // del diálogo de reserva, y esta confirmación tiene estado propio. Sin
      // esto queda un modal abierto sobre un calendario ya actualizado — y como
      // es modal, el resto de la página queda inerte. Lo encontró el E2E de
      // T4.4, que no pudo ver el bloque nuevo detrás del diálogo trabado.
      setConfirmingDisplace(false);
      onSaved();
    } catch {
      setConfirmingDisplace(false);
      setError("No se pudo conectar con el servidor. Probá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    setConflict(null);
    setRefusal(null);

    // Se valida acá y no deshabilitando el botón: DESIGN.md §7 pide explicar el
    // problema al usar el control, no dejarlo muerto sin decir por qué.
    if (!form.projectId || !form.devId) {
      setError("Elegí el proyecto y el desarrollador de la reserva.");
      return;
    }
    if (!instants) {
      setError("Revisá la fecha y el horario: la reserva tiene que terminar después de empezar.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(
        isEdit ? `/api/bookings/${session.bookingId}` : "/api/bookings",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // El proyecto solo viaja en el alta: el PATCH no lo acepta.
            ...(isEdit ? {} : { projectId: form.projectId }),
            devId: form.devId,
            startsAt: instants.startsAt,
            endsAt: instants.endsAt,
            note: optionalField(form.note),
            ticketRef: optionalField(form.ticketRef),
          }),
        },
      );

      const body = await response.json();
      if (!response.ok) {
        // AC-1.2: el 409 trae la reserva que bloquea, no solo el rechazo.
        if (response.status === 409 && body.conflict) setConflict(body.conflict);
        setError(body.error ?? "No se pudo guardar la reserva. Probá de nuevo.");
        return;
      }

      onSaved();
    } catch {
      setError("No se pudo conectar con el servidor. Probá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Editar reserva" : "Nueva reserva"}</DialogTitle>
            <DialogDescription>
              {missingPrerequisite ??
                (isEdit
                  ? "El proyecto no se cambia: para moverla a otro, cancelá esta reserva y creá una nueva."
                  : "La reserva queda pendiente hasta que el desarrollador la apruebe.")}
            </DialogDescription>
          </DialogHeader>

          {!missingPrerequisite && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${fieldId}-project`}>Proyecto</Label>
                <Select
                  value={form.projectId || null}
                  onValueChange={(value) => update({ projectId: (value as string) ?? "" })}
                  disabled={isEdit}
                >
                  <SelectTrigger id={`${fieldId}-project`} className="w-full">
                    <SelectValue>
                      {selectedProject ? (
                        <span className="truncate">
                          {selectedProject.name}
                          <span className="text-muted-foreground">
                            {" · "}
                            {selectedProject.clientName}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Elegí un proyecto</span>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start" alignItemWithTrigger={false}>
                    {options.projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {`${project.name} · ${project.clientName}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${fieldId}-dev`}>Desarrollador</Label>
                <Select
                  value={form.devId || null}
                  onValueChange={(value) => update({ devId: (value as string) ?? "" })}
                >
                  <SelectTrigger id={`${fieldId}-dev`} className="w-full">
                    <SelectValue>
                      {selectedDev ? (
                        <span className="truncate">{selectedDev.name}</span>
                      ) : (
                        <span className="text-muted-foreground">Elegí un desarrollador</span>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start" alignItemWithTrigger={false}>
                    {options.devs.map((dev) => (
                      <SelectItem key={dev.id} value={dev.id}>
                        {dev.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_auto_auto]">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${fieldId}-date`}>Fecha</Label>
                  <Input
                    id={`${fieldId}-date`}
                    type="date"
                    className="font-data"
                    value={form.date}
                    onChange={(event) => update({ date: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${fieldId}-start`}>Desde</Label>
                  <Input
                    id={`${fieldId}-start`}
                    type="time"
                    // La grilla trabaja en franjas de 30 minutos (DESIGN.md §5):
                    // el selector nativo ofrece los mismos saltos.
                    step={1800}
                    className="font-data"
                    value={form.startTime}
                    onChange={(event) => update({ startTime: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${fieldId}-end`}>Hasta</Label>
                  <Input
                    id={`${fieldId}-end`}
                    type="time"
                    step={1800}
                    className="font-data"
                    value={form.endTime}
                    onChange={(event) => update({ endTime: event.target.value })}
                  />
                </div>
              </div>

              {/* AC-1.4: advertencias, nunca bloqueo. El botón de guardar sigue
                activo con cualquiera de ellas en pantalla. */}
              {(warnings.length > 0 || willNeedReapproval) && (
                <ul className="text-caption text-attention flex flex-col gap-1">
                  {warnings.map((warning) => (
                    <li
                      key={warning.id}
                      data-warning={warning.id}
                      className="flex items-start gap-1.5"
                    >
                      <CircleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                      {warning.message}
                    </li>
                  ))}
                  {willNeedReapproval && (
                    <li data-warning="reapproval" className="flex items-start gap-1.5">
                      <CircleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                      La reserva vuelve a quedar pendiente: el desarrollador tiene que aprobarla de
                      nuevo.
                    </li>
                  )}
                </ul>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${fieldId}-ticket`}>Ticket</Label>
                <Input
                  id={`${fieldId}-ticket`}
                  value={form.ticketRef}
                  placeholder="DEV-1234"
                  onChange={(event) => update({ ticketRef: event.target.value })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${fieldId}-note`}>Nota</Label>
                <Textarea
                  id={`${fieldId}-note`}
                  value={form.note}
                  placeholder="Migración del checkout, sin dependencias externas"
                  maxLength={500}
                  onChange={(event) => update({ note: event.target.value })}
                />
              </div>

              {conflict ? (
                <ConflictNotice
                  conflict={conflict}
                  params={params}
                  tz={tz}
                  tone={displaceableConflict ? "displaceable" : "blocking"}
                  title={
                    displaceableConflict
                      ? `${conflict.devName} ya tiene esa franja tomada, pero tu proyecto es prioritario`
                      : refusal
                        ? describeDisplaceRefusal(refusal, {
                            projectName: conflict.projectName,
                            pmName: conflict.pmName,
                          })
                        : undefined
                  }
                  action={
                    displaceableConflict && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-1 w-fit"
                        onClick={() => setConfirmingDisplace(true)}
                      >
                        Desplazar y reservar
                      </Button>
                    )
                  }
                />
              ) : (
                error && (
                  <p role="alert" className="text-ui text-danger">
                    {error}
                  </p>
                )
              )}
            </div>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Volver</DialogClose>
            {!missingPrerequisite && (
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear reserva"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {displaceableConflict && selectedProject && (
        <DisplaceConfirmDialog
          open={confirmingDisplace}
          onOpenChange={setConfirmingDisplace}
          conflict={displaceableConflict}
          projectName={selectedProject.name}
          submitting={submitting}
          onConfirm={handleDisplace}
          tz={tz}
        />
      )}
    </>
  );
}

/**
 * `006` T4.2 — la confirmación de un desplazamiento.
 *
 * Pasa por confirmación por lo mismo que cancelar: **es irreversible y le pasa
 * por encima a alguien que no está en la pantalla.** El texto nombra las tres
 * cosas que el PM necesita para decidir —qué reserva se pisa, de qué proyecto y
 * de qué PM— y la cuarta que nadie diría solo: que la reserva desplazada **no
 * se restaura** si esta después se cae (AC-3.2, Q-G de la spec). Sin esa
 * frase, un PM podría razonar que desplazar es reversible y no lo es.
 *
 * Y lo que este diálogo **no** promete: que al otro PM le llegue un aviso. Las
 * notificaciones son de `010`; hasta entonces se entera mirando el calendario,
 * y decirlo acá es preferible a dejarlo suponer.
 */
function DisplaceConfirmDialog({
  open,
  onOpenChange,
  conflict,
  projectName,
  submitting,
  onConfirm,
  tz,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflict: BookingConflict;
  projectName: string;
  submitting: boolean;
  onConfirm: () => void;
  tz: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Desplazar la reserva de otro proyecto</DialogTitle>
          <DialogDescription>
            {conflict.devName} tiene {formatTimeRange(conflict.startsAt, conflict.endsAt, tz)} del{" "}
            {formatLongDate(instantToIsoDate(conflict.startsAt, tz), tz)} reservado para{" "}
            {conflict.projectName}
            {conflict.pmName ? `, a cargo de ${conflict.pmName}` : ""}. Esa reserva queda desplazada
            y {projectName} toma la franja, pendiente de que {conflict.devName} la apruebe.
          </DialogDescription>
        </DialogHeader>

        <div className="text-ui text-muted-foreground flex flex-col gap-2">
          <p>
            La reserva desplazada <strong>no se restaura sola</strong> si esta se rechaza o se
            cancela después: quien la tenía va a tener que reasignar a mano.
          </p>
          <p>
            Todavía no hay avisos automáticos, así que conviene que se lo cuentes vos
            {conflict.pmName ? ` a ${conflict.pmName}` : ""}.
          </p>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Volver</DialogClose>
          <Button onClick={onConfirm} disabled={submitting}>
            {submitting ? "Desplazando…" : "Desplazar y reservar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
