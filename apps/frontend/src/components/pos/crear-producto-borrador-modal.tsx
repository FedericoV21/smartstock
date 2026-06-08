'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  type ProductoBorradorPos,
  precioVentaDesdeCostoGananciaIva,
} from '@/lib/pos/producto-borrador-pos';
import {
  IVA_PRODUCTO_OPCIONES,
  etiquetaIvaProducto,
  normalizarIvaProductoValor,
  type IvaProductoAlicuota,
} from '@/lib/productos/iva-producto';
import type { Database } from '@/types/database';
import { parsearMontoInputUsuario } from '@/lib/ui/monto-argentino';
import { formatCurrency } from '@/lib/utils/formatters';
type UnidadMedida = Database['public']['Enums']['unidad_medida'];

const UNIDADES: UnidadMedida[] = [
  'unidad',
  'kg',
  'gramo',
  'litro',
  'ml',
  'metro',
  'caja',
  'pack',
];

const ETIQUETA_UNIDAD: Record<UnidadMedida, string> = {
  unidad: 'Unidad',
  kg: 'Kilogramo',
  gramo: 'Gramo',
  litro: 'Litro',
  ml: 'Mililitro',
  metro: 'Metro',
  caja: 'Caja',
  pack: 'Pack',
};
const CREAR_PROVEEDOR_SELECT_VALUE = '__crear_proveedor__';

export type ProveedorOptModal = { id: string; nombre: string };

export interface CrearProductoBorradorModalProps {
  open: boolean;
  codigoEscaneado: string;
  tipoBarcode: 'ean_normal' | 'balanza_peso' | 'desconocido';
  pesoBalanza?: number;
  proveedorActivoId?: string;
  proveedores: ProveedorOptModal[];
  ivaDefaultTenant: number;
  /** Preferencia: centenario cercano (resto hasta $50 hacia abajo, desde $51 hacia arriba; mín. $100). */
  pvpRedondeoCentenasArriba?: boolean;
  pvpRedondeoMenores100ADecenas?: boolean;
  onAgregar: (borrador: ProductoBorradorPos, cantidad: number) => void;
  onClose: () => void;
  onCrearProveedorRapido?: () => void;
}

function ean13CheckDigitOk(code: string): boolean | null {
  const d = code.replace(/\D/g, '');
  if (d.length !== 13) return null;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = parseInt(d[i]!, 10);
    sum += (i % 2 === 0 ? n : n * 3) as number;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === parseInt(d[12]!, 10);
}

export function CrearProductoBorradorModal({
  open,
  codigoEscaneado,
  tipoBarcode,
  pesoBalanza: _pesoBalanza,
  proveedorActivoId,
  proveedores,
  ivaDefaultTenant,
  pvpRedondeoCentenasArriba = false,
  pvpRedondeoMenores100ADecenas = false,
  onAgregar,
  onClose,
  onCrearProveedorRapido,
}: CrearProductoBorradorModalProps) {
  const formId = useId();
  const nombreRef = useRef<HTMLInputElement>(null);

  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [unidad, setUnidad] = useState<UnidadMedida>('unidad');
  const [costo, setCosto] = useState('');
  const [ivaPct, setIvaPct] = useState<IvaProductoAlicuota>(21);
  const [ganancia, setGanancia] = useState('30');
  const [cantidadCarrito, setCantidadCarrito] = useState('1');
  const [masOpen, setMasOpen] = useState(false);
  const [stockInicial, setStockInicial] = useState('0');
  const [stockMinimo, setStockMinimo] = useState('0');
  const [esPesable, setEsPesable] = useState(false);
  const [plu, setPlu] = useState('');
  const [habilitarCajaMixta, setHabilitarCajaMixta] = useState(false);
  const [unidadesPorCaja, setUnidadesPorCaja] = useState('12');

  const forzarPesableBalanza = tipoBarcode === 'balanza_peso';

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setCodigo(codigoEscaneado.trim());
      setNombre('');
      setProveedorId(proveedorActivoId?.trim() || (proveedores[0]?.id ?? ''));
      setUnidad(forzarPesableBalanza ? 'kg' : 'unidad');
      setCosto('');
      setIvaPct(normalizarIvaProductoValor(ivaDefaultTenant) ?? 21);
      setGanancia('30');
      setCantidadCarrito('1');
      setMasOpen(false);
      setStockInicial('0');
      setStockMinimo('0');
      setEsPesable(forzarPesableBalanza);
      setPlu('');
      setHabilitarCajaMixta(false);
      setUnidadesPorCaja('12');
      requestAnimationFrame(() => nombreRef.current?.focus());
    });
  }, [open, codigoEscaneado, proveedorActivoId, proveedores, ivaDefaultTenant, forzarPesableBalanza]);

  const costoNum = parsearMontoInputUsuario(costo) ?? NaN;
  const ganNum = parseFloat(ganancia.replace(',', '.'));
  const precioVenta = useMemo(() => {
    if (!Number.isFinite(costoNum) || costoNum < 0) return 0;
    if (!Number.isFinite(ganNum)) return 0;
    return precioVentaDesdeCostoGananciaIva(
      costoNum,
      ganNum,
      ivaPct,
      ivaDefaultTenant,
      pvpRedondeoCentenasArriba,
      pvpRedondeoMenores100ADecenas,
    );
  }, [costoNum, ganNum, ivaPct, ivaDefaultTenant, pvpRedondeoCentenasArriba, pvpRedondeoMenores100ADecenas]);

  const costoConIva = Number.isFinite(costoNum) && costoNum >= 0 ? costoNum * (1 + ivaPct / 100) : 0;
  const gananciaMonto =
    Number.isFinite(costoConIva) && costoConIva >= 0 && Number.isFinite(ganNum)
      ? costoConIva * (ganNum / 100)
      : 0;

  const eanWarning =
    /^\d{13}$/.test(codigo.trim()) && ean13CheckDigitOk(codigo.trim()) === false
      ? 'El dígito verificador del EAN-13 no coincide (revisá el código).'
      : null;

  const gananciaNegativa = Number.isFinite(ganNum) && ganNum < 0;

  const unidadesPorCajaNum = parseFloat(unidadesPorCaja.replace(',', '.'));
  const usaPresentacionCaja =
    (unidad === 'caja' || unidad === 'pack') &&
    habilitarCajaMixta &&
    Number.isFinite(unidadesPorCajaNum) &&
    unidadesPorCajaNum > 0;
  const precioCajaCalculado = usaPresentacionCaja ? precioVenta * unidadesPorCajaNum : precioVenta;

  const submit = useCallback(() => {
    const cod = codigo.trim();
    const nom = nombre.trim();
    const pid = proveedorId.trim();
    const c0 = parsearMontoInputUsuario(costo) ?? NaN;
    const g0 = parseFloat(ganancia.replace(',', '.'));
    const q0 = parseFloat(cantidadCarrito.replace(',', '.'));
    const si = parseFloat(stockInicial.replace(',', '.')) || 0;
    const sm = parseFloat(stockMinimo.replace(',', '.')) || 0;

    if (!cod || cod.length > 50) return;
    if (!nom || nom.length > 200) return;
    if (!pid) return;
    if (!Number.isFinite(c0) || c0 < 0) return;
    if (normalizarIvaProductoValor(ivaPct) == null) return;
    if (!Number.isFinite(g0)) return;
    if (!Number.isFinite(q0) || q0 <= 0) return;
    if (esPesable && unidad !== 'kg' && unidad !== 'gramo' && unidad !== 'unidad') return;
    if ((unidad === 'caja' || unidad === 'pack') && habilitarCajaMixta) {
      if (!Number.isFinite(unidadesPorCajaNum) || unidadesPorCajaNum <= 0) return;
    }

    const pluDigits = plu.replace(/\D/g, '').slice(0, 5);
    const pluFinal = esPesable && pluDigits ? pluDigits : null;

    const codigoBarrasVal = forzarPesableBalanza || esPesable ? null : cod || null;

    const borrador: ProductoBorradorPos = {
      borrador_id: crypto.randomUUID(),
      codigo_barras: codigoBarrasVal,
      codigo: cod,
      nombre: nom,
      proveedor_id: pid,
      categoria_id: null,
      unidad: forzarPesableBalanza ? 'kg' : unidad,
      precio_costo: c0,
      iva_porcentaje: ivaPct,
      ganancia_pct: g0,
      precio_venta: precioVentaDesdeCostoGananciaIva(
        c0,
        g0,
        ivaPct,
        ivaDefaultTenant,
        pvpRedondeoCentenasArriba,
        pvpRedondeoMenores100ADecenas,
      ),
      stock_inicial: Math.max(0, si),
      stock_minimo: Math.max(0, sm),
      es_pesable: forzarPesableBalanza || esPesable,
      plu: forzarPesableBalanza || esPesable ? pluFinal : null,
      unidad_compra: usaPresentacionCaja ? unidad : null,
      contenido_unidad_compra: usaPresentacionCaja ? unidadesPorCajaNum : null,
    };

    onAgregar(borrador, q0);
    onClose();
  }, [
    cantidadCarrito,
    codigo,
    costo,
    esPesable,
    forzarPesableBalanza,
    ganancia,
    ivaDefaultTenant,
    ivaPct,
    nombre,
    onAgregar,
    onClose,
    plu,
    pvpRedondeoCentenasArriba,
    pvpRedondeoMenores100ADecenas,
    proveedorId,
    stockInicial,
    stockMinimo,
    unidad,
    usaPresentacionCaja,
    unidadesPorCajaNum,
    habilitarCajaMixta,
  ]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[min(90vh,40rem)] w-full max-w-[640px] gap-0 overflow-y-auto p-0">
        <DialogHeader className="border-b px-4 py-3 sm:px-6">
          <DialogTitle>Producto nuevo</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-4 py-4 sm:px-6">
          <div className="rounded-md border border-border/80 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Se va a crear cuando confirmes el cobro. Si cancelás la venta, no se guarda nada en el
            catálogo.
          </div>

          <form
            id={formId}
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="space-y-2">
              <label htmlFor={`${formId}-codigo`} className="text-sm font-medium leading-none">
                Código
              </label>
              <Input
                id={`${formId}-codigo`}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                autoComplete="off"
              />
              {eanWarning ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">{eanWarning}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label htmlFor={`${formId}-nombre`} className="text-sm font-medium leading-none">
                Nombre
              </label>
              <Input
                ref={nombreRef}
                id={`${formId}-nombre`}
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)]">
              <div className="min-w-0 space-y-2">
                <span className="text-sm font-medium leading-none">Proveedor</span>
                <Select
                  value={proveedorId}
                  onValueChange={(v) => {
                    if (v === CREAR_PROVEEDOR_SELECT_VALUE) {
                      onCrearProveedorRapido?.();
                      return;
                    }
                    setProveedorId(v ?? '');
                  }}
                >
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue placeholder="Elegí proveedor">
                      <span className="block truncate">
                        {proveedores.find((p) => p.id === proveedorId)?.nombre ?? 'Elegí proveedor'}
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent
                    className="z-[260] w-[var(--radix-select-trigger-width)] min-w-[var(--radix-select-trigger-width)]"
                    sideOffset={4}
                  >
                    {proveedores.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="block max-w-full truncate pr-6">{p.nombre}</span>
                      </SelectItem>
                    ))}
                    {onCrearProveedorRapido ? (
                      <SelectItem value={CREAR_PROVEEDOR_SELECT_VALUE}>
                        <span className="inline-flex max-w-full items-center gap-2 pr-6">
                          <Plus className="h-4 w-4" />
                          <span className="truncate">Crear proveedor</span>
                        </span>
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 space-y-2">
                <span className="text-sm font-medium leading-none">Unidad</span>
                <Select
                  value={unidad}
                  onValueChange={(v) => setUnidad((v ?? 'unidad') as UnidadMedida)}
                  disabled={forzarPesableBalanza}
                >
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue>
                      <span className="block truncate">{ETIQUETA_UNIDAD[unidad] ?? unidad}</span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {UNIDADES.map((u) => (
                      <SelectItem key={u} value={u}>
                        {ETIQUETA_UNIDAD[u]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {(unidad === 'caja' || unidad === 'pack') && !forzarPesableBalanza ? (
              <div className="space-y-3 rounded-md border bg-muted/20 px-3 py-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border"
                    checked={habilitarCajaMixta}
                    onChange={(e) => setHabilitarCajaMixta(e.target.checked)}
                  />
                  También vender por unidad (además de caja)
                </label>
                {habilitarCajaMixta ? (
                  <>
                    <div className="space-y-2">
                      <label htmlFor={`${formId}-upc`} className="text-sm font-medium leading-none">
                        Unidades por caja
                      </label>
                      <Input
                        id={`${formId}-upc`}
                        type="number"
                        min={1}
                        step="1"
                        value={unidadesPorCaja}
                        onChange={(e) => setUnidadesPorCaja(e.target.value)}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Precio por unidad: <span className="font-medium text-foreground">{formatCurrency(precioVenta)}</span>{' '}
                      · Precio por caja: <span className="font-medium text-foreground">{formatCurrency(precioCajaCalculado)}</span>
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Se venderá solo por caja. Precio caja: <span className="font-medium text-foreground">{formatCurrency(precioCajaCalculado)}</span>
                  </p>
                )}
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor={`${formId}-costo`} className="text-sm font-medium leading-none">
                  Costo neto
                </label>
                <Input
                  id={`${formId}-costo`}
                  type="number"
                  min={0}
                  step="0.01"
                  value={costo}
                  onChange={(e) => setCosto(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <span className="text-sm font-medium leading-none">IVA</span>
                <Select
                  value={String(ivaPct)}
                  onValueChange={(v) => {
                    const next = normalizarIvaProductoValor(v);
                    if (next != null) setIvaPct(next);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>{etiquetaIvaProducto(ivaPct)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {IVA_PRODUCTO_OPCIONES.map((option) => (
                      <SelectItem key={option.selectValue} value={option.selectValue}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label htmlFor={`${formId}-gan`} className="text-sm font-medium leading-none">
                  Ganancia %
                </label>
                <Input
                  id={`${formId}-gan`}
                  type="number"
                  step="0.1"
                  value={ganancia}
                  onChange={(e) => setGanancia(e.target.value)}
                />
                {gananciaNegativa ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Ganancia negativa (liquidación): el precio quedará por debajo del costo + IVA.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <div className="font-medium text-foreground/90">Precio de venta calculado</div>
              <div className="mt-1 grid gap-1 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Costo + IVA</span>
                  <span className="tabular-nums text-foreground">{formatCurrency(costoConIva)}</span>
                </div>
                <div className="flex justify-between">
                  <span>+ {Number.isFinite(ganNum) ? ganNum : 0}% de ganancia</span>
                  <span className="tabular-nums text-foreground">
                    {formatCurrency(gananciaMonto)}
                  </span>
                </div>
                <div className="flex justify-between border-t pt-1 font-medium text-foreground">
                  <span>Precio final</span>
                  <span className="tabular-nums">{formatCurrency(precioVenta)}</span>
                </div>
                {(unidad === 'caja' || unidad === 'pack') && (
                  <div className="flex justify-between">
                    <span>{habilitarCajaMixta ? 'Precio por caja' : 'Precio caja'}</span>
                    <span className="tabular-nums text-foreground">{formatCurrency(precioCajaCalculado)}</span>
                  </div>
                )}
              </div>
            </div>

            <details className="rounded-md border" open={masOpen} onToggle={(e) => setMasOpen(e.currentTarget.open)}>
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                Más datos (opcional)
              </summary>
              <div className="space-y-3 border-t px-3 py-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor={`${formId}-si`} className="text-sm font-medium leading-none">
                      Stock inicial
                    </label>
                    <Input
                      id={`${formId}-si`}
                      type="number"
                      min={0}
                      step="0.001"
                      value={stockInicial}
                      onChange={(e) => setStockInicial(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`${formId}-sm`} className="text-sm font-medium leading-none">
                      Stock mínimo
                    </label>
                    <Input
                      id={`${formId}-sm`}
                      type="number"
                      min={0}
                      step="1"
                      value={stockMinimo}
                      onChange={(e) => setStockMinimo(e.target.value)}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border"
                    checked={forzarPesableBalanza || esPesable}
                    disabled={forzarPesableBalanza}
                  onChange={(e) => {
                    setEsPesable(e.target.checked);
                    if (e.target.checked) {
                        setUnidad((u) =>
                          u === 'unidad' || u === 'gramo' || u === 'kg' ? u : 'kg',
                        );
                      }
                    }}
                  />
                  Usa PLU / balanza
                </label>
                {(forzarPesableBalanza || esPesable) && (
                  <div className="space-y-2">
                    <label htmlFor={`${formId}-plu`} className="text-sm font-medium leading-none">
                      PLU (1–5 dígitos)
                    </label>
                    <Input
                      id={`${formId}-plu`}
                      inputMode="numeric"
                      value={plu}
                      onChange={(e) => setPlu(e.target.value.replace(/\D/g, '').slice(0, 5))}
                      placeholder="p. ej. 1234"
                    />
                  </div>
                )}
              </div>
            </details>

            <div className="space-y-2">
              <label htmlFor={`${formId}-cant`} className="text-sm font-medium leading-none">
                Cantidad en el carrito
              </label>
              <Input
                id={`${formId}-cant`}
                type="number"
                min={0.001}
                step="0.001"
                value={cantidadCarrito}
                onChange={(e) => setCantidadCarrito(e.target.value)}
              />
            </div>
          </form>
        </div>

        <DialogFooter className="border-t px-4 py-3 sm:px-6">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={
              !codigo.trim() ||
              !nombre.trim() ||
              !proveedorId ||
              !Number.isFinite(costoNum) ||
              costoNum < 0 ||
              ((unidad === 'caja' || unidad === 'pack') &&
                habilitarCajaMixta &&
                (!Number.isFinite(unidadesPorCajaNum) || unidadesPorCajaNum <= 0)) ||
              !Number.isFinite(parseFloat(cantidadCarrito)) ||
              parseFloat(cantidadCarrito) <= 0
            }
          >
            Agregar al carrito
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
