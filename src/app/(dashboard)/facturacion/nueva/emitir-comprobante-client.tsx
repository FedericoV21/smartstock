'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/formatters';

const CONDICION_IVA_LABELS: Record<string, string> = {
  responsable_inscripto: 'Resp. Inscripto',
  monotributista: 'Monotributista',
  exento: 'Exento',
  consumidor_final: 'Consumidor Final',
};

type Cliente = {
  id: string;
  nombre: string;
  razon_social: string | null;
  condicion_iva: string | null;
};

type Producto = {
  id: string;
  codigo: string | null;
  nombre: string;
  precio_venta: number;
  precio_costo: number;
  stock_actual: number;
  iva_porcentaje?: number | null;
};

type ItemForm = {
  producto: Producto;
  cantidad: number;
  precio_unitario: number;
};

type MedioPagoRow = {
  id: string;
  nombre: string;
  activo: boolean;
  medio_pago_opcion: { id: string; cuotas: number; recargo_porcentaje: number }[];
};

function determinarTipoLocal(
  emisorIva: string | null,
  receptorIva: string | null,
): string {
  const emisor = emisorIva ?? 'consumidor_final';
  const receptor = receptorIva ?? 'consumidor_final';

  if (emisor === 'monotributista' || emisor === 'exento') return 'factura_c';
  if (emisor === 'responsable_inscripto') {
    if (receptor === 'responsable_inscripto') return 'factura_a';
    return 'factura_b';
  }
  return 'factura_c';
}

const TIPO_LABELS: Record<string, string> = {
  factura_a: 'Factura A',
  factura_b: 'Factura B',
  factura_c: 'Factura C',
  nota_credito_a: 'Nota de Crédito A',
  nota_credito_b: 'Nota de Crédito B',
  nota_credito_c: 'Nota de Crédito C',
  remito: 'Remito',
  presupuesto: 'Presupuesto',
};

function margenColor(pct: number): string {
  if (pct >= 30) return 'text-emerald-600';
  if (pct >= 15) return 'text-yellow-600';
  return 'text-red-600';
}

export function EmitirComprobanteClient({ initialTipo }: { initialTipo?: string }) {
  const router = useRouter();

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [tenantIva, setTenantIva] = useState<string | null>(null);
  const [ivaDefault, setIvaDefault] = useState(21);
  const [loading, setLoading] = useState(true);
  const [showMargen, setShowMargen] = useState(false);

  const [clienteId, setClienteId] = useState('');
  const [tipo, setTipo] = useState('');
  const [items, setItems] = useState<ItemForm[]>([]);
  const [notas, setNotas] = useState('');
  const [emitiendo, setEmitiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediosPago, setMediosPago] = useState<MedioPagoRow[]>([]);
  const [medioPagoId, setMedioPagoId] = useState('');
  const [opcionPagoId, setOpcionPagoId] = useState('');

  useEffect(() => {
    if (initialTipo === 'presupuesto') {
      setTipo('presupuesto');
    }
  }, [initialTipo]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [cRes, pRes, tRes, mRes, perfilRes, mpRes] = await Promise.all([
      fetch('/api/clientes'),
      fetch('/api/productos'),
      fetch('/api/configuracion/tenant'),
      fetch('/api/configuracion/plan'),
      fetch('/api/perfil'),
      fetch('/api/configuracion/medios-de-pago'),
    ]);

    if (cRes.ok) {
      const cJson = await cRes.json();
      setClientes(cJson.clientes ?? []);
    }
    if (pRes.ok) {
      const pJson = await pRes.json();
      setProductos(pJson.productos ?? []);
    }
    if (tRes.ok) {
      const tJson = await tRes.json();
      setTenantIva(tJson.condicion_iva ?? null);
    }
    if (mRes.ok) {
      const mJson = await mRes.json();
      const modulos = mJson.modulos ?? mJson;
      setShowMargen(!!modulos.analizador_rentabilidad);
    }
    if (perfilRes.ok) {
      const pJson = await perfilRes.json();
      if (pJson.ivaDefault != null) setIvaDefault(pJson.ivaDefault);
    }
    if (mpRes.ok) {
      const mpJson = await mpRes.json();
      const list = (mpJson.medios ?? []) as MedioPagoRow[];
      setMediosPago(list.filter((m) => m.activo && (m.medio_pago_opcion?.length ?? 0) > 0));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!medioPagoId) {
      setOpcionPagoId('');
      return;
    }
    const m = mediosPago.find((x) => x.id === medioPagoId);
    if (!m?.medio_pago_opcion?.length) {
      setOpcionPagoId('');
      return;
    }
    setOpcionPagoId((prev) =>
      m.medio_pago_opcion.some((o) => o.id === prev) ? prev : m.medio_pago_opcion[0].id,
    );
  }, [medioPagoId, mediosPago]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function handleClienteChange(id: string) {
    setClienteId(id);
    if (id) {
      const cli = clientes.find((c) => c.id === id);
      if (cli && tipo !== 'presupuesto') {
        const autoTipo = determinarTipoLocal(tenantIva, cli.condicion_iva);
        setTipo(autoTipo);
      }
    }
  }

  function agregarItem(productoId: string) {
    const prod = productos.find((p) => p.id === productoId);
    if (!prod) return;
    if (items.some((i) => i.producto.id === productoId)) return;
    setItems([
      ...items,
      { producto: prod, cantidad: 1, precio_unitario: prod.precio_venta },
    ]);
  }

  function actualizarItem(
    index: number,
    campo: 'cantidad' | 'precio_unitario',
    valor: number,
  ) {
    const nuevos = [...items];
    nuevos[index] = { ...nuevos[index], [campo]: valor };
    setItems(nuevos);
  }

  function eliminarItem(index: number) {
    setItems(items.filter((_, i) => i !== index));
  }

  // Precios IVA-incluidos: el total es la suma bruta y, para Factura A,
  // sólo se DISCRIMINA el IVA embebido (no se suma al total).
  // Cada ítem usa su propia alícuota (iva_porcentaje del producto); si no
  // tiene, cae al default del tenant.
  const subtotal = items.reduce(
    (sum, i) => sum + i.cantidad * i.precio_unitario,
    0,
  );
  const esFacturaA = tipo === 'factura_a' || tipo === 'nota_credito_a';

  const ivaPorItem = items.map((it) => {
    const rate = it.producto.iva_porcentaje ?? ivaDefault;
    const lineGross = it.cantidad * it.precio_unitario;
    const lineIva = esFacturaA
      ? Math.round(((lineGross * rate) / (100 + rate)) * 100) / 100
      : 0;
    return { rate, lineGross: Math.round(lineGross * 100) / 100, lineIva };
  });

  const ivaDesglose = ivaPorItem.reduce<Record<number, number>>((acc, it) => {
    if (it.lineIva <= 0) return acc;
    acc[it.rate] = Math.round(((acc[it.rate] ?? 0) + it.lineIva) * 100) / 100;
    return acc;
  }, {});

  const ivaMonto = Object.values(ivaDesglose).reduce((s, v) => s + v, 0);
  const netoGravado = Math.round((subtotal - ivaMonto) * 100) / 100;
  const total = Math.round(subtotal * 100) / 100;

  const opcionFinActiva = useMemo(() => {
    if (!opcionPagoId) return null;
    for (const m of mediosPago) {
      const o = m.medio_pago_opcion?.find((x) => x.id === opcionPagoId);
      if (o) return { ...o, medioNombre: m.nombre };
    }
    return null;
  }, [opcionPagoId, mediosPago]);

  const totalConFinanciacion = useMemo(() => {
    if (!opcionFinActiva) return total;
    const p = opcionFinActiva.recargo_porcentaje;
    return Math.round((total + (total * p) / 100) * 100) / 100;
  }, [total, opcionFinActiva]);

  async function handleEmitir() {
    if (!clienteId || !tipo || items.length === 0) return;
    setEmitiendo(true);
    setError(null);

    const res = await fetch('/api/facturacion/emitir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo,
        cliente_id: clienteId,
        items: items.map((i) => ({
          producto_id: i.producto.id,
          cantidad: i.cantidad,
          precio_unitario: i.precio_unitario,
        })),
        notas: notas || undefined,
        medio_pago_opcion_id: opcionPagoId || undefined,
      }),
    });

    const json = await res.json();
    setEmitiendo(false);

    if (!res.ok) {
      setError(json.error ?? 'Error al emitir');
      return;
    }

    router.push(`/facturacion/${json.comprobante.id}`);
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl p-6 text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={initialTipo === 'presupuesto' ? '/presupuestos' : '/facturacion'}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          ← Volver
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {tipo === 'presupuesto' ? 'Nuevo presupuesto' : 'Emitir comprobante'}
        </h1>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Cliente *</span>
          <select
            value={clienteId}
            onChange={(e) => handleClienteChange(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Seleccionar cliente…</option>
            {clientes
              .filter((c) => c.id && c.nombre)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.razon_social || c.nombre}
                  {c.condicion_iva
                    ? ` — ${CONDICION_IVA_LABELS[c.condicion_iva] ?? c.condicion_iva}`
                    : ''}
                </option>
              ))}
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Tipo de comprobante *</span>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Seleccionar…</option>
            {Object.entries(TIPO_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="grid gap-1 text-sm">
        <span className="text-muted-foreground">Agregar producto</span>
        <select
          onChange={(e) => {
            agregarItem(e.target.value);
            e.target.value = '';
          }}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">Buscar producto…</option>
          {productos
            .filter((p) => !items.some((i) => i.producto.id === p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.codigo ? `${p.codigo} — ` : ''}
                {p.nombre} ({formatCurrency(p.precio_venta)}) — Stock:{' '}
                {p.stock_actual}
              </option>
            ))}
        </select>
      </label>

      {items.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead className="w-24">Cantidad</TableHead>
                <TableHead className="w-32">Precio</TableHead>
                {esFacturaA && (
                  <>
                    <TableHead className="w-20 text-right">IVA %</TableHead>
                    <TableHead className="w-24 text-right">IVA</TableHead>
                  </>
                )}
                <TableHead className="w-28 text-right">Subtotal</TableHead>
                {showMargen && <TableHead className="w-20 text-right">Costo</TableHead>}
                {showMargen && <TableHead className="w-20 text-right">Margen</TableHead>}
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, i) => {
                const lineaCosto = item.producto.precio_costo * item.cantidad;
                const lineaVenta = item.precio_unitario * item.cantidad;
                const lineaMargenPct = lineaCosto > 0
                  ? ((lineaVenta - lineaCosto) / lineaCosto) * 100
                  : 0;
                const lineaIvaRate = item.producto.iva_porcentaje ?? ivaDefault;
                const lineaIva = esFacturaA
                  ? Math.round(((lineaVenta * lineaIvaRate) / (100 + lineaIvaRate)) * 100) / 100
                  : 0;
                return (
                  <TableRow key={item.producto.id}>
                    <TableCell className="font-medium">
                      {item.producto.nombre}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        value={item.cantidad}
                        onChange={(e) =>
                          actualizarItem(
                            i,
                            'cantidad',
                            parseInt(e.target.value) || 1,
                          )
                        }
                        className="w-20"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={item.precio_unitario}
                        onChange={(e) =>
                          actualizarItem(
                            i,
                            'precio_unitario',
                            parseFloat(e.target.value) || 0,
                          )
                        }
                        className="w-28"
                      />
                    </TableCell>
                    {esFacturaA && (
                      <>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {lineaIvaRate}%
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {formatCurrency(lineaIva)}
                        </TableCell>
                      </>
                    )}
                    <TableCell className="text-right font-mono">
                      {formatCurrency(lineaVenta)}
                    </TableCell>
                    {showMargen && (
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {formatCurrency(lineaCosto)}
                      </TableCell>
                    )}
                    {showMargen && (
                      <TableCell className={cn('text-right font-mono text-xs font-medium', margenColor(lineaMargenPct))}>
                        {lineaMargenPct.toFixed(1)}%
                      </TableCell>
                    )}
                    <TableCell className="text-center">
                      <button
                        type="button"
                        onClick={() => eliminarItem(i)}
                        className="text-destructive hover:text-destructive/80"
                      >
                        ×
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {items.length > 0 ? (() => {
        const costoTotal = items.reduce((s, i) => s + i.producto.precio_costo * i.cantidad, 0);
        const margenTotal = subtotal - costoTotal;
        const margenTotalPct = costoTotal > 0 ? (margenTotal / costoTotal) * 100 : 0;
        return (
          <div className="space-y-1 text-right text-sm">
            {esFacturaA ? (
              <>
                <p>
                  Neto gravado:{' '}
                  <span className="font-mono">{formatCurrency(netoGravado)}</span>
                </p>
                {Object.entries(ivaDesglose)
                  .sort((a, b) => Number(b[0]) - Number(a[0]))
                  .map(([rate, monto]) => (
                    <p key={rate}>
                      IVA {rate}% <span className="text-xs">(incluido)</span>:{' '}
                      <span className="font-mono">{formatCurrency(monto)}</span>
                    </p>
                  ))}
              </>
            ) : (
              <p>
                Subtotal:{' '}
                <span className="font-mono">{formatCurrency(subtotal)}</span>
              </p>
            )}
            <p className="text-lg font-bold">
              Total:{' '}
              <span className="font-mono">{formatCurrency(totalConFinanciacion)}</span>
            </p>
            {opcionFinActiva && Math.abs(totalConFinanciacion - total) > 0.001 ? (
              <p className="text-xs text-muted-foreground">
                Mercadería {formatCurrency(total)} · medio {opcionFinActiva.medioNombre} (
                {opcionFinActiva.recargo_porcentaje >= 0 ? '+' : ''}
                {opcionFinActiva.recargo_porcentaje}%)
              </p>
            ) : null}
            {showMargen && (
              <p className={cn('text-sm font-medium', margenColor(margenTotalPct))}>
                Margen total: {formatCurrency(margenTotal)} ({margenTotalPct.toFixed(1)}%)
              </p>
            )}
          </div>
        );
      })() : null}

      <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
        <p className="text-sm font-medium">Medio de pago (opcional)</p>
        <p className="text-xs text-muted-foreground">
          Si elegís un plan con recargo o descuento, el total se ajusta y, con ARCA, el recargo se informa
          como tributo 99.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Medio</span>
            <select
              value={medioPagoId}
              onChange={(e) => {
                setMedioPagoId(e.target.value);
                setOpcionPagoId('');
              }}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
            >
              <option value="">Sin plan configurado</option>
              {mediosPago.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </label>
          {medioPagoId ? (
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Cuotas / %</span>
              <select
                value={opcionPagoId}
                onChange={(e) => setOpcionPagoId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
              >
                {(mediosPago.find((x) => x.id === medioPagoId)?.medio_pago_opcion ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.cuotas === 1 ? 'Contado' : `${o.cuotas} cuotas`} (
                    {o.recargo_porcentaje >= 0 ? '+' : ''}
                    {o.recargo_porcentaje}%)
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      <label className="grid gap-1 text-sm">
        <span className="text-muted-foreground">
          Notas u observaciones (opcional)
        </span>
        <textarea
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          rows={2}
        />
      </label>

      <Button
        type="button"
        onClick={() => void handleEmitir()}
        disabled={emitiendo || !clienteId || !tipo || items.length === 0}
        className="w-full py-3"
      >
        {emitiendo
          ? 'Emitiendo…'
          : `Emitir ${TIPO_LABELS[tipo] ?? 'comprobante'}`}
      </Button>
    </div>
  );
}
