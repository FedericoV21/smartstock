'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MontoInput } from '@/components/ui/monto-input';
import type { ExtractoLineaConEdicion } from '@/lib/cuenta-corriente/extracto-editabilidad';
import type { MovimientoDiaItemDto } from '@/lib/cuenta-corriente/movimientos-dia';

const TIPOS_PAGO = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'otro', label: 'Otro' },
] as const;

export function ExtractoLineaEditDialog({
  clienteId,
  linea,
  open,
  onOpenChange,
  onGuardado,
}: {
  clienteId: string;
  linea: ExtractoLineaConEdicion | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGuardado: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [monto, setMonto] = useState<number | null>(null);
  const [fecha, setFecha] = useState('');
  const [tipoPago, setTipoPago] = useState('efectivo');
  const [notas, setNotas] = useState('');
  const [referencia, setReferencia] = useState('');

  const [cargoItems, setCargoItems] = useState<MovimientoDiaItemDto[]>([]);
  const [preciosEdit, setPreciosEdit] = useState<Record<string, number | null>>({});
  const [cargoTitulo, setCargoTitulo] = useState('');

  const esPago = linea?.tipo === 'pago';
  const esCargo = linea?.tipo === 'cargo';

  useEffect(() => {
    if (!open || !linea) return;
    setError(null);
    if (esPago) {
      setMonto(linea.haber > 0 ? linea.haber : null);
      setFecha(linea.fecha);
      setTipoPago('efectivo');
      setNotas('');
      setReferencia('');
    }
    if (esCargo && linea.comprobante_id && linea.sucursal_id) {
      setLoading(true);
      void (async () => {
        const qs = new URLSearchParams({ sucursal_id: linea.sucursal_id! });
        const res = await fetch(
          `/api/clientes/${encodeURIComponent(clienteId)}/cuenta-corriente/comprobantes/${encodeURIComponent(linea.comprobante_id!)}/liquidacion?${qs}`,
          { cache: 'no-store' },
        );
        const json = (await res.json()) as {
          error?: string;
          descripcion?: string;
          items?: MovimientoDiaItemDto[];
        };
        if (!res.ok) {
          setError(json.error ?? 'No se pudo cargar el comprobante.');
          setCargoItems([]);
        } else {
          setCargoTitulo(json.descripcion ?? linea.descripcion);
          const items = json.items ?? [];
          setCargoItems(items);
          const inicial: Record<string, number | null> = {};
          for (const it of items) {
            inicial[it.id] = it.precioUnitario;
          }
          setPreciosEdit(inicial);
        }
        setLoading(false);
      })();
    }
  }, [open, linea, clienteId, esPago, esCargo]);

  async function guardarPago() {
    if (!linea?.pago_id) return;
    const montoNum = monto;
    if (montoNum === null || montoNum <= 0) {
      setError('Indicá un monto válido.');
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetch(
      `/api/clientes/${encodeURIComponent(clienteId)}/cuenta-corriente/pagos/${encodeURIComponent(linea.pago_id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monto: montoNum,
          fecha,
          tipo_pago: tipoPago,
          referencia: referencia.trim() || null,
          notas: notas.trim() || null,
        }),
      },
    );
    const json = (await res.json()) as { error?: string };
    setLoading(false);
    if (!res.ok) {
      setError(json.error ?? 'No se pudo guardar el pago.');
      return;
    }
    toast.success('Pago actualizado.');
    onOpenChange(false);
    onGuardado();
  }

  async function guardarCargo() {
    if (!linea?.comprobante_id || !linea.sucursal_id) return;
    setLoading(true);
    setError(null);
    const items = cargoItems.map((it) => {
      const pu = preciosEdit[it.id] ?? it.precioUnitario;
      if (!Number.isFinite(pu) || pu < 0) {
        return { id: it.id, precio_unitario: NaN };
      }
      return { id: it.id, precio_unitario: pu };
    });
    if (items.some((i) => !Number.isFinite(i.precio_unitario))) {
      setLoading(false);
      setError('Indicá un precio unitario válido en cada ítem.');
      return;
    }
    const res = await fetch(
      `/api/clientes/${encodeURIComponent(clienteId)}/cuenta-corriente/liquidar-items`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sucursal_id: linea.sucursal_id,
          comprobante_id: linea.comprobante_id,
          items,
        }),
      },
    );
    const json = (await res.json()) as { error?: string };
    setLoading(false);
    if (!res.ok) {
      setError(json.error ?? 'No se pudo guardar el cargo.');
      return;
    }
    toast.success('Importes del comprobante actualizados.');
    onOpenChange(false);
    onGuardado();
  }

  if (!linea) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{esPago ? 'Editar pago' : 'Editar cargo'}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{linea.descripcion}</p>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {esPago ? (
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Monto (haber)</span>
              <MontoInput
                className="tabular-nums"
                value={monto}
                onValueChange={setMonto}
                min={0}
                decimals={2}
                placeholder="0,00"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Fecha</span>
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Medio de pago</span>
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={tipoPago}
                onChange={(e) => setTipoPago(e.target.value)}
              >
                {TIPOS_PAGO.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Referencia (opcional)</span>
              <Input value={referencia} onChange={(e) => setReferencia(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Notas (opcional)</span>
              <Input value={notas} onChange={(e) => setNotas(e.target.value)} />
            </label>
          </div>
        ) : null}

        {esCargo ? (
          loading && cargoItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Cargando ítems…</p>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2 text-sm">
              <p className="font-medium">{cargoTitulo}</p>
              {cargoItems.map((it) => (
                <div key={it.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 flex-1">
                    {it.nombre}
                    <span className="ml-1 text-muted-foreground">× {it.cantidadLabel}</span>
                  </span>
                  <label className="flex items-center gap-1 text-xs">
                    <span className="text-muted-foreground">PU $</span>
                    <MontoInput
                      className="h-8 w-28 tabular-nums"
                      value={preciosEdit[it.id] ?? it.precioUnitario}
                      onValueChange={(v) =>
                        setPreciosEdit((prev) => ({ ...prev, [it.id]: v }))
                      }
                      min={0}
                      decimals={2}
                    />
                  </label>
                </div>
              ))}
            </div>
          )
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={loading || (esCargo && cargoItems.length === 0)}
            onClick={() => void (esPago ? guardarPago() : guardarCargo())}
          >
            {loading ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
