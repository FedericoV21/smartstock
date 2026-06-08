'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CalendarDays,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { parsearMontoInputUsuario } from '@/lib/ui/monto-argentino';
import { formatCurrency, hoyEnAR } from '@/lib/utils/formatters';

type Disponibilidad = {
  id?: string;
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
};

type ExtraHorario = {
  id?: string;
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
  extra_monto: number | string;
  descripcion?: string | null;
  activa?: boolean | null;
};

type ClienteOption = {
  id: string;
  nombre: string | null;
  razon_social: string | null;
  telefono: string | null;
  email: string | null;
};

type ReservaFija = {
  id: string;
  agenda_id: string;
  cliente_id: string | null;
  nombre: string;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
  activa?: boolean | null;
  cliente?: ClienteOption | null;
};

type Agenda = {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: number | string;
  duracion_minutos: number;
  activa: boolean;
  agenda_principal_id: string | null;
  disponibilidad?: Disponibilidad[];
  extras_horarios?: ExtraHorario[];
  reservas_fijas?: ReservaFija[];
};

type Slot = {
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  estado: 'disponible' | 'reservado' | 'bloqueado';
  reserva_id: string | null;
  reserva_fija_id: string | null;
  bloqueo_id: string | null;
  precio_extra: number | string;
  precio_total: number | string;
};

type Reserva = {
  id: string;
  agenda_id: string;
  cliente_id: string | null;
  nombre: string;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  precio_snapshot: number | string;
  sena_monto: number | string | null;
  estado: 'reservado' | 'cobrando' | 'cobrado' | 'cancelado';
  comprobante_id: string | null;
};

type PosTurnoPayload = {
  turnoReservaId: string;
  turnoLabel: string;
  clienteId?: string | null;
  senaMonto?: number;
  items: unknown[];
};

type Bloqueo = {
  id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  motivo: string | null;
};

type AgendaDia = {
  slots: Slot[];
  reservas: Reserva[];
  reservas_fijas: ReservaFija[];
  bloqueos: Bloqueo[];
  error: string | null;
};

type AgendaForm = {
  id: string | null;
  nombre: string;
  descripcion: string;
  precio: string;
  activa: boolean;
  disponibilidad: Disponibilidad[];
  extras_horarios: ExtraHorario[];
  agenda_principal_id: string | null;
};

type ReservaForm = {
  nombre: string;
  telefono: string;
  email: string;
  notas: string;
  sena_monto: string;
};

type ReservaFijaForm = {
  cliente_id: string;
  nombre: string;
  telefono: string;
  email: string;
  notas: string;
};

type ReservaTarget = {
  agenda: Agenda;
  slot: Slot;
};

const DIAS = [
  { id: 1, label: 'Lun' },
  { id: 2, label: 'Mar' },
  { id: 3, label: 'Mie' },
  { id: 4, label: 'Jue' },
  { id: 5, label: 'Vie' },
  { id: 6, label: 'Sab' },
  { id: 7, label: 'Dom' },
];

const CALENDAR_DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];

const fechaLargaFormatter = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const mesFormatter = new Intl.DateTimeFormat('es-AR', {
  month: 'long',
  year: 'numeric',
});

const EMPTY_AGENDA_FORM: AgendaForm = {
  id: null,
  nombre: '',
  descripcion: '',
  precio: '0',
  activa: true,
  disponibilidad: [1, 2, 3, 4, 5].map((dia_semana) => ({
    dia_semana,
    hora_inicio: '09:00',
    hora_fin: '18:00',
  })),
  extras_horarios: [],
  agenda_principal_id: null,
};

const EMPTY_RESERVA_FORM: ReservaForm = {
  nombre: '',
  telefono: '',
  email: '',
  notas: '',
  sena_monto: '',
};

const EMPTY_RESERVA_FIJA_FORM: ReservaFijaForm = {
  cliente_id: '',
  nombre: '',
  telefono: '',
  email: '',
  notas: '',
};

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'No se pudo completar la operacion.');
  return json;
}

function hora(value: string | null | undefined) {
  return String(value ?? '').slice(0, 5);
}

function precio(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return formatCurrency(Number.isFinite(n) ? n : 0);
}

function monto(value: number | string | null | undefined) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
  }
  const n = parsearMontoInputUsuario(String(value ?? ''));
  return n !== null && n > 0 ? n : 0;
}

function diaLabel(dia: number) {
  return DIAS.find((d) => d.id === dia)?.label ?? '';
}

function diaSemanaIsoLocal(value: string) {
  const day = dateFromYmd(value).getDay();
  return day === 0 ? 7 : day;
}

function clienteLabel(cliente: ClienteOption) {
  return cliente.razon_social || cliente.nombre || 'Cliente';
}

function slotPrecio(slot: Slot, agenda: Agenda) {
  const total = monto(slot.precio_total);
  return total > 0 ? total : monto(agenda.precio);
}

function agendaToForm(agenda: Agenda): AgendaForm {
  const rows = (agenda.disponibilidad ?? []).map((r) => ({
    dia_semana: Number(r.dia_semana),
    hora_inicio: hora(r.hora_inicio) || '09:00',
    hora_fin: hora(r.hora_fin) || '18:00',
  }));
  rows.sort((a, b) => a.dia_semana - b.dia_semana || a.hora_inicio.localeCompare(b.hora_inicio));
  return {
    id: agenda.id,
    nombre: agenda.nombre,
    descripcion: agenda.descripcion ?? '',
    precio: String(Number(agenda.precio ?? 0)),
    activa: agenda.activa,
    disponibilidad: rows,
    extras_horarios: (agenda.extras_horarios ?? [])
      .filter((extra) => extra.activa !== false)
      .map((extra) => ({
        dia_semana: Number(extra.dia_semana),
        hora_inicio: hora(extra.hora_inicio) || '21:00',
        hora_fin: hora(extra.hora_fin) || '23:00',
        extra_monto: String(Number(extra.extra_monto ?? 0)),
        descripcion: extra.descripcion ?? '',
        activa: extra.activa !== false,
      }))
      .sort((a, b) => a.dia_semana - b.dia_semana || a.hora_inicio.localeCompare(b.hora_inicio)),
    agenda_principal_id: agenda.agenda_principal_id ?? null,
  };
}

function slotLabel(slot: Slot) {
  const cruzaDia = hora(slot.hora_fin) <= hora(slot.hora_inicio);
  return `${hora(slot.hora_inicio)} - ${hora(slot.hora_fin)}${cruzaDia ? ' (+1)' : ''}`;
}

function dateFromYmd(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return new Date();
  }
  return date;
}

function ymdFromDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidYmd(value: string) {
  return ymdFromDate(dateFromYmd(value)) === value;
}

function addMonths(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function capitalizar(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function fechaLarga(value: string) {
  return capitalizar(fechaLargaFormatter.format(dateFromYmd(value)));
}

function mesLabel(date: Date) {
  return capitalizar(mesFormatter.format(date));
}

function buildCalendarCells(monthDate: Date) {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date,
      ymd: ymdFromDate(date),
      currentMonth: date.getMonth() === monthDate.getMonth(),
    };
  });
}

function AgendaCalendar({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selectedDate = dateFromYmd(value);
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));

  const cells = useMemo(() => buildCalendarCells(visibleMonth), [visibleMonth]);
  const today = hoyEnAR();
  const selectDate = useCallback(
    (nextValue: string) => {
      if (!isValidYmd(nextValue)) return;
      const nextDate = dateFromYmd(nextValue);
      setVisibleMonth(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
      onChange(nextValue);
    },
    [onChange],
  );

  return (
    <section className="rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
          aria-label="Mes anterior"
          title="Mes anterior"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div className="min-w-0 text-center">
          <p className="text-sm font-medium">{mesLabel(visibleMonth)}</p>
          <p className="text-xs text-muted-foreground">Calendario AR</p>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
          aria-label="Mes siguiente"
          title="Mes siguiente"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[0.68rem] font-medium uppercase text-muted-foreground">
        {CALENDAR_DIAS.map((dia) => (
          <span key={dia}>{dia}</span>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((cell) => {
          const selected = cell.ymd === value;
          const isToday = cell.ymd === today;
          return (
            <button
              key={cell.ymd}
              type="button"
              onClick={() => selectDate(cell.ymd)}
              className={cn(
                'flex aspect-square min-h-8 items-center justify-center rounded-md border text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-transparent hover:border-border hover:bg-muted',
                !selected && isToday && 'border-primary/40 text-primary',
                !cell.currentMonth && !selected && 'text-muted-foreground/45',
              )}
              aria-current={selected ? 'date' : undefined}
            >
              {cell.date.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-3 grid gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Fecha
          <Input type="date" value={value} onChange={(e) => selectDate(e.target.value)} />
        </label>
        <Button type="button" variant="outline" onClick={() => selectDate(today)}>
          <CalendarDays className="size-4" />
          Hoy
        </Button>
      </div>
    </section>
  );
}

export function TurnosClient() {
  const router = useRouter();
  const { isAdmin, isSuperAdmin } = useDashboardRole();
  const canManageAgendas = isAdmin || isSuperAdmin;
  const [agendas, setAgendas] = useState<Agenda[]>([]);
  const [selectedAgendaId, setSelectedAgendaId] = useState('');
  const [fecha, setFecha] = useState(hoyEnAR());
  const [agendaDia, setAgendaDia] = useState<Record<string, AgendaDia>>({});
  const [loadingAgendas, setLoadingAgendas] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [agendaOpen, setAgendaOpen] = useState(false);
  const [agendaForm, setAgendaForm] = useState<AgendaForm>(EMPTY_AGENDA_FORM);
  const [savingAgenda, setSavingAgenda] = useState(false);

  const [reserveSlot, setReserveSlot] = useState<ReservaTarget | null>(null);
  const [reservaForm, setReservaForm] = useState<ReservaForm>(EMPTY_RESERVA_FORM);
  const [savingReserva, setSavingReserva] = useState(false);

  const [fixedSlot, setFixedSlot] = useState<ReservaTarget | null>(null);
  const [fixedForm, setFixedForm] = useState<ReservaFijaForm>(EMPTY_RESERVA_FIJA_FORM);
  const [savingFixed, setSavingFixed] = useState(false);
  const [clientes, setClientes] = useState<ClienteOption[]>([]);
  const [loadingClientes, setLoadingClientes] = useState(false);

  const [senaReserva, setSenaReserva] = useState<Reserva | null>(null);
  const [senaMontoInput, setSenaMontoInput] = useState('');
  const [savingSena, setSavingSena] = useState(false);

  const [payReserva, setPayReserva] = useState<Reserva | null>(null);
  const [charging, setCharging] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const selectedAgenda = useMemo(
    () => agendas.find((a) => a.id === selectedAgendaId) ?? null,
    [agendas, selectedAgendaId],
  );
  const reservasDelDia = useMemo(
    () =>
      Object.values(agendaDia)
        .flatMap((dia) => dia.reservas)
        .filter((reserva) => reserva.fecha === fecha),
    [agendaDia, fecha],
  );
  const reservasFijasDelDia = useMemo(() => {
    const dia = diaSemanaIsoLocal(fecha);
    return Object.values(agendaDia)
      .flatMap((data) => data.reservas_fijas)
      .filter((reserva) => reserva.activa !== false && Number(reserva.dia_semana) === dia);
  }, [agendaDia, fecha]);
  const totalSlots = useMemo(
    () => Object.values(agendaDia).reduce((acc, dia) => acc + dia.slots.length, 0),
    [agendaDia],
  );

  const loadAgendas = useCallback(async () => {
    setLoadingAgendas(true);
    try {
      const json = await fetchJson('/api/turnos/agendas');
      const rows = (json.agendas ?? []) as Agenda[];
      setAgendas(rows);
      setSelectedAgendaId((current) => {
        if (current && rows.some((a) => a.id === current)) return current;
        return rows.find((a) => a.activa)?.id ?? rows[0]?.id ?? '';
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las agendas.');
    } finally {
      setLoadingAgendas(false);
    }
  }, []);

  const loadSlots = useCallback(async () => {
    if (agendas.length === 0) {
      setAgendaDia({});
      return;
    }
    setLoadingSlots(true);
    const entries = await Promise.all(
      agendas.map(async (agenda) => {
        try {
          const qs = new URLSearchParams({ agenda_id: agenda.id, desde: fecha, hasta: fecha });
          const json = await fetchJson(`/api/turnos/slots?${qs.toString()}`);
          return [
            agenda.id,
            {
              slots: (json.slots ?? []) as Slot[],
              reservas: (json.reservas ?? []) as Reserva[],
              reservas_fijas: (json.reservas_fijas ?? []) as ReservaFija[],
              bloqueos: (json.bloqueos ?? []) as Bloqueo[],
              error: null,
            },
          ] as const;
        } catch (err) {
          return [
            agenda.id,
            {
              slots: [],
              reservas: [],
              reservas_fijas: [],
              bloqueos: [],
              error: err instanceof Error ? err.message : 'No se pudieron cargar los turnos.',
            },
          ] as const;
        }
      }),
    );
    setAgendaDia(Object.fromEntries(entries));
    setError(entries.some(([, data]) => data.error) ? 'Algunas agendas no se pudieron cargar.' : null);
    setLoadingSlots(false);
  }, [agendas, fecha]);

  const loadClientes = useCallback(async () => {
    setLoadingClientes(true);
    try {
      const json = await fetchJson('/api/clientes');
      setClientes((json.clientes ?? []) as ClienteOption[]);
    } catch {
      setClientes([]);
    } finally {
      setLoadingClientes(false);
    }
  }, []);

  useEffect(() => {
    void loadAgendas();
  }, [loadAgendas]);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  function openNewAgenda() {
    setAgendaForm(EMPTY_AGENDA_FORM);
    setAgendaOpen(true);
  }

  function openEditAgenda(agenda = selectedAgenda) {
    if (!agenda) return;
    setSelectedAgendaId(agenda.id);
    setAgendaForm(agendaToForm(agenda));
    setAgendaOpen(true);
  }

  function addRango(dia: number) {
    setAgendaForm((f) => ({
      ...f,
      disponibilidad: [...f.disponibilidad, { dia_semana: dia, hora_inicio: '09:00', hora_fin: '18:00' }],
    }));
  }

  function removeRango(index: number) {
    setAgendaForm((f) => ({
      ...f,
      disponibilidad: f.disponibilidad.filter((_, i) => i !== index),
    }));
  }

  function updateRango(index: number, patch: Partial<Disponibilidad>) {
    setAgendaForm((f) => ({
      ...f,
      disponibilidad: f.disponibilidad.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }));
  }

  function addExtraHorario(dia: number) {
    setAgendaForm((f) => ({
      ...f,
      extras_horarios: [
        ...f.extras_horarios,
        { dia_semana: dia, hora_inicio: '21:00', hora_fin: '23:00', extra_monto: '0', descripcion: '', activa: true },
      ],
    }));
  }

  function removeExtraHorario(index: number) {
    setAgendaForm((f) => ({
      ...f,
      extras_horarios: f.extras_horarios.filter((_, i) => i !== index),
    }));
  }

  function updateExtraHorario(index: number, patch: Partial<ExtraHorario>) {
    setAgendaForm((f) => ({
      ...f,
      extras_horarios: f.extras_horarios.map((extra, i) => (i === index ? { ...extra, ...patch } : extra)),
    }));
  }

  async function saveAgenda() {
    if (!agendaForm.nombre.trim()) {
      toast.error('El nombre es obligatorio.');
      return;
    }
    if (agendaForm.disponibilidad.length === 0) {
      toast.error('Agrega al menos un rango horario.');
      return;
    }
    for (const r of agendaForm.disponibilidad) {
      if (!r.hora_inicio || !r.hora_fin || r.hora_fin === r.hora_inicio) {
        toast.error('Cada rango debe tener hora inicio y fin distintas.');
        return;
      }
    }
    for (const extra of agendaForm.extras_horarios) {
      if (!extra.hora_inicio || !extra.hora_fin || extra.hora_fin === extra.hora_inicio || monto(extra.extra_monto) <= 0) {
        toast.error('Cada extra debe tener rango horario y monto mayor a cero.');
        return;
      }
    }
    setSavingAgenda(true);
    try {
      const body = {
        nombre: agendaForm.nombre,
        descripcion: agendaForm.descripcion,
        precio: agendaForm.precio,
        activa: agendaForm.activa,
        disponibilidad: agendaForm.disponibilidad,
        extras_horarios: agendaForm.extras_horarios,
        agenda_principal_id: agendaForm.agenda_principal_id,
      };
      const url = agendaForm.id ? `/api/turnos/agendas/${agendaForm.id}` : '/api/turnos/agendas';
      const json = await fetchJson(url, {
        method: agendaForm.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setAgendaOpen(false);
      await loadAgendas();
      if (json.agenda?.id) setSelectedAgendaId(json.agenda.id);
      toast.success('Agenda guardada.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar la agenda.');
    } finally {
      setSavingAgenda(false);
    }
  }

  function openReserva(agenda: Agenda, slot: Slot) {
    setSelectedAgendaId(agenda.id);
    setReserveSlot({ agenda, slot });
    setReservaForm(EMPTY_RESERVA_FORM);
  }

  function openReservaFija(agenda: Agenda, slot: Slot) {
    setSelectedAgendaId(agenda.id);
    setFixedSlot({ agenda, slot });
    setFixedForm(EMPTY_RESERVA_FIJA_FORM);
    void loadClientes();
  }

  async function saveReserva() {
    if (!reserveSlot) return;
    if (!reservaForm.nombre.trim()) {
      toast.error('El nombre es obligatorio.');
      return;
    }
    const senaMonto = monto(reservaForm.sena_monto);
    const precioReserva = slotPrecio(reserveSlot.slot, reserveSlot.agenda);
    if (senaMonto > precioReserva) {
      toast.error('La seña no puede superar el precio de la reserva.');
      return;
    }
    setSavingReserva(true);
    try {
      await fetchJson('/api/turnos/reservas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agenda_id: reserveSlot.agenda.id,
          fecha: reserveSlot.slot.fecha,
          hora_inicio: reserveSlot.slot.hora_inicio,
          nombre: reservaForm.nombre,
          telefono: reservaForm.telefono,
          email: reservaForm.email,
          notas: reservaForm.notas,
          sena_monto: senaMonto,
        }),
      });
      setReserveSlot(null);
      await loadSlots();
      toast.success('Reserva creada.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo reservar.');
    } finally {
      setSavingReserva(false);
    }
  }

  function selectClienteReservaFija(clienteId: string) {
    const cliente = clientes.find((c) => c.id === clienteId);
    setFixedForm((form) => ({
      ...form,
      cliente_id: clienteId,
      nombre: cliente ? clienteLabel(cliente) : form.nombre,
      telefono: cliente?.telefono ?? form.telefono,
      email: cliente?.email ?? form.email,
    }));
  }

  async function saveReservaFija() {
    if (!fixedSlot) return;
    if (!fixedForm.cliente_id && !fixedForm.nombre.trim()) {
      toast.error('El nombre o cliente es obligatorio.');
      return;
    }
    setSavingFixed(true);
    try {
      await fetchJson('/api/turnos/reservas-fijas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agenda_id: fixedSlot.agenda.id,
          dia_semana: diaSemanaIsoLocal(fixedSlot.slot.fecha),
          hora_inicio: fixedSlot.slot.hora_inicio,
          hora_fin: fixedSlot.slot.hora_fin,
          cliente_id: fixedForm.cliente_id || null,
          nombre: fixedForm.nombre,
          telefono: fixedForm.telefono,
          email: fixedForm.email,
          notas: fixedForm.notas,
        }),
      });
      setFixedSlot(null);
      await loadSlots();
      await loadAgendas();
      toast.success('Reserva fija creada.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo crear la reserva fija.');
    } finally {
      setSavingFixed(false);
    }
  }

  async function deleteReservaFija(reservaFijaId: string) {
    setBusyId(reservaFijaId);
    try {
      await fetchJson(`/api/turnos/reservas-fijas/${reservaFijaId}`, { method: 'DELETE' });
      await loadSlots();
      await loadAgendas();
      toast.success('Reserva fija quitada.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo quitar la reserva fija.');
    } finally {
      setBusyId(null);
    }
  }

  function openSenaReserva(reserva: Reserva) {
    setSenaReserva(reserva);
    const actual = monto(reserva.sena_monto);
    setSenaMontoInput(actual > 0 ? String(actual) : '');
  }

  async function saveSenaReserva() {
    if (!senaReserva) return;
    const senaMonto = monto(senaMontoInput);
    const precioReserva = monto(senaReserva.precio_snapshot);
    if (senaMonto > precioReserva) {
      toast.error('La seña no puede superar el precio de la reserva.');
      return;
    }
    setSavingSena(true);
    try {
      await fetchJson(`/api/turnos/reservas/${senaReserva.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sena_monto: senaMonto }),
      });
      setSenaReserva(null);
      await loadSlots();
      toast.success(senaMonto > 0 ? 'Seña registrada.' : 'Seña quitada.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar la seña.');
    } finally {
      setSavingSena(false);
    }
  }

  async function blockSlot(agenda: Agenda, slot: Slot) {
    const busyKey = `${agenda.id}-${slot.fecha}-${slot.hora_inicio}`;
    setBusyId(busyKey);
    try {
      await fetchJson('/api/turnos/bloqueos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agenda_id: agenda.id,
          fecha: slot.fecha,
          hora_inicio: slot.hora_inicio,
          hora_fin: slot.hora_fin,
          motivo: 'Bloqueo manual',
        }),
      });
      await loadSlots();
      toast.success('Horario bloqueado.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo bloquear.');
    } finally {
      setBusyId(null);
    }
  }

  async function unblock(bloqueoId: string) {
    setBusyId(bloqueoId);
    try {
      await fetchJson(`/api/turnos/bloqueos/${bloqueoId}`, { method: 'DELETE' });
      await loadSlots();
      toast.success('Bloqueo eliminado.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo eliminar el bloqueo.');
    } finally {
      setBusyId(null);
    }
  }

  async function cancelReserva(reservaId: string) {
    setBusyId(reservaId);
    try {
      await fetchJson(`/api/turnos/reservas/${reservaId}/cancelar`, { method: 'POST' });
      await loadSlots();
      toast.success('Reserva cancelada.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo cancelar.');
    } finally {
      setBusyId(null);
    }
  }

  async function cobrarReserva() {
    if (!payReserva) return;
    setCharging(true);
    try {
      const json = await fetchJson(`/api/turnos/reservas/${payReserva.id}/cobrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destino: 'pos' }),
      });
      const payload = json.pos_payload as PosTurnoPayload | undefined;
      if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
        throw new Error('No se pudo preparar el turno para el POS.');
      }
      sessionStorage.setItem('smartstock_pos_from_turno', JSON.stringify(payload));
      setPayReserva(null);
      toast.success('Turno cargado en el POS.');
      router.push('/facturacion/pos');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo abrir el POS.');
    } finally {
      setCharging(false);
    }
  }

  const agendaNombreById = useMemo(() => new Map(agendas.map((agenda) => [agenda.id, agenda.nombre])), [agendas]);
  const empty = !loadingAgendas && agendas.length === 0;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <CalendarClock className="size-6" />
            Turnos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Agendas por hora, reservas internas y cobro por comprobante.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={loadSlots} disabled={loadingAgendas || loadingSlots || agendas.length === 0}>
            <RefreshCw className={cn('size-4', loadingSlots && 'animate-spin')} />
            Actualizar
          </Button>
          {canManageAgendas ? (
            <Button type="button" onClick={openNewAgenda}>
              <Plus className="size-4" />
              Agenda
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <AgendaCalendar value={fecha} onChange={setFecha} />

        <section className="rounded-lg border bg-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Dia seleccionado</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">{fechaLarga(fecha)}</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                {loadingSlots ? 'Cargando...' : `${agendas.length} agendas`}
              </span>
            </div>
          </div>
          <div className="mt-4 grid gap-3 border-t pt-3 sm:grid-cols-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Agendas</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{agendas.length}</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Horarios</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{totalSlots}</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Reservas</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{reservasDelDia.length + reservasFijasDelDia.length}</p>
            </div>
          </div>
        </section>
      </div>

      {empty ? (
        <div className="rounded-lg border bg-card p-8 text-sm text-muted-foreground">
          Todavia no hay agendas de turnos.
        </div>
      ) : (
        <div className="space-y-5">
          {loadingAgendas ? (
            <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Cargando agendas...</div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {agendas.map((agenda) => {
                const data = agendaDia[agenda.id] ?? { slots: [], reservas: [], reservas_fijas: [], bloqueos: [], error: null };
                const reservaPorId = new Map(data.reservas.map((reserva) => [reserva.id, reserva]));
                const reservaFijaPorId = new Map(data.reservas_fijas.map((reserva) => [reserva.id, reserva]));
                const bloqueoPorId = new Map(data.bloqueos.map((bloqueo) => [bloqueo.id, bloqueo]));
                const reservasAgenda = data.reservas.filter((reserva) => reserva.fecha === fecha);
                const reservasFijasAgenda = data.reservas_fijas.filter(
                  (reserva) => reserva.activa !== false && Number(reserva.dia_semana) === diaSemanaIsoLocal(fecha),
                );
                return (
                  <section key={agenda.id} className="overflow-hidden rounded-lg border bg-card">
                    <div className="flex items-start justify-between gap-3 border-b bg-muted/25 px-3 py-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="truncate font-medium">{agenda.nombre}</h2>
                          {!agenda.activa ? (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Inactiva</span>
                          ) : null}
                          {agenda.agenda_principal_id ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
                              <Link2 className="size-3" />
                              {agendaNombreById.get(agenda.agenda_principal_id) ?? 'Principal'}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {precio(agenda.precio)} - {data.slots.length} horarios - {reservasAgenda.length + reservasFijasAgenda.length} reservas
                        </p>
                      </div>
                      {canManageAgendas ? (
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="outline"
                          onClick={() => openEditAgenda(agenda)}
                          aria-label={`Editar ${agenda.nombre}`}
                          title="Editar agenda"
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>

                    {data.error ? (
                      <p className="p-4 text-sm text-destructive">{data.error}</p>
                    ) : loadingSlots ? (
                      <p className="p-4 text-sm text-muted-foreground">Cargando turnos...</p>
                    ) : data.slots.length === 0 ? (
                      <p className="p-4 text-sm text-muted-foreground">Sin horarios disponibles para este dia.</p>
                    ) : (
                      <div>
                        <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] border-b bg-muted/40 px-3 py-1 text-[0.68rem] font-medium uppercase tracking-wide text-muted-foreground">
                          <span>Hora</span>
                          <span>Turno</span>
                        </div>
                        <div className="max-h-[520px] overflow-y-auto">
                          {data.slots.map((slot) => {
                            const reserva = slot.reserva_id ? reservaPorId.get(slot.reserva_id) : null;
                            const reservaFija = slot.reserva_fija_id ? reservaFijaPorId.get(slot.reserva_fija_id) : null;
                            const bloqueo = slot.bloqueo_id ? bloqueoPorId.get(slot.bloqueo_id) : null;
                            const key = `${agenda.id}-${slot.fecha}-${slot.hora_inicio}`;
                            const extraMonto = monto(slot.precio_extra);
                            return (
                              <div key={key} className="grid grid-cols-[4.75rem_minmax(0,1fr)] border-b last:border-b-0">
                                <div className="border-r bg-muted/15 px-2 py-2 text-xs tabular-nums text-muted-foreground">
                                  <p className="font-medium text-foreground">{hora(slot.hora_inicio)}</p>
                                  <p>{hora(slot.hora_fin)}</p>
                                </div>
                                <div
                                  className={cn(
                                    'min-h-16 px-2 py-2 text-sm transition-colors',
                                    slot.estado === 'disponible' && 'bg-background',
                                    slot.estado === 'reservado' &&
                                      'border-l-4 border-rose-500 bg-rose-50/80 dark:border-rose-700 dark:bg-rose-950/25',
                                    slot.estado === 'bloqueado' &&
                                      'border-l-4 border-amber-500 bg-amber-50/80 dark:border-amber-700 dark:bg-amber-950/25',
                                    reserva?.estado === 'cobrado' &&
                                      'border-l-4 border-emerald-500 bg-emerald-50/80 dark:border-emerald-700 dark:bg-emerald-950/25',
                                  )}
                                >
                                  {reserva ? (
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                      <div className="min-w-0">
                                        <p className="truncate font-medium">{reserva.nombre}</p>
                                        <p className="truncate text-xs text-muted-foreground">
                                          {reserva.telefono || reserva.email || 'Sin contacto'}
                                        </p>
                                        <p className="truncate text-xs text-muted-foreground">
                                          {precio(reserva.precio_snapshot)}
                                          {monto(reserva.sena_monto) > 0
                                            ? ` · Seña ${precio(reserva.sena_monto)} · Saldo ${precio(Math.max(0, monto(reserva.precio_snapshot) - monto(reserva.sena_monto)))}`
                                            : ''}
                                        </p>
                                      </div>
                                      <div className="flex flex-wrap gap-1.5">
                                        {reserva.estado === 'reservado' ? (
                                          <>
                                            <Button type="button" size="xs" onClick={() => setPayReserva(reserva)}>
                                              <CreditCard className="size-3" />
                                              Cobrar
                                            </Button>
                                            <Button type="button" size="xs" variant="outline" onClick={() => openSenaReserva(reserva)}>
                                              Seña
                                            </Button>
                                            <Button
                                              type="button"
                                              size="xs"
                                              variant="outline"
                                              onClick={() => cancelReserva(reserva.id)}
                                              disabled={busyId === reserva.id}
                                            >
                                              <XCircle className="size-3" />
                                              Cancelar
                                            </Button>
                                          </>
                                        ) : (
                                          <span className="inline-flex items-center gap-1 rounded-full bg-background/80 px-2 py-1 text-xs text-muted-foreground">
                                            <CheckCircle2 className="size-3" />
                                            {reserva.estado === 'cobrado' ? 'Cobrado' : reserva.estado}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  ) : reservaFija ? (
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <p className="truncate font-medium">{reservaFija.nombre}</p>
                                          <span className="rounded-full bg-background/80 px-2 py-0.5 text-xs text-muted-foreground">
                                            Fija
                                          </span>
                                        </div>
                                        <p className="truncate text-xs text-muted-foreground">
                                          {reservaFija.telefono || reservaFija.email || 'Sin contacto'}
                                        </p>
                                        <p className="truncate text-xs text-muted-foreground">
                                          {precio(slotPrecio(slot, agenda))}
                                          {extraMonto > 0 ? ` - Extra ${precio(extraMonto)}` : ''}
                                        </p>
                                      </div>
                                      {canManageAgendas ? (
                                        <Button
                                          type="button"
                                          size="xs"
                                          variant="outline"
                                          onClick={() => deleteReservaFija(reservaFija.id)}
                                          disabled={busyId === reservaFija.id}
                                        >
                                          <Trash2 className="size-3" />
                                          Quitar
                                        </Button>
                                      ) : null}
                                    </div>
                                  ) : slot.estado === 'reservado' ? (
                                    <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                      <Link2 className="size-3" />
                                      Ocupado en agenda principal
                                    </p>
                                  ) : bloqueo ? (
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                      <p className="text-muted-foreground">{bloqueo.motivo ?? 'Bloqueado'}</p>
                                      <Button
                                        type="button"
                                        size="xs"
                                        variant="outline"
                                        onClick={() => unblock(bloqueo.id)}
                                        disabled={busyId === bloqueo.id}
                                      >
                                        <XCircle className="size-3" />
                                        Liberar
                                      </Button>
                                    </div>
                                  ) : (
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="text-muted-foreground">
                                        Disponible - {precio(slotPrecio(slot, agenda))}
                                        {extraMonto > 0 ? ` - Extra ${precio(extraMonto)}` : ''}
                                      </span>
                                      <div className="flex flex-wrap gap-1.5">
                                        <Button type="button" size="xs" onClick={() => openReserva(agenda, slot)}>
                                          <Plus className="size-3" />
                                          Reservar
                                        </Button>
                                        {canManageAgendas ? (
                                          <Button
                                            type="button"
                                            size="xs"
                                            variant="outline"
                                            onClick={() => openReservaFija(agenda, slot)}
                                          >
                                            <CalendarClock className="size-3" />
                                            Fija
                                          </Button>
                                        ) : null}
                                        <Button
                                          type="button"
                                          size="xs"
                                          variant="outline"
                                          onClick={() => blockSlot(agenda, slot)}
                                          disabled={busyId === key}
                                        >
                                          <Ban className="size-3" />
                                          Bloquear
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          <section className="rounded-lg border bg-card">
            <div className="border-b px-4 py-3">
              <h2 className="font-medium">Reservas del dia</h2>
              <p className="text-sm text-muted-foreground">{reservasDelDia.length + reservasFijasDelDia.length} registros</p>
            </div>
            <div className="divide-y">
              {reservasDelDia.length === 0 && reservasFijasDelDia.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Sin reservas.</p>
              ) : (
                <>
                  {reservasDelDia.map((reserva) => (
                    <div key={reserva.id} className="px-4 py-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{reserva.nombre}</p>
                          <p className="text-muted-foreground">
                            {agendaNombreById.get(reserva.agenda_id) ?? 'Agenda'} - {hora(reserva.hora_inicio)} a {hora(reserva.hora_fin)} - {precio(reserva.precio_snapshot)}
                          </p>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 rounded-full px-2 py-0.5 text-xs',
                            reserva.estado === 'cobrado'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {reserva.estado}
                        </span>
                      </div>
                      {reserva.notas ? <p className="mt-2 text-xs text-muted-foreground">{reserva.notas}</p> : null}
                    </div>
                  ))}
                  {reservasFijasDelDia.map((reserva) => (
                    <div key={`fija-${reserva.id}`} className="px-4 py-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{reserva.nombre}</p>
                          <p className="text-muted-foreground">
                            {agendaNombreById.get(reserva.agenda_id) ?? 'Agenda'} - {hora(reserva.hora_inicio)} a {hora(reserva.hora_fin)}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          fija
                        </span>
                      </div>
                      {reserva.notas ? <p className="mt-2 text-xs text-muted-foreground">{reserva.notas}</p> : null}
                    </div>
                  ))}
                </>
              )}
            </div>
          </section>
        </div>
      )}

      <Dialog open={agendaOpen} onOpenChange={setAgendaOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{agendaForm.id ? 'Editar agenda' : 'Nueva agenda'}</DialogTitle>
            <DialogDescription>Servicio facturable y disponibilidad semanal.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm">
              Nombre
              <Input value={agendaForm.nombre} onChange={(e) => setAgendaForm((f) => ({ ...f, nombre: e.target.value }))} />
            </label>
            <label className="grid gap-1 text-sm">
              Descripcion
              <Input value={agendaForm.descripcion} onChange={(e) => setAgendaForm((f) => ({ ...f, descripcion: e.target.value }))} />
            </label>
            <label className="grid gap-1 text-sm sm:max-w-xs">
              Valor
              <Input
                type="number"
                min="0"
                step="0.01"
                value={agendaForm.precio}
                onChange={(e) => setAgendaForm((f) => ({ ...f, precio: e.target.value }))}
              />
            </label>
            <div className="grid gap-2">
              <span className="text-sm font-medium">Horarios por dia</span>
              <p className="text-xs text-muted-foreground">
                Agrega uno o varios rangos por dia (ej. 08:00-12:00, 15:00-20:00 o 22:00-02:00).
              </p>
              <div className="space-y-3 rounded-lg border p-3">
                {DIAS.map((d) => {
                  const items = agendaForm.disponibilidad
                    .map((row, idx) => ({ row, idx }))
                    .filter((it) => it.row.dia_semana === d.id);
                  return (
                    <div key={d.id} className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{d.label}</span>
                        <Button type="button" size="xs" variant="outline" onClick={() => addRango(d.id)}>
                          <Plus className="size-3" />
                          Agregar rango
                        </Button>
                      </div>
                      {items.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Sin horarios.</p>
                      ) : (
                        items.map((it) => (
                          <div key={it.idx} className="flex items-center gap-2">
                            <Input
                              type="time"
                              value={it.row.hora_inicio}
                              onChange={(e) => updateRango(it.idx, { hora_inicio: e.target.value })}
                              className="w-32"
                            />
                            <span className="text-xs text-muted-foreground">a</span>
                            <Input
                              type="time"
                              value={it.row.hora_fin}
                              onChange={(e) => updateRango(it.idx, { hora_fin: e.target.value })}
                              className="w-32"
                            />
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() => removeRango(it.idx)}
                              aria-label="Quitar rango"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                            {it.row.hora_fin < it.row.hora_inicio ? (
                              <span className="text-xs text-muted-foreground">dia siguiente</span>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-2">
              <span className="text-sm font-medium">Extras por horario</span>
              <div className="space-y-3 rounded-lg border p-3">
                {DIAS.map((d) => {
                  const items = agendaForm.extras_horarios
                    .map((extra, idx) => ({ extra, idx }))
                    .filter((it) => it.extra.dia_semana === d.id);
                  return (
                    <div key={d.id} className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{d.label}</span>
                        <Button type="button" size="xs" variant="outline" onClick={() => addExtraHorario(d.id)}>
                          <Plus className="size-3" />
                          Agregar extra
                        </Button>
                      </div>
                      {items.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Sin extras.</p>
                      ) : (
                        items.map((it) => (
                          <div key={it.idx} className="flex flex-wrap items-center gap-2">
                            <Input
                              type="time"
                              value={it.extra.hora_inicio}
                              onChange={(e) => updateExtraHorario(it.idx, { hora_inicio: e.target.value })}
                              className="w-32"
                            />
                            <span className="text-xs text-muted-foreground">a</span>
                            <Input
                              type="time"
                              value={it.extra.hora_fin}
                              onChange={(e) => updateExtraHorario(it.idx, { hora_fin: e.target.value })}
                              className="w-32"
                            />
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={String(it.extra.extra_monto ?? '')}
                              onChange={(e) => updateExtraHorario(it.idx, { extra_monto: e.target.value })}
                              className="w-32"
                              aria-label={`Extra ${d.label}`}
                            />
                            <Input
                              value={String(it.extra.descripcion ?? '')}
                              onChange={(e) => updateExtraHorario(it.idx, { descripcion: e.target.value })}
                              className="min-w-36 flex-1"
                              placeholder="Motivo"
                            />
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() => removeExtraHorario(it.idx)}
                              aria-label="Quitar extra"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            {(() => {
              const tieneDependientes = agendaForm.id
                ? agendas.some((a) => a.agenda_principal_id === agendaForm.id)
                : false;
              const candidatas = agendas.filter(
                (a) => a.id !== agendaForm.id && a.agenda_principal_id == null,
              );
              return (
                <label className="grid gap-1 text-sm">
                  <span className="flex items-center gap-1.5">
                    <Link2 className="size-3.5" />
                    Agenda principal (opcional)
                  </span>
                  <select
                    value={agendaForm.agenda_principal_id ?? ''}
                    onChange={(e) =>
                      setAgendaForm((f) => ({
                        ...f,
                        agenda_principal_id: e.target.value || null,
                      }))
                    }
                    disabled={tieneDependientes}
                    className="h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">Sin vincular</option>
                    {candidatas.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.nombre}
                      </option>
                    ))}
                  </select>
                  {tieneDependientes ? (
                    <span className="text-xs text-muted-foreground">
                      Otras agendas dependen de esta; no puede vincularse a otra.
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Al reservar en esta agenda principal, se bloquea el horario en las dependientes.
                    </span>
                  )}
                </label>
              );
            })()}
            <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
              Agenda activa
              <Switch checked={agendaForm.activa} onCheckedChange={(activa) => setAgendaForm((f) => ({ ...f, activa }))} />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAgendaOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={saveAgenda} disabled={savingAgenda}>
              <Save className="size-4" />
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reserveSlot != null} onOpenChange={(open) => !open && setReserveSlot(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reservar {reserveSlot ? slotLabel(reserveSlot.slot) : ''}</DialogTitle>
            <DialogDescription>
              {reserveSlot
                ? `${reserveSlot.agenda.nombre} - ${precio(slotPrecio(reserveSlot.slot, reserveSlot.agenda))}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm">
              Nombre
              <Input value={reservaForm.nombre} onChange={(e) => setReservaForm((f) => ({ ...f, nombre: e.target.value }))} />
            </label>
            <label className="grid gap-1 text-sm">
              Telefono
              <Input value={reservaForm.telefono} onChange={(e) => setReservaForm((f) => ({ ...f, telefono: e.target.value }))} />
            </label>
            <label className="grid gap-1 text-sm">
              Email
              <Input type="email" value={reservaForm.email} onChange={(e) => setReservaForm((f) => ({ ...f, email: e.target.value }))} />
            </label>
            <label className="grid gap-1 text-sm">
              Notas
              <Input value={reservaForm.notas} onChange={(e) => setReservaForm((f) => ({ ...f, notas: e.target.value }))} />
            </label>
            <label className="grid gap-1 text-sm">
              Seña
              <Input
                type="number"
                min={0}
                max={reserveSlot ? slotPrecio(reserveSlot.slot, reserveSlot.agenda) : undefined}
                step={0.01}
                value={reservaForm.sena_monto}
                onChange={(e) => setReservaForm((f) => ({ ...f, sena_monto: e.target.value }))}
                placeholder="0.00"
              />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReserveSlot(null)}>
              Cancelar
            </Button>
            <Button type="button" onClick={saveReserva} disabled={savingReserva}>
              <CheckCircle2 className="size-4" />
              Reservar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={fixedSlot != null} onOpenChange={(open) => !open && setFixedSlot(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reserva fija {fixedSlot ? slotLabel(fixedSlot.slot) : ''}</DialogTitle>
            <DialogDescription>
              {fixedSlot
                ? `${fixedSlot.agenda.nombre} - ${diaLabel(diaSemanaIsoLocal(fixedSlot.slot.fecha))}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm">
              Cliente
              <select
                value={fixedForm.cliente_id}
                onChange={(e) => selectClienteReservaFija(e.target.value)}
                disabled={loadingClientes}
                className="h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">{loadingClientes ? 'Cargando...' : 'Sin cliente asociado'}</option>
                {clientes.map((cliente) => (
                  <option key={cliente.id} value={cliente.id}>
                    {clienteLabel(cliente)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Nombre
              <Input value={fixedForm.nombre} onChange={(e) => setFixedForm((f) => ({ ...f, nombre: e.target.value }))} />
            </label>
            <label className="grid gap-1 text-sm">
              Telefono
              <Input value={fixedForm.telefono} onChange={(e) => setFixedForm((f) => ({ ...f, telefono: e.target.value }))} />
            </label>
            <label className="grid gap-1 text-sm">
              Email
              <Input type="email" value={fixedForm.email} onChange={(e) => setFixedForm((f) => ({ ...f, email: e.target.value }))} />
            </label>
            <label className="grid gap-1 text-sm">
              Notas
              <Input value={fixedForm.notas} onChange={(e) => setFixedForm((f) => ({ ...f, notas: e.target.value }))} />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFixedSlot(null)}>
              Cancelar
            </Button>
            <Button type="button" onClick={saveReservaFija} disabled={savingFixed}>
              <CalendarClock className="size-4" />
              Guardar fija
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={senaReserva != null} onOpenChange={(open) => !open && setSenaReserva(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar seña</DialogTitle>
            <DialogDescription>
              {senaReserva
                ? `${senaReserva.nombre} - ${precio(senaReserva.precio_snapshot)}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm">
              Seña
              <Input
                type="number"
                min={0}
                max={senaReserva ? Number(senaReserva.precio_snapshot ?? 0) : undefined}
                step={0.01}
                value={senaMontoInput}
                onChange={(e) => setSenaMontoInput(e.target.value)}
                placeholder="0.00"
              />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSenaReserva(null)}>
              Cancelar
            </Button>
            <Button type="button" onClick={saveSenaReserva} disabled={savingSena}>
              <Save className="size-4" />
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={payReserva != null} onOpenChange={(open) => !open && setPayReserva(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cobrar en POS</DialogTitle>
            <DialogDescription>
              {payReserva
                ? `${payReserva.nombre} - ${precio(payReserva.precio_snapshot)}${monto(payReserva.sena_monto) > 0 ? ` · Seña ${precio(payReserva.sena_monto)} · saldo ${precio(Math.max(0, monto(payReserva.precio_snapshot) - monto(payReserva.sena_monto)))}` : ''}. Podras sumar productos antes de cobrar.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPayReserva(null)}>
              Cancelar
            </Button>
            <Button type="button" onClick={cobrarReserva} disabled={charging}>
              <CreditCard className="size-4" />
              Abrir POS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
