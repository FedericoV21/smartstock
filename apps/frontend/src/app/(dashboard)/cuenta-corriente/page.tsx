'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CUENTA_CORRIENTE_CONDICIONES_DEFAULTS } from '@/lib/cuenta-corriente/condiciones-patch';
import { describirSaldoCuentaCorriente } from '@/lib/cuenta-corriente/saldo';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database';

const money = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n);

type CobroPeriodicidad = Database['public']['Enums']['cobro_periodicidad'];

const CONDICION_IVA_LABELS: Record<string, string> = {
  responsable_inscripto: 'Resp. Inscripto',
  monotributista: 'Monotributista',
  exento: 'Exento',
  consumidor_final: 'Consumidor Final',
};

type ClienteRow = {
  id: string;
  nombre: string;
  razon_social: string | null;
  cuit_dni: string | null;
  condicion_iva: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
  created_at: string;
  cuenta_corriente: { id: string; saldo: number } | null;
};

export default function ClientesPage() {
  const { canEdit } = useDashboardRole();
  const [clientes, setClientes] = useState<ClienteRow[]>([]);
  const [cargosHoyPorCliente, setCargosHoyPorCliente] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nombre, setNombre] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [cuitDni, setCuitDni] = useState('');
  const [condicionIva, setCondicionIva] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [direccion, setDireccion] = useState('');
  const [notas, setNotas] = useState('');

  const [ccTipo, setCcTipo] = useState<'cliente' | 'empleado'>('cliente');
  const [ccModalidad, setCcModalidad] = useState<
    'por_comprobante' | 'periodico' | 'dia_fijo_mes'
  >(CUENTA_CORRIENTE_CONDICIONES_DEFAULTS.cobro_modalidad);
  const [ccDiasPlazo, setCcDiasPlazo] = useState(
    String(CUENTA_CORRIENTE_CONDICIONES_DEFAULTS.cobro_dias_plazo),
  );
  const [ccPeriodicidad, setCcPeriodicidad] = useState<CobroPeriodicidad>('mensual');
  const [ccDiaMes, setCcDiaMes] = useState('22');
  const [ccMontoMin, setCcMontoMin] = useState(
    String(CUENTA_CORRIENTE_CONDICIONES_DEFAULTS.cobro_monto_minimo),
  );

  const load = useCallback(async (q = '') => {
    setLoading(true);
    const url = q ? `/api/clientes?q=${encodeURIComponent(q)}` : '/api/clientes';
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? 'Error al cargar');
      setClientes([]);
      setCargosHoyPorCliente({});
    } else {
      setError(null);
      setClientes(json.clientes ?? []);
      const sid = typeof json.sucursal_id === 'string' ? json.sucursal_id : '';
      if (sid) {
        try {
          const chRes = await fetch(
            `/api/cuenta-corriente/cargos-hoy?sucursal_id=${encodeURIComponent(sid)}`,
            { cache: 'no-store' },
          );
          const chJson = (await chRes.json()) as {
            habilitado?: boolean;
            por_cliente?: Record<string, number>;
          };
          if (chRes.ok && chJson.habilitado) {
            setCargosHoyPorCliente(chJson.por_cliente ?? {});
          } else {
            setCargosHoyPorCliente({});
          }
        } catch {
          setCargosHoyPorCliente({});
        }
      } else {
        setCargosHoyPorCliente({});
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void load(busqueda);
    }, 300);
    return () => clearTimeout(timeout);
  }, [busqueda, load]);

  function openCreate() {
    setNombre('');
    setRazonSocial('');
    setCuitDni('');
    setCondicionIva('');
    setTelefono('');
    setEmail('');
    setDireccion('');
    setNotas('');
    setCcTipo('cliente');
    setCcModalidad(CUENTA_CORRIENTE_CONDICIONES_DEFAULTS.cobro_modalidad);
    setCcDiasPlazo(String(CUENTA_CORRIENTE_CONDICIONES_DEFAULTS.cobro_dias_plazo));
    setCcPeriodicidad('mensual');
    setCcDiaMes('22');
    setCcMontoMin(String(CUENTA_CORRIENTE_CONDICIONES_DEFAULTS.cobro_monto_minimo));
    setError(null);
    setOpen(true);
  }

  async function handleSave() {
    if (!nombre.trim()) return;
    if (ccModalidad === 'por_comprobante') {
      const d = Number.parseInt(ccDiasPlazo, 10);
      if (!Number.isFinite(d) || d < 1 || d > 3650) {
        setError('Indicá un plazo en días entre 1 y 3650 en cuenta corriente.');
        return;
      }
    }
    if (ccModalidad === 'dia_fijo_mes') {
      const dm = Number.parseInt(ccDiaMes, 10);
      if (!Number.isFinite(dm) || dm < 1 || dm > 31) {
        setError('Indicá un día del mes entre 1 y 31.');
        return;
      }
    }
    setSaving(true);
    setError(null);
    const minParsed = Number(ccMontoMin.replace(',', '.'));
    const cuentaCorriente: Record<string, unknown> = {
      tipo_cuenta: ccTipo,
      cobro_modalidad: ccModalidad,
      cobro_monto_minimo: Number.isFinite(minParsed) ? minParsed : 0,
    };
    if (ccModalidad === 'por_comprobante') {
      cuentaCorriente.cobro_dias_plazo = Number.parseInt(ccDiasPlazo, 10);
      cuentaCorriente.cobro_periodicidad = null;
      cuentaCorriente.cobro_dia_vencimiento_mes = null;
    } else if (ccModalidad === 'periodico') {
      cuentaCorriente.cobro_periodicidad = ccPeriodicidad;
      cuentaCorriente.cobro_dia_vencimiento_mes = null;
    } else {
      cuentaCorriente.cobro_dia_vencimiento_mes = Number.parseInt(ccDiaMes, 10);
      cuentaCorriente.cobro_periodicidad = null;
    }

    const res = await fetch('/api/clientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: nombre.trim(),
        razon_social: razonSocial || null,
        cuit_dni: cuitDni || null,
        condicion_iva: condicionIva || null,
        direccion: direccion || null,
        telefono: telefono || null,
        email: email || null,
        notas: notas || null,
        cuenta_corriente: cuentaCorriente,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(json.error ?? 'No se pudo crear');
      return;
    }
    setOpen(false);
    await load(busqueda);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gestioná tus clientes y sus datos fiscales para facturación.
          </p>
        </div>
        {canEdit ? (
          <Button type="button" onClick={openCreate} className="shrink-0">
            Nuevo cliente
          </Button>
        ) : null}
      </div>

      <Input
        placeholder="Buscar por nombre, razón social o CUIT/DNI…"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        className="max-w-md"
      />

      {error && !open ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="rounded-xl border bg-card shadow-sm">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
        ) : clientes.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            {busqueda ? 'No se encontraron clientes.' : 'No hay clientes todavía.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>CUIT/DNI</TableHead>
                <TableHead>Cond. IVA</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="text-right whitespace-nowrap">Saldo cta. cte.</TableHead>
                <TableHead className="w-24">Estado</TableHead>
                <TableHead className="w-[1%] text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clientes.map((c) => {
                const cargosHoy = cargosHoyPorCliente[c.id] ?? 0;
                return (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/cuenta-corriente/${c.id}`} className="font-medium hover:underline">
                      {c.razon_social || c.nombre}
                    </Link>
                    {cargosHoy > 0 ? (
                      <span className="ml-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                        {cargosHoy} {cargosHoy === 1 ? 'cargo hoy' : 'cargos hoy'}
                      </span>
                    ) : null}
                    {c.razon_social ? (
                      <span className="ml-1 text-xs text-muted-foreground">({c.nombre})</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {c.cuit_dni ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {c.condicion_iva ? (CONDICION_IVA_LABELS[c.condicion_iva] ?? c.condicion_iva) : '—'}
                  </TableCell>
                  <TableCell>{c.telefono ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{c.email ?? '—'}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {c.cuenta_corriente ? (() => {
                      const info = describirSaldoCuentaCorriente(
                        c.cuenta_corriente.saldo,
                        'cliente',
                      );
                      return (
                        <div className="grid gap-0.5">
                          <span
                            className={cn(
                              'font-medium',
                              info.estado === 'deuda'
                                ? 'text-red-600'
                                : info.estado === 'saldo_a_favor'
                                  ? 'text-emerald-600'
                                  : '',
                            )}
                          >
                            {money(info.monto)}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{info.titulo}</span>
                        </div>
                      );
                    })() : '—'}
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        c.activo
                          ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800'
                          : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                      }
                    >
                      {c.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/cuenta-corriente/${c.id}#historial-comprobantes`}
                      className={cn(
                        buttonVariants({ variant: 'outline', size: 'sm' }),
                        'inline-flex whitespace-nowrap',
                      )}
                    >
                      Facturas y recibos
                    </Link>
                  </TableCell>
                </TableRow>
              );
              })}
            </TableBody>
          </Table>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Nuevo cliente</DialogTitle>
            <DialogDescription>
              Completá los datos del cliente y la cuenta corriente. La condición IVA determina el tipo
              de factura.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Nombre *</span>
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Razón social</span>
              <Input value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">CUIT/DNI</span>
                <Input value={cuitDni} onChange={(e) => setCuitDni(e.target.value)} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Condición IVA</span>
                <select
                  value={condicionIva}
                  onChange={(e) => setCondicionIva(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Seleccionar…</option>
                  <option value="responsable_inscripto">Responsable Inscripto</option>
                  <option value="monotributista">Monotributista</option>
                  <option value="exento">Exento</option>
                  <option value="consumidor_final">Consumidor Final</option>
                </select>
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Dirección</span>
              <Input value={direccion} onChange={(e) => setDireccion(e.target.value)} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Teléfono</span>
                <Input value={telefono} onChange={(e) => setTelefono(e.target.value)} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Email</span>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Notas</span>
              <Input value={notas} onChange={(e) => setNotas(e.target.value)} />
            </label>

            <div className="border-t pt-4">
              <p className="mb-3 text-sm font-medium">Cuenta corriente</p>
              <div className="grid gap-3">
                <label className="grid gap-1 text-sm">
                  <span className="text-muted-foreground">Tipo de cuenta</span>
                  <select
                    value={ccTipo}
                    onChange={(e) => setCcTipo(e.target.value as 'cliente' | 'empleado')}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="cliente">Cliente</option>
                    <option value="empleado">Empleado</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-muted-foreground">Modalidad de cobro</span>
                  <select
                    value={ccModalidad}
                    onChange={(e) =>
                      setCcModalidad(
                        e.target.value as 'por_comprobante' | 'periodico' | 'dia_fijo_mes',
                      )
                    }
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="por_comprobante">Por factura / ticket (plazo en días)</option>
                    <option value="periodico">Periódico (día / semana / quincena / mes)</option>
                    <option value="dia_fijo_mes">Día fijo del mes</option>
                  </select>
                </label>
                {ccModalidad === 'por_comprobante' ? (
                  <label className="grid gap-1 text-sm">
                    <span className="text-muted-foreground">Días hasta el vencimiento (desde la emisión)</span>
                    <Input
                      inputMode="numeric"
                      value={ccDiasPlazo}
                      onChange={(e) => setCcDiasPlazo(e.target.value)}
                    />
                  </label>
                ) : null}
                {ccModalidad === 'periodico' ? (
                  <label className="grid gap-1 text-sm">
                    <span className="text-muted-foreground">Periodicidad</span>
                    <select
                      value={ccPeriodicidad}
                      onChange={(e) =>
                        setCcPeriodicidad(e.target.value as CobroPeriodicidad)
                      }
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="diaria">Diaria</option>
                      <option value="semanal">Semanal</option>
                      <option value="quincenal">Quincenal</option>
                      <option value="mensual">Mensual</option>
                    </select>
                  </label>
                ) : null}
                {ccModalidad === 'dia_fijo_mes' ? (
                  <label className="grid gap-1 text-sm">
                    <span className="text-muted-foreground">Día de vencimiento (1–31)</span>
                    <Input
                      inputMode="numeric"
                      value={ccDiaMes}
                      onChange={(e) => setCcDiaMes(e.target.value)}
                    />
                  </label>
                ) : null}
                <label className="grid gap-1 text-sm">
                  <span className="text-muted-foreground">Monto mínimo por cobro</span>
                  <Input
                    inputMode="decimal"
                    value={ccMontoMin}
                    onChange={(e) => setCcMontoMin(e.target.value)}
                    placeholder="0"
                  />
                  <span className="text-xs text-muted-foreground">
                    Se permite menos solo al liquidar el saldo total de una factura.
                  </span>
                </label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={saving || !nombre.trim()}
              onClick={() => void handleSave()}
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
