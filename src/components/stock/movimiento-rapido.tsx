'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type TipoMov = 'entrada' | 'salida' | 'ajuste';

const MOTIVO_OTRO = '__otro__';

const MOTIVOS_ENTRADA = ['Ingreso', 'Devolución cliente', 'Ajuste inventario'] as const;
const MOTIVOS_SALIDA = [
  'Venta',
  'Desperdicio',
  'Vencimiento',
  'Robo / faltante',
  'Uso interno',
] as const;

const selectClass = cn(
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'
);

export function MovimientoRapido({
  productoId,
  productoNombre,
  stockActual,
  onSuccess,
}: {
  productoId: string;
  productoNombre: string;
  stockActual: number;
  onSuccess: () => void;
}) {
  const [tipo, setTipo] = useState<TipoMov>('entrada');
  const [cantidad, setCantidad] = useState('');
  const [motivoPreset, setMotivoPreset] = useState<string>(MOTIVOS_ENTRADA[0]);
  const [motivoOtroTexto, setMotivoOtroTexto] = useState('');
  const [motivoAjuste, setMotivoAjuste] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function motivoParaApi(): { ok: true; motivo: string | null } | { ok: false; error: string } {
    if (tipo === 'ajuste') {
      const t = motivoAjuste.trim();
      return { ok: true, motivo: t || null };
    }
    if (motivoPreset === MOTIVO_OTRO) {
      const t = motivoOtroTexto.trim();
      if (!t) return { ok: false, error: 'Indicá el motivo (Otro)' };
      return { ok: true, motivo: t };
    }
    return { ok: true, motivo: motivoPreset };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const n = parseInt(cantidad, 10);
    if (!n || n <= 0) {
      setError('Indicá una cantidad válida');
      return;
    }
    const motivoRes = motivoParaApi();
    if (!motivoRes.ok) {
      setError(motivoRes.error);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/movimientos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          producto_id: productoId,
          tipo,
          cantidad: n,
          motivo: motivoRes.motivo,
          referencia_tipo: 'manual',
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Error al registrar');
        return;
      }
      setCantidad('');
      setMotivoOtroTexto('');
      setMotivoAjuste('');
      onSuccess();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-xl border bg-card p-4 shadow-sm"
    >
      <h3 className="font-medium">Movimiento rápido — {productoNombre}</h3>
      <p className="mt-1 text-xs text-muted-foreground">Stock actual: {stockActual}</p>
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Tipo</span>
          <select
            className={selectClass}
            value={tipo}
            onChange={(e) => {
              const next = e.target.value as TipoMov;
              setTipo(next);
              setMotivoOtroTexto('');
              if (next === 'entrada') setMotivoPreset(MOTIVOS_ENTRADA[0]);
              else if (next === 'salida') setMotivoPreset(MOTIVOS_SALIDA[0]);
            }}
          >
            <option value="entrada">Entrada</option>
            <option value="salida">Salida</option>
            <option value="ajuste">Ajuste (valor final)</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Cantidad</span>
          <Input
            inputMode="numeric"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
          />
        </label>
      </div>
      {tipo === 'ajuste' ? (
        <label className="mt-3 grid gap-1 text-sm">
          <span className="text-muted-foreground">Motivo (opc.)</span>
          <Input value={motivoAjuste} onChange={(e) => setMotivoAjuste(e.target.value)} />
        </label>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label
            className={cn(
              'grid gap-1 text-sm',
              motivoPreset !== MOTIVO_OTRO && 'sm:col-span-2'
            )}
          >
            <span className="text-muted-foreground">Motivo</span>
            <select
              className={selectClass}
              value={motivoPreset}
              onChange={(e) => setMotivoPreset(e.target.value)}
            >
              {(tipo === 'entrada' ? MOTIVOS_ENTRADA : MOTIVOS_SALIDA).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value={MOTIVO_OTRO}>Otro</option>
            </select>
          </label>
          {motivoPreset === MOTIVO_OTRO ? (
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Describí el motivo</span>
              <Input
                value={motivoOtroTexto}
                onChange={(e) => setMotivoOtroTexto(e.target.value)}
                placeholder="Ej: donación, muestra…"
              />
            </label>
          ) : null}
        </div>
      )}
      <Button type="submit" className="mt-3" disabled={loading}>
        {loading ? 'Registrando…' : 'Registrar'}
      </Button>
    </form>
  );
}
