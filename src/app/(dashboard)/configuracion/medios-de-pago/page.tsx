'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Opcion = { id?: string; cuotas: number; recargo_porcentaje: number };
type Medio = {
  id: string;
  nombre: string;
  activo: boolean;
  orden: number;
  medio_pago_opcion: Opcion[];
};

function filaOpcionVacia(): Opcion {
  return { cuotas: 1, recargo_porcentaje: 0 };
}

const RAPIDO_KEYS = ['efectivo', 'debito', 'credito', 'transferencia', 'mixto'] as const;
type RapidoKey = (typeof RAPIDO_KEYS)[number];

const RAPIDO_LABEL: Record<RapidoKey, string> = {
  efectivo: 'Efectivo',
  debito: 'Débito',
  credito: 'Crédito',
  transferencia: 'Transferencia',
  mixto: 'Mixto',
};

function rapidosVacios(): Record<RapidoKey, string> {
  return {
    efectivo: '0',
    debito: '0',
    credito: '0',
    transferencia: '0',
    mixto: '0',
  };
}

export default function MediosDePagoPage() {
  const { isAdmin } = useDashboardRole();
  const [medios, setMedios] = useState<Medio[]>([]);
  const [rapidos, setRapidos] = useState<Record<RapidoKey, string>>(rapidosVacios);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [guardandoRapidos, setGuardandoRapidos] = useState(false);

  const [crearNombre, setCrearNombre] = useState('');
  const [crearOpciones, setCrearOpciones] = useState<Opcion[]>([filaOpcionVacia()]);
  const [creando, setCreando] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/configuracion/medios-de-pago');
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? 'Error al cargar');
      setMedios([]);
      setRapidos(rapidosVacios());
    } else {
      setError(null);
      setMedios(json.medios ?? []);
      const r = json.rapidos as Record<string, number> | undefined;
      if (r) {
        setRapidos({
          efectivo: String(r.efectivo ?? 0),
          debito: String(r.debito ?? 0),
          credito: String(r.credito ?? 0),
          transferencia: String(r.transferencia ?? 0),
          mixto: String(r.mixto ?? 0),
        });
      } else {
        setRapidos(rapidosVacios());
      }
    }
    setLoading(false);
  }, []);

  async function guardarRapidos() {
    setGuardandoRapidos(true);
    setError(null);
    const body: Record<string, number> = {};
    for (const k of RAPIDO_KEYS) {
      const n = parseFloat(rapidos[k].replace(',', '.'));
      if (!Number.isFinite(n)) {
        setError(`Porcentaje inválido en ${RAPIDO_LABEL[k]}`);
        setGuardandoRapidos(false);
        return;
      }
      body[k] = n;
    }
    const res = await fetch('/api/configuracion/medios-de-pago/rapidos', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setGuardandoRapidos(false);
    if (!res.ok) {
      setError(json.error ?? 'No se pudo guardar');
      return;
    }
    const r = json.rapidos as Record<string, number>;
    if (r) {
      setRapidos({
        efectivo: String(r.efectivo ?? 0),
        debito: String(r.debito ?? 0),
        credito: String(r.credito ?? 0),
        transferencia: String(r.transferencia ?? 0),
        mixto: String(r.mixto ?? 0),
      });
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  async function crear() {
    if (!crearNombre.trim()) return;
    setCreando(true);
    setError(null);
    const res = await fetch('/api/configuracion/medios-de-pago', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: crearNombre.trim(),
        opciones: crearOpciones.map((o) => ({
          cuotas: o.cuotas,
          recargo_porcentaje: o.recargo_porcentaje,
        })),
      }),
    });
    const json = await res.json();
    setCreando(false);
    if (!res.ok) {
      setError(json.error ?? 'No se pudo crear');
      return;
    }
    setCrearNombre('');
    setCrearOpciones([filaOpcionVacia()]);
    await load();
  }

  async function toggleActivo(m: Medio) {
    setSavingId(m.id);
    setError(null);
    const res = await fetch(`/api/configuracion/medios-de-pago/${m.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo: !m.activo }),
    });
    const json = await res.json();
    setSavingId(null);
    if (!res.ok) {
      setError(json.error ?? 'Error al guardar');
      return;
    }
    await load();
  }

  async function guardarOpciones(m: Medio, opciones: Opcion[]) {
    setSavingId(m.id);
    setError(null);
    const res = await fetch(`/api/configuracion/medios-de-pago/${m.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        opciones: opciones.map((o) => ({
          cuotas: o.cuotas,
          recargo_porcentaje: o.recargo_porcentaje,
        })),
      }),
    });
    const json = await res.json();
    setSavingId(null);
    if (!res.ok) {
      setError(json.error ?? 'Error al guardar');
      return;
    }
    await load();
  }

  async function eliminar(id: string) {
    if (!confirm('¿Eliminar este medio de pago y todas sus opciones?')) return;
    setSavingId(id);
    setError(null);
    const res = await fetch(`/api/configuracion/medios-de-pago/${id}`, { method: 'DELETE' });
    const json = await res.json();
    setSavingId(null);
    if (!res.ok) {
      setError(json.error ?? 'Error al eliminar');
      return;
    }
    await load();
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">
        Solo el administrador del negocio puede configurar medios de pago.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <div>
        <Link
          href="/configuracion"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Configuración
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Medios de pago</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Definí medios (efectivo, tarjetas, etc.) y para cada uno las cuotas con su recargo o descuento
          (porcentaje negativo, p. ej. <span className="font-mono">-5</span> para 5% de descuento en
          efectivo). En la emisión de comprobantes se elige el medio y las cuotas; el ajuste se informa
          a ARCA como tributo 99 cuando es recargo.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <section className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
        <h2 className="font-medium">Atajos del POS (cobro rápido)</h2>
        <p className="text-sm text-muted-foreground">
          Ajuste sobre el total al usar los botones Efectivo, Débito, etc. sin entrar en &quot;Planes
          (cuotas)&quot;. Porcentaje negativo = descuento (ej. <span className="font-mono">-3</span> en
          efectivo), positivo = recargo. Se aplica igual en la emisión vía API si enviás{' '}
          <span className="font-mono">metodo_pago</span>.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {RAPIDO_KEYS.map((k) => (
            <label key={k} className="grid gap-1 text-sm">
              <span className="text-muted-foreground">{RAPIDO_LABEL[k]} · %</span>
              <Input
                type="text"
                inputMode="decimal"
                value={rapidos[k]}
                onChange={(e) => setRapidos((prev) => ({ ...prev, [k]: e.target.value }))}
                placeholder="0"
              />
            </label>
          ))}
        </div>
        <Button type="button" disabled={guardandoRapidos} onClick={() => void guardarRapidos()}>
          {guardandoRapidos ? 'Guardando…' : 'Guardar atajos'}
        </Button>
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
        <h2 className="font-medium">Nuevo medio de pago</h2>
        <label className="grid gap-1 text-sm max-w-md">
          <span className="text-muted-foreground">Nombre</span>
          <Input
            value={crearNombre}
            onChange={(e) => setCrearNombre(e.target.value)}
            placeholder="Ej. Visa, Mercado Pago, Efectivo"
          />
        </label>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Cuotas y % de recargo o descuento sobre el total</p>
          {crearOpciones.map((row, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-xs">
                <span className="text-muted-foreground">Cuotas</span>
                <Input
                  type="number"
                  min={1}
                  className="w-24"
                  value={row.cuotas || ''}
                  onChange={(e) => {
                    const v = [...crearOpciones];
                    v[i] = { ...v[i], cuotas: parseInt(e.target.value, 10) || 1 };
                    setCrearOpciones(v);
                  }}
                />
              </label>
              <label className="grid gap-1 text-xs">
                <span className="text-muted-foreground">% (negativo = descuento)</span>
                <Input
                  type="number"
                  step={0.01}
                  className="w-32"
                  value={row.recargo_porcentaje}
                  onChange={(e) => {
                    const v = [...crearOpciones];
                    v[i] = { ...v[i], recargo_porcentaje: parseFloat(e.target.value) || 0 };
                    setCrearOpciones(v);
                  }}
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => setCrearOpciones(crearOpciones.filter((_, j) => j !== i))}
              >
                Quitar
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCrearOpciones([...crearOpciones, filaOpcionVacia()])}
          >
            + Fila
          </Button>
        </div>
        <Button
          type="button"
          disabled={creando || !crearNombre.trim()}
          onClick={() => void crear()}
        >
          {creando ? 'Guardando…' : 'Crear medio de pago'}
        </Button>
      </section>

      <section className="space-y-4">
        <h2 className="font-medium">Medios configurados</h2>
        {medios.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay medios de pago.</p>
        ) : (
          medios.map((m) => (
            <MedioCard
              key={m.id}
              medio={m}
              disabled={savingId === m.id}
              onToggle={() => void toggleActivo(m)}
              onGuardarOpciones={(op) => void guardarOpciones(m, op)}
              onEliminar={() => void eliminar(m.id)}
            />
          ))
        )}
      </section>
    </div>
  );
}

function MedioCard({
  medio,
  disabled,
  onToggle,
  onGuardarOpciones,
  onEliminar,
}: {
  medio: Medio;
  disabled: boolean;
  onToggle: () => void;
  onGuardarOpciones: (op: Opcion[]) => void;
  onEliminar: () => void;
}) {
  const [edit, setEdit] = useState<Opcion[]>(
    medio.medio_pago_opcion.map((o) => ({
      id: o.id,
      cuotas: o.cuotas,
      recargo_porcentaje: o.recargo_porcentaje,
    })),
  );

  useEffect(() => {
    setEdit(
      medio.medio_pago_opcion.map((o) => ({
        id: o.id,
        cuotas: o.cuotas,
        recargo_porcentaje: o.recargo_porcentaje,
      })),
    );
  }, [medio]);

  const dirty =
    JSON.stringify(edit) !==
    JSON.stringify(
      medio.medio_pago_opcion.map((o) => ({
        cuotas: o.cuotas,
        recargo_porcentaje: o.recargo_porcentaje,
      })),
    );

  return (
    <div
      className={cn(
        'rounded-xl border p-4 shadow-sm',
        medio.activo ? 'bg-card' : 'bg-muted/30 opacity-90',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{medio.nombre}</p>
          <p className="text-xs text-muted-foreground">
            {medio.activo ? 'Activo en emisión' : 'Desactivado'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onToggle}>
            {medio.activo ? 'Desactivar' : 'Activar'}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={disabled} onClick={onEliminar}>
            Eliminar
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {edit.map((row, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs">
              <span className="text-muted-foreground">Cuotas</span>
              <Input
                type="number"
                min={1}
                className="w-24"
                value={row.cuotas || ''}
                onChange={(e) => {
                  const v = [...edit];
                  v[i] = { ...v[i], cuotas: parseInt(e.target.value, 10) || 1 };
                  setEdit(v);
                }}
              />
            </label>
            <label className="grid gap-1 text-xs">
              <span className="text-muted-foreground">% recargo / desc.</span>
              <Input
                type="number"
                step={0.01}
                className="w-32"
                value={row.recargo_porcentaje}
                onChange={(e) => {
                  const v = [...edit];
                  v[i] = { ...v[i], recargo_porcentaje: parseFloat(e.target.value) || 0 };
                  setEdit(v);
                }}
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEdit(edit.filter((_, j) => j !== i))}
            >
              Quitar
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEdit([...edit, filaOpcionVacia()])}
        >
          + Fila
        </Button>
      </div>

      {dirty ? (
        <Button
          type="button"
          className="mt-3"
          size="sm"
          disabled={disabled}
          onClick={() => onGuardarOpciones(edit)}
        >
          Guardar cambios en cuotas
        </Button>
      ) : null}
    </div>
  );
}
