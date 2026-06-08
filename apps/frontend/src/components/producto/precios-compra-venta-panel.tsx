'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { round2 } from '@/lib/analizador/descuento-proveedor';
import {
  calcularPrecioVenta,
  clampGananciaPct,
  GANANCIA_PCT_MAX,
  GANANCIA_PCT_MIN,
  gananciaPorcentajeDesdeCostoYPvpConIva,
} from '@/lib/productos/calcular-precio-venta';
import { debugGananciaTramos } from '@/lib/productos/debug-ganancia-tramos-logs';
import {
  IVA_PRODUCTO_DEFAULT_SELECT_VALUE,
  IVA_PRODUCTO_OPCIONES,
  etiquetaIvaProducto,
  normalizarIvaProductoValor,
} from '@/lib/productos/iva-producto';
import { parsearMontoInputUsuario } from '@/lib/ui/monto-argentino';
import { formatCurrency } from '@/lib/utils/formatters';
import type { Database } from '@/types/database';

type Unidad = Database['public']['Enums']['unidad_medida'];

const UNIDADES: Unidad[] = [
  'unidad',
  'kg',
  'litro',
  'metro',
  'caja',
  'pack',
  'gramo',
  'ml',
];

function capU(u: string) {
  if (!u) return u;
  return u.charAt(0).toUpperCase() + u.slice(1);
}

function nombreUnidadEs(u: string): string {
  const x = (u ?? '').toLowerCase();
  if (!x) return 'unidad';
  if (x === 'kg') return 'kilo';
  if (x === 'ml') return 'mililitro';
  return x;
}

function nombreUnidadEsPlural(u: string): string {
  const x = (u ?? '').toLowerCase();
  if (!x) return 'unidades';
  if (x === 'kg') return 'kilos';
  if (x === 'ml') return 'mililitros';
  if (x === 'unidad') return 'unidades';
  if (x.endsWith('s')) return x;
  return `${x}s`;
}

function articuloInterrogativoPlural(u: string): 'Cuántas' | 'Cuántos' {
  const x = (u ?? '').toLowerCase();
  if (x === 'unidad' || x === 'caja') return 'Cuántas';
  return 'Cuántos';
}

function parseNum(s: string): number {
  const n = parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

/** Montos en pesos (costo, PVP); no usar para % ni cantidades. */
function parseMontoPrecio(s: string): number {
  const n = parsearMontoInputUsuario(s);
  return n !== null && Number.isFinite(n) ? n : NaN;
}

function clampGananciaInputStr(raw: string): string {
  const t = raw.trim();
  if (t === '') return '';
  const n = parseNum(t);
  if (!Number.isFinite(n)) return raw;
  if (n < GANANCIA_PCT_MIN) return String(GANANCIA_PCT_MIN);
  if (n > GANANCIA_PCT_MAX) return String(GANANCIA_PCT_MAX);
  return raw;
}

function uid() {
  return `f-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function cantidadKey(cantidad: number): string {
  return String(Math.round(cantidad * 1000) / 1000);
}

/** Cómo cargás la compra al proveedor (lo que persiste en BD es costo por unidad de stock ± envase). */
export type TipoCompraPrecio = 'unidad' | 'peso' | 'envase';

export type PreciosCompraVentaPanelProps = {
  /** Si se pasa, habilita cargar/guardar ganancias por tramos en BD. */
  productoId?: string;
  ivaDefault: number;
  tipoCompra: TipoCompraPrecio;
  setTipoCompra: (t: TipoCompraPrecio) => void;
  mostrarSelectorUnidadStock: boolean;
  unidad: Unidad;
  setUnidad: (u: Unidad) => void;
  esPesable: boolean;
  presentacionUnidadCompra: Unidad | '';
  setPresentacionUnidadCompra: (v: Unidad | '') => void;
  presentacionContenido: string;
  setPresentacionContenido: (v: string) => void;
  precioCosto: string;
  setPrecioCosto: (v: string) => void;
  precioVenta: string;
  descuentoCostoPct: string;
  setDescuentoCostoPct: (v: string) => void;
  porcentajeGanancia: string;
  setPorcentajeGanancia: (v: string) => void;
  ivaPorcentaje: string;
  setIvaPorcentaje: (v: string) => void;
  moneda: string;
  setMoneda: (v: string) => void;
  slotExtras?: ReactNode;
};

type SimRowKind = 'base' | 'envase' | 'pack_extra';

type SimRow = {
  key: string;
  kind: SimRowKind;
  /** etiqueta para la tabla */
  etiqueta: string;
  /** multiplicador sobre costo/PVP por unidad de stock */
  mult: number;
};

type ExtraPackRow = { id: string; cantidad: string };

/** Token en el orden del simulador (después de la fila base): envase o id de pack extra. */
const SIM_ROW_ENVASE = '__envase__';

export function PreciosCompraVentaPanel({
  productoId,
  ivaDefault,
  tipoCompra,
  setTipoCompra,
  mostrarSelectorUnidadStock,
  unidad,
  setUnidad,
  esPesable,
  presentacionUnidadCompra,
  setPresentacionUnidadCompra,
  presentacionContenido,
  setPresentacionContenido,
  precioCosto,
  setPrecioCosto,
  precioVenta: _precioVenta,
  descuentoCostoPct,
  setDescuentoCostoPct,
  porcentajeGanancia,
  setPorcentajeGanancia,
  ivaPorcentaje,
  setIvaPorcentaje,
  moneda,
  setMoneda,
  slotExtras,
}: PreciosCompraVentaPanelProps) {
  const inventarioEsPeso = unidad === 'kg' || unidad === 'gramo';

  useEffect(() => {
    if (!inventarioEsPeso && tipoCompra === 'peso') {
      setTipoCompra('unidad');
    }
  }, [inventarioEsPeso, tipoCompra, setTipoCompra]);

  useEffect(() => {
    if (tipoCompra === 'envase' && !presentacionUnidadCompra) {
      setPresentacionUnidadCompra('caja');
    }
  }, [tipoCompra, presentacionUnidadCompra, setPresentacionUnidadCompra]);

  const contenidoNum = useMemo(() => {
    const c = parseFloat(String(presentacionContenido).replace(',', '.'));
    return Number.isFinite(c) && c > 0 ? c : 0;
  }, [presentacionContenido]);

  const costoU = parseMontoPrecio(precioCosto);
  const descuentoParsed = descuentoCostoPct === '' ? 0 : parseNum(descuentoCostoPct);
  const descuentoCostoVal = Number.isFinite(descuentoParsed)
    ? Math.min(100, Math.max(0, descuentoParsed))
    : 0;
  const costoBaseVentaU =
    Number.isFinite(costoU) && costoU > 0 ? round2(costoU * (1 - descuentoCostoVal / 100)) : NaN;
  const gananciaParsed = porcentajeGanancia === '' ? 0 : parseNum(porcentajeGanancia);
  const gananciaVal = Number.isFinite(gananciaParsed) ? gananciaParsed : 0;
  const ivaParaCalc =
    ivaPorcentaje.trim() === ''
      ? null
      : (() => {
          const x = parseFloat(ivaPorcentaje.replace(',', '.'));
          return Number.isFinite(x) ? x : null;
        })();

  const [extraPacks, setExtraPacks] = useState<ExtraPackRow[]>([]);
  /** Fila pack extra con UI de edición de cantidad abierta (`null` = ninguna). */
  const [packExtraEditingId, setPackExtraEditingId] = useState<string | null>(null);
  /** Orden visual de filas entre base y el resto: `SIM_ROW_ENVASE` y/o ids de `extraPacks`. */
  const [simMiddleOrder, setSimMiddleOrder] = useState<string[]>([]);
  const [gananciaPorFila, setGananciaPorFila] = useState<Record<string, string>>({});
  const [precioVentaUnidadPorFila, setPrecioVentaUnidadPorFila] = useState<Record<string, string>>({});
  /** Tramos devueltos por GET; `null` = aún no cargó para este `productoId`. */
  const [tramosServidor, setTramosServidor] = useState<
    { cantidad_desde: number; ganancia_pct: number; orden?: number }[] | null
  >(null);
  const [tramosSaving, setTramosSaving] = useState(false);
  const [tramosMsg, setTramosMsg] = useState<string | null>(null);
  /** Evita el ciclo valor derivado → onChange → precioCosto → valor que borra lo que se está escribiendo. */
  const [precioPorEnvaseTexto, setPrecioPorEnvaseTexto] = useState('');
  const [precioPorEnvaseFocused, setPrecioPorEnvaseFocused] = useState(false);
  const [simGananciaAviso, setSimGananciaAviso] = useState<string | null>(null);
  const ivaAplicadoPct = ivaParaCalc ?? ivaDefault;
  const ivaNormalizado = normalizarIvaProductoValor(ivaPorcentaje);
  const ivaEsValorViejoNoPermitido =
    ivaPorcentaje.trim() !== '' && ivaNormalizado == null;
  const ivaSelectValue =
    ivaPorcentaje.trim() === ''
      ? IVA_PRODUCTO_DEFAULT_SELECT_VALUE
      : ivaNormalizado != null
        ? String(ivaNormalizado)
        : ivaPorcentaje;

  const tieneEnvase =
    tipoCompra === 'envase' && presentacionUnidadCompra !== '' && contenidoNum > 0;

  // Cargar tramos existentes desde el servidor (si hay productoId).
  useEffect(() => {
    if (!productoId) {
      setTramosServidor(null);
      setExtraPacks([]);
      setSimMiddleOrder([]);
      setPackExtraEditingId(null);
      setPrecioVentaUnidadPorFila({});
      return;
    }
    let cancelled = false;
    setTramosMsg(null);
    setTramosServidor(null);
    setExtraPacks([]);
    setSimMiddleOrder([]);
    setPackExtraEditingId(null);
    setPrecioVentaUnidadPorFila({});
    void fetch(`/api/productos/${encodeURIComponent(productoId)}/ganancia-tramos`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(
        ({
          ok,
          j,
        }: {
          ok: boolean;
          j: { tramos?: { cantidad_desde: number; ganancia_pct: number; orden?: number }[]; error?: string };
        }) => {
        if (cancelled) return;
        if (!ok) {
          debugGananciaTramos('panel GET tramos respuesta no ok', {
            productoId,
            error: typeof j?.error === 'string' ? j.error : '(sin mensaje)',
          });
          setTramosServidor([]);
          return;
        }
        const list = j.tramos ?? [];
        const map: Record<string, string> = {};
        for (const t of list) {
          const c = Number(t.cantidad_desde);
          const g = Number(t.ganancia_pct);
          if (!Number.isFinite(c) || c <= 0) continue;
          if (!Number.isFinite(g) || g < 0) continue;
          map[cantidadKey(c)] = String(g);
        }
        debugGananciaTramos('panel GET tramos aplicado al estado', {
          productoId,
          desde_api: list,
          keys_en_map: Object.keys(map),
        });
        setGananciaPorFila((prev) => ({ ...prev, ...map }));
        setTramosServidor(list);
      })
      .catch(() => {
        /* silencioso */
      });
    return () => {
      cancelled = true;
    };
  }, [productoId]);

  // Reconstruir packs y orden visual desde el servidor (`orden` en BD; GET ya ordena).
  useEffect(() => {
    if (tramosServidor === null) return;
    if (tramosServidor.length === 0) {
      setExtraPacks([]);
      setSimMiddleOrder(tieneEnvase ? [SIM_ROW_ENVASE] : []);
      setPackExtraEditingId(null);
      return;
    }
    const envKey =
      tieneEnvase && contenidoNum > 0
        ? cantidadKey(contenidoNum)
        : null;

    const sorted = [...tramosServidor].sort((a, b) => {
      const oa = a.orden ?? 0;
      const ob = b.orden ?? 0;
      if (oa !== ob) return oa - ob;
      return Number(a.cantidad_desde) - Number(b.cantidad_desde);
    });

    const middle: string[] = [];
    const packs: ExtraPackRow[] = [];
    for (const t of sorted) {
      const cd = Number(t.cantidad_desde);
      if (!Number.isFinite(cd) || cd <= 0) continue;
      const k = cantidadKey(cd);
      if (k === '1') continue;
      if (envKey != null && k === envKey) {
        if (!middle.includes(SIM_ROW_ENVASE)) middle.push(SIM_ROW_ENVASE);
      } else {
        const id = uid();
        packs.push({ id, cantidad: k });
        middle.push(id);
      }
    }
    setExtraPacks(packs);
    setPackExtraEditingId(null);
    setSimMiddleOrder(middle);
    debugGananciaTramos('panel extraPacks rehidratados', {
      envKey,
      packs: packs.map((p) => p.cantidad),
      simMiddleOrder: middle,
    });
  }, [tramosServidor, tieneEnvase, contenidoNum]);

  useEffect(() => {
    if (!tieneEnvase) {
      setSimMiddleOrder((o) => o.filter((t) => t !== SIM_ROW_ENVASE));
      return;
    }
    setSimMiddleOrder((o) => (o.includes(SIM_ROW_ENVASE) ? o : [SIM_ROW_ENVASE, ...o]));
  }, [tieneEnvase]);

  useEffect(() => {
    if (tipoCompra !== 'envase' || precioPorEnvaseFocused) return;
    if (contenidoNum > 0 && Number.isFinite(costoU)) {
      setPrecioPorEnvaseTexto(String(round2(costoU * contenidoNum)));
    } else {
      setPrecioPorEnvaseTexto('');
    }
  }, [tipoCompra, contenidoNum, costoU, precioPorEnvaseFocused]);

  function gananciaParaCantidad(cantidad: number): number {
    const key = cantidadKey(cantidad);
    const raw = gananciaPorFila[key];
    if (raw != null && raw.trim() !== '') {
      const n = parseNum(raw);
      if (Number.isFinite(n)) return n;
    }
    return gananciaVal;
  }

  const pvpSugeridoConGanancia = (mult: number, gananciaPct: number) => {
    if (!Number.isFinite(costoU) || costoU <= 0) return null;
    const c = round2(costoU * mult);
    const v = calcularPrecioVenta(c, gananciaPct, ivaParaCalc, ivaDefault, {
      descuentoCostoPct: descuentoCostoVal,
    });
    return round2(v);
  };

  function aplicarPrecioUnitarioVenta(cantidad: number, rawPrecioUnidad: string, kind: SimRowKind): void {
    if (!(cantidad > 0) || !Number.isFinite(costoU) || costoU <= 0) return;

    const precioUnidad = parseMontoPrecio(rawPrecioUnidad);
    if (!Number.isFinite(precioUnidad) || precioUnidad <= 0) return;

    const pctCalculado = gananciaPorcentajeDesdeCostoYPvpConIva(
      costoU,
      precioUnidad,
      ivaParaCalc,
      ivaDefault,
      { descuentoCostoPct: descuentoCostoVal },
    );
    const pct = clampGananciaPct(pctCalculado);
    const val = String(pct);
    const k = cantidadKey(cantidad);
    setGananciaPorFila((prev) => ({ ...prev, [k]: val }));
    if (kind === 'base') {
      setPorcentajeGanancia(val);
    }

    const pvpResultante = calcularPrecioVenta(costoU, pct, ivaParaCalc, ivaDefault, {
      descuentoCostoPct: descuentoCostoVal,
    });

    if (pctCalculado > GANANCIA_PCT_MAX) {
      setSimGananciaAviso(
        `Con costo ${formatCurrency(round2(costoU))} y ganancia máxima (${GANANCIA_PCT_MAX}%), el PVP unitario no puede superar ${formatCurrency(pvpResultante)}. El precio que pediste (${formatCurrency(precioUnidad)}) implicaba ${pctCalculado.toFixed(2)}% de ganancia.`,
      );
    } else if (pctCalculado < GANANCIA_PCT_MIN) {
      const pvpMinimo = calcularPrecioVenta(costoU, GANANCIA_PCT_MIN, ivaParaCalc, ivaDefault, {
        descuentoCostoPct: descuentoCostoVal,
      });
      setSimGananciaAviso(
        `Con costo ${formatCurrency(round2(costoU))}, el PVP unitario no puede ser menor a ${formatCurrency(pvpMinimo)} (ganancia mínima ${GANANCIA_PCT_MIN}%). Pediste ${formatCurrency(precioUnidad)} (${pctCalculado.toFixed(2)}% de ganancia).`,
      );
    } else if (Math.abs(pvpResultante - precioUnidad) > 0.05) {
      setSimGananciaAviso(
        `El PVP quedó en ${formatCurrency(pvpResultante)} (ganancia ${pct}%) por redondeo comercial; pediste ${formatCurrency(precioUnidad)}.`,
      );
    } else {
      setSimGananciaAviso(null);
    }
  }

  // Asegurar keys para las filas “base” y “envase” (por cantidad desde).
  useEffect(() => {
    setGananciaPorFila((prev) => {
      const next = { ...prev };
      // Base: cantidad 1
      if (next['1'] == null) next['1'] = porcentajeGanancia;
      // Envase: cantidad = contenidoNum
      if (tieneEnvase && contenidoNum > 0) {
        const k = cantidadKey(contenidoNum);
        if (next[k] == null) next[k] = '';
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tieneEnvase, contenidoNum]);

  const filasSimulador: SimRow[] = useMemo(() => {
    const base: SimRow = {
      key: 'base',
      kind: 'base',
      etiqueta: inventarioEsPeso
        ? `Por 1 ${capU(unidad)} (precio × peso en balanza)`
        : `Por 1 ${capU(unidad)} de inventario`,
      mult: 1,
    };
    const out: SimRow[] = [base];
    const packById = new Map(extraPacks.map((p) => [p.id, p]));
    for (const token of simMiddleOrder) {
      if (token === SIM_ROW_ENVASE) {
        if (!(tieneEnvase && presentacionUnidadCompra)) continue;
        out.push({
          key: 'envase',
          kind: 'envase',
          etiqueta: `Por 1 ${capU(presentacionUnidadCompra)} (${contenidoNum} ${unidad})`,
          mult: contenidoNum,
        });
        continue;
      }
      const ep = packById.get(token);
      if (!ep) continue;
      const n = parseNum(ep.cantidad);
      const mult = Number.isFinite(n) && n > 0 ? n : 0;
      out.push({
        key: ep.id,
        kind: 'pack_extra',
        etiqueta: mult > 0 ? `Desde ${mult} ${unidad}` : `Pack (${unidad})`,
        mult,
      });
    }
    return out;
  }, [
    contenidoNum,
    tieneEnvase,
    inventarioEsPeso,
    presentacionUnidadCompra,
    unidad,
    extraPacks,
    simMiddleOrder,
  ]);

  function reorderSimMiddleRows(fromToken: string, toToken: string) {
    if (fromToken === toToken) return;
    setSimMiddleOrder((order) => {
      const i = order.indexOf(fromToken);
      const j = order.indexOf(toToken);
      if (i < 0 || j < 0) return order;
      const next = [...order];
      next.splice(i, 1);
      next.splice(j, 0, fromToken);
      return next;
    });
  }

  function cambiarTipo(t: TipoCompraPrecio) {
    setTipoCompra(t);
    setPrecioPorEnvaseFocused(false);
    if (t !== 'envase') {
      setPresentacionUnidadCompra('');
      setPresentacionContenido('');
      setPrecioPorEnvaseTexto('');
    }
    if (t === 'envase' && !presentacionUnidadCompra) {
      setPresentacionUnidadCompra('caja');
    }
  }

  const unidadStockNom = nombreUnidadEs(unidad);
  const unidadStockPlural = nombreUnidadEsPlural(unidad);
  const interrogativoStockPlural = articuloInterrogativoPlural(unidad);
  const unidadCobroRaw = presentacionUnidadCompra ? presentacionUnidadCompra : 'presentacion';
  const unidadCobro = capU(nombreUnidadEs(unidadCobroRaw));
  const preguntaContenido = presentacionUnidadCompra
    ? `¿${interrogativoStockPlural} ${unidadStockPlural} de inventario equivale a 1 ${unidadCobro}?`
    : `¿${interrogativoStockPlural} ${unidadStockPlural} de inventario equivale a 1 presentación?`;
  const ayudaContenido = presentacionUnidadCompra
    ? `Ejemplo: si comprás por ${unidadCobro.toLowerCase()} y cada ${unidadCobro.toLowerCase()} trae 500 ${unidadStockPlural}, cargá 500.`
    : 'Elegí primero cómo te cobran (caja, kg, pack, etc.).';
  const preguntaPrecioEnvase = presentacionUnidadCompra
    ? `¿Cuánto te cobran por 1 ${unidadCobro.toLowerCase()}?`
    : '¿Cuánto te cobran por 1 presentación?';

  return (
    <div className="space-y-5">
      {mostrarSelectorUnidadStock ? (
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-foreground">¿En qué medís el inventario?</span>
          <span className="text-xs text-muted-foreground">
            Todo se guarda como precio por 1 unidad de esta medida (clavo, kg, litro…).
          </span>
          <Select value={unidad} onValueChange={(v) => v && setUnidad(v as Unidad)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNIDADES.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      ) : esPesable ? (
        <p className="text-xs text-muted-foreground rounded-lg border bg-muted/30 px-3 py-2">
          {unidad === 'unidad'
            ? 'Precio por unidad; la balanza puede enviar la cantidad por PLU.'
            : 'Precios por kg o gramo según configurás abajo en balanza.'}
        </p>
      ) : null}

      {/* Compra */}
      <div className="rounded-xl border bg-muted/15 p-4 space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Cuánto pagás al proveedor
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Elegí cómo te facturan y cargá el precio que pagás por eso.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={tipoCompra === 'unidad' ? 'default' : 'outline'}
            className="rounded-full"
            onClick={() => cambiarTipo('unidad')}
          >
            Por unidad de inventario
          </Button>
          {inventarioEsPeso ? (
            <Button
              type="button"
              size="sm"
              variant={tipoCompra === 'peso' ? 'default' : 'outline'}
              className="rounded-full"
              onClick={() => cambiarTipo('peso')}
            >
              Por peso ({capU(unidad)})
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={tipoCompra === 'envase' ? 'default' : 'outline'}
            className="rounded-full"
            onClick={() => cambiarTipo('envase')}
          >
            Por caja / pack / bolsa
          </Button>
        </div>

        {(tipoCompra === 'unidad' || tipoCompra === 'peso') && (
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">
              {tipoCompra === 'peso'
                ? `¿Cuánto te cobran por 1 ${unidadStockNom}?`
                : `¿Cuánto te cobran por 1 ${unidadStockNom} de inventario?`}
            </span>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={precioCosto}
              onChange={(e) => setPrecioCosto(e.target.value)}
            />
          </label>
        )}

        {tipoCompra === 'envase' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Te cobran por</span>
              <Select
                value={presentacionUnidadCompra || '__none__'}
                onValueChange={(v) =>
                  setPresentacionUnidadCompra(v === '__none__' ? '' : (v as Unidad))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Tipo de envase" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {UNIDADES.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">{preguntaContenido}</span>
              <Input
                type="number"
                step="any"
                min="0"
                value={presentacionContenido}
                onChange={(e) => setPresentacionContenido(e.target.value)}
                placeholder="Ej: 500"
              />
              <span className="text-xs text-muted-foreground">{ayudaContenido}</span>
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span className="text-muted-foreground">{preguntaPrecioEnvase}</span>
              <Input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={precioPorEnvaseTexto}
                onFocus={() => setPrecioPorEnvaseFocused(true)}
                onBlur={() => {
                  const raw = precioPorEnvaseTexto;
                  const v = parseMontoPrecio(raw);
                  if (Number.isFinite(v) && v >= 0 && contenidoNum > 0) {
                    setPrecioCosto(String(round2(v / contenidoNum)));
                    setPrecioPorEnvaseTexto(String(round2(v)));
                  } else if (raw.trim() === '') {
                    setPrecioCosto('');
                  }
                  // Sin esto el useEffect sync ve focused=false antes y pisa lo que escribimos (p.ej. al poner '.').
                  queueMicrotask(() => setPrecioPorEnvaseFocused(false));
                }}
                onChange={(e) => setPrecioPorEnvaseTexto(e.target.value)}
                placeholder={
                  contenidoNum <= 0 ? 'Primero completa la equivalencia de arriba' : undefined
                }
                disabled={contenidoNum <= 0}
              />
              <span className="text-xs text-muted-foreground">
                Costo guardado por 1 {unidadStockNom} de stock:{' '}
                <span className="tabular-nums font-medium text-foreground">
                  {Number.isFinite(costoU) ? formatCurrency(round2(costoU)) : '—'}
                </span>
              </span>
            </label>
          </div>
        )}
      </div>

      {/* Margen */}
      <div className="rounded-xl border bg-muted/10 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Ganancia habitual (% sobre costo descontado, antes de IVA en la cuenta)
        </p>
        <div className="grid gap-4 sm:grid-cols-4">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Desc. costo %</span>
            <Input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={descuentoCostoPct}
              onChange={(e) => setDescuentoCostoPct(e.target.value)}
              placeholder="Opcional"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Ganancia %</span>
            <Input
              type="number"
              step="0.01"
              min={GANANCIA_PCT_MIN}
              max={GANANCIA_PCT_MAX}
              value={porcentajeGanancia}
              onChange={(e) => {
                setSimGananciaAviso(null);
                setPorcentajeGanancia(e.target.value);
              }}
              onBlur={(e) => {
                const next = clampGananciaInputStr(e.target.value);
                if (next !== e.target.value) setPorcentajeGanancia(next);
              }}
              placeholder="Ej: 35"
            />
            <span className="text-[11px] text-muted-foreground">
              Entre {GANANCIA_PCT_MIN}% y {GANANCIA_PCT_MAX}%
            </span>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">IVA %</span>
            <Select
              value={ivaSelectValue}
              onValueChange={(value) => {
                const next = value ?? '';
                setIvaPorcentaje(
                  next === IVA_PRODUCTO_DEFAULT_SELECT_VALUE ? '' : next,
                );
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={IVA_PRODUCTO_DEFAULT_SELECT_VALUE}>
                  Predeterminado ({etiquetaIvaProducto(ivaDefault)})
                </SelectItem>
                {ivaEsValorViejoNoPermitido ? (
                  <SelectItem value={ivaPorcentaje} disabled>
                    Valor actual {ivaPorcentaje}% (no permitido)
                  </SelectItem>
                ) : null}
                {IVA_PRODUCTO_OPCIONES.map((option) => (
                  <SelectItem key={option.selectValue} value={option.selectValue}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Moneda símbolo</span>
            <Input value={moneda} onChange={(e) => setMoneda(e.target.value)} placeholder="$" />
          </label>
        </div>
        {descuentoCostoVal > 0 && Number.isFinite(costoBaseVentaU) ? (
          <p className="text-xs text-muted-foreground">
            Costo base para venta:{' '}
            <span className="font-medium text-foreground tabular-nums">
              {formatCurrency(costoBaseVentaU)}
            </span>{' '}
            (el costo guardado sigue siendo {formatCurrency(round2(costoU))}).
          </p>
        ) : null}
      </div>

      {slotExtras}

      {/* Simulador ventas */}
      <div className="min-w-0 rounded-xl border p-4 space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Cómo lo vas a vender (simulador)
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            El campo <span className="font-medium text-foreground">PVP con IVA</span> es lo que paga el
            cliente (precio final). Al editarlo se calcula la ganancia; las columnas de la derecha son el
            desglose. El precio que se guarda en el producto es el de la primera fila (por 1{' '}
            {capU(unidad)} de inventario).
          </p>
        </div>

        <div className="max-w-full overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto overscroll-x-contain">
          <Table className="w-full min-w-[36rem] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[28%]">Forma de cobro</TableHead>
                <TableHead className="w-[12%] text-right">Ganancia %</TableHead>
                <TableHead className="w-[14%] text-right">PVP con IVA</TableHead>
                <TableHead className="w-[12%] text-right">Costo ref.</TableHead>
                <TableHead className="w-[12%] text-right">Neto sin IVA</TableHead>
                <TableHead className="w-[11%] text-right">IVA ({ivaAplicadoPct}%)</TableHead>
                <TableHead className="w-[11%] text-right">Total línea</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filasSimulador.map((row) => {
                const multEff = row.mult > 0 ? row.mult : 0;
                const cantidadBase = multEff > 0 ? multEff : 0;
                const cantidadKeyFila = cantidadBase > 0 ? cantidadKey(cantidadBase) : null;
                const gananciaPctFila = cantidadBase > 0 ? gananciaParaCantidad(cantidadBase) : gananciaVal;
                const costoLinea =
                  multEff > 0 && Number.isFinite(costoU) && costoU >= 0
                    ? round2(costoU * multEff)
                    : null;
                const finalConIvaFromGanancia =
                  multEff > 0 ? pvpSugeridoConGanancia(multEff, gananciaPctFila) : null;
                const precioUnitFromInput =
                  cantidadKeyFila != null && precioVentaUnidadPorFila[cantidadKeyFila] != null
                    ? parseMontoPrecio(precioVentaUnidadPorFila[cantidadKeyFila])
                    : NaN;
                const precioUnitConIva =
                  Number.isFinite(precioUnitFromInput) && precioUnitFromInput > 0
                    ? round2(precioUnitFromInput)
                    : finalConIvaFromGanancia != null && multEff > 0
                      ? round2(finalConIvaFromGanancia / multEff)
                      : null;
                const finalConIva =
                  precioUnitConIva != null && multEff > 0
                    ? round2(precioUnitConIva * multEff)
                    : null;
                const divisorIva = 1 + ivaAplicadoPct / 100;
                const sinIva =
                  finalConIva != null && divisorIva > 0 ? round2(finalConIva / divisorIva) : null;
                const montoIva =
                  finalConIva != null && sinIva != null ? round2(finalConIva - sinIva) : null;
                const precioUnitarioInputValue =
                  cantidadKeyFila != null && precioVentaUnidadPorFila[cantidadKeyFila] != null
                    ? precioVentaUnidadPorFila[cantidadKeyFila]
                    : precioUnitConIva != null
                      ? String(precioUnitConIva)
                      : '';

                const dragToken =
                  row.kind === 'envase'
                    ? SIM_ROW_ENVASE
                    : row.kind === 'pack_extra'
                      ? row.key
                      : null;
                const rowDraggable = dragToken != null;

                return (
                  <TableRow
                    key={row.key}
                    className={rowDraggable ? 'group/row' : undefined}
                    onDragOver={
                      rowDraggable
                        ? (e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                          }
                        : undefined
                    }
                    onDrop={
                      rowDraggable && dragToken
                        ? (e) => {
                            e.preventDefault();
                            const from = e.dataTransfer.getData('text/plain');
                            if (from) reorderSimMiddleRows(from, dragToken);
                          }
                        : undefined
                    }
                  >
                    <TableCell className="max-w-0 truncate text-sm">
                      <div className="flex min-w-0 flex-nowrap items-center gap-1.5">
                        {rowDraggable ? (
                          <span
                            className="inline-flex h-8 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded border border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground active:cursor-grabbing"
                            draggable
                            title="Arrastrar para reordenar"
                            aria-label="Arrastrar fila"
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', dragToken!);
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                          >
                            <GripVertical className="size-3.5" aria-hidden />
                          </span>
                        ) : null}
                        {row.kind === 'pack_extra' ? (() => {
                          const ep = extraPacks.find((x) => x.id === row.key);
                          const n = ep ? parseNum(ep.cantidad) : NaN;
                          const hasQty = Number.isFinite(n) && n > 0;
                          const editing = !hasQty || packExtraEditingId === row.key;
                          const cantidadVal = ep?.cantidad ?? '';

                          if (!editing) {
                            return (
                              <>
                                <span className="min-w-0 shrink truncate" title={row.etiqueta}>
                                  {row.etiqueta}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="ms-auto h-8 w-8 shrink-0 text-muted-foreground opacity-80 hover:text-foreground hover:opacity-100 focus-visible:opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100"
                                  aria-label="Editar cantidad del tramo"
                                  title="Editar cantidad"
                                  onClick={() => setPackExtraEditingId(row.key)}
                                >
                                  <Pencil className="size-3.5" aria-hidden />
                                </Button>
                              </>
                            );
                          }

                          return (
                            <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1">
                              {!hasQty ? (
                                <span
                                  className="min-w-0 shrink truncate text-muted-foreground"
                                  title={row.etiqueta}
                                >
                                  {row.etiqueta}
                                </span>
                              ) : null}
                              <span className="text-[11px] leading-none text-muted-foreground whitespace-nowrap">
                                Cant. mín.
                              </span>
                              <Input
                                type="number"
                                step="any"
                                min="0"
                                className="h-8 w-[3.75rem] shrink-0 px-2 tabular-nums"
                                value={cantidadVal}
                                onChange={(e) => {
                                  const id = row.key;
                                  const val = e.target.value;
                                  setExtraPacks((xs) =>
                                    xs.map((x) => (x.id === id ? { ...x, cantidad: val } : x)),
                                  );
                                }}
                                placeholder="50"
                                aria-label="Cantidad mínima del tramo"
                              />
                              <span className="text-[11px] leading-none text-muted-foreground whitespace-nowrap">
                                {unidad}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                                aria-label="Quitar fila"
                                onClick={() => {
                                  setPackExtraEditingId((cur) => (cur === row.key ? null : cur));
                                  setExtraPacks((xs) => xs.filter((x) => x.id !== row.key));
                                  setSimMiddleOrder((o) => o.filter((t) => t !== row.key));
                                }}
                              >
                                <Trash2 className="size-3.5" aria-hidden />
                              </Button>
                              {hasQty ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                                  aria-label="Cerrar edición"
                                  title="Listo"
                                  onClick={() => setPackExtraEditingId(null)}
                                >
                                  <Check className="size-3.5" aria-hidden />
                                </Button>
                              ) : null}
                            </div>
                          );
                        })() : (
                          <span className="min-w-0 shrink truncate" title={row.etiqueta}>
                            {row.etiqueta}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="p-2 text-right tabular-nums">
                      <Input
                        type="number"
                        step="0.01"
                        min={GANANCIA_PCT_MIN}
                        max={GANANCIA_PCT_MAX}
                        className="h-8 w-full min-w-0 px-2 text-sm tabular-nums"
                        value={
                          cantidadKeyFila != null
                            ? (gananciaPorFila[cantidadKeyFila] ??
                                (row.kind === 'base' ? porcentajeGanancia : ''))
                            : ''
                        }
                        onChange={(e) => {
                          if (cantidadKeyFila == null) return;
                          setSimGananciaAviso(null);
                          const val = e.target.value;
                          setGananciaPorFila((prev) => ({ ...prev, [cantidadKeyFila]: val }));
                          if (row.kind === 'base') {
                            setPorcentajeGanancia(val);
                          }
                        }}
                        onBlur={(e) => {
                          if (cantidadKeyFila == null) return;
                          const next = clampGananciaInputStr(e.target.value);
                          if (next === e.target.value) return;
                          setGananciaPorFila((prev) => ({ ...prev, [cantidadKeyFila]: next }));
                          if (row.kind === 'base') {
                            setPorcentajeGanancia(next);
                          }
                        }}
                        placeholder={row.kind === 'base' ? 'Ej: 35' : 'Gan%'}
                      />
                    </TableCell>
                    <TableCell className="p-2 text-right tabular-nums">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="h-8 w-full min-w-0 px-2 text-sm tabular-nums"
                        value={precioUnitarioInputValue}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => {
                          if (cantidadKeyFila == null) return;
                          const val = e.target.value;
                          setPrecioVentaUnidadPorFila((prev) => ({ ...prev, [cantidadKeyFila]: val }));
                          aplicarPrecioUnitarioVenta(cantidadBase, val, row.kind);
                        }}
                        onBlur={(e) => {
                          if (cantidadKeyFila == null) return;
                          aplicarPrecioUnitarioVenta(cantidadBase, e.currentTarget.value, row.kind);
                          setPrecioVentaUnidadPorFila((prev) => {
                            if (prev[cantidadKeyFila] == null) return prev;
                            const next = { ...prev };
                            delete next[cantidadKeyFila];
                            return next;
                          });
                        }}
                        placeholder="PVP"
                        title="Precio final con IVA que paga el cliente (por unidad de stock)"
                        aria-label="PVP con IVA por unidad"
                        disabled={!(cantidadBase > 0) || !Number.isFinite(costoU) || costoU <= 0}
                      />
                    </TableCell>
                    <TableCell className="p-2 text-right tabular-nums text-muted-foreground">
                      {costoLinea != null ? formatCurrency(costoLinea) : '—'}
                    </TableCell>
                    <TableCell className="p-2 text-right tabular-nums text-muted-foreground">
                      {sinIva != null ? formatCurrency(sinIva) : '—'}
                    </TableCell>
                    <TableCell className="p-2 text-right tabular-nums text-muted-foreground">
                      {montoIva != null ? formatCurrency(montoIva) : '—'}
                    </TableCell>
                    <TableCell className="p-2 text-right tabular-nums font-medium">
                      {finalConIva != null ? (
                        multEff > 1 ? (
                          formatCurrency(finalConIva)
                        ) : (
                          precioUnitConIva != null ? formatCurrency(precioUnitConIva) : '—'
                        )
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
        </div>

        {simGananciaAviso ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
            {simGananciaAviso}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => {
              const id = uid();
              setExtraPacks((xs) => [...xs, { id, cantidad: '' }]);
              setSimMiddleOrder((o) => [...o, id]);
            }}
            >
              <Plus className="size-4" />
              Agregar venta por cantidad (pack)
            </Button>
            <span className="text-xs text-muted-foreground">
              En tramos por cantidad, el lápiz abre edición y borrado. Arrastrá ⋮⋮ para reordenar filas.
            </span>
          </div>

          <Button
            type="button"
            size="sm"
            disabled={!productoId || tramosSaving}
            onClick={async () => {
              if (!productoId) return;
              setTramosSaving(true);
              setTramosMsg(null);
              try {
                const tramos: { cantidad_desde: number; ganancia_pct: number }[] = [];

                // Base: cantidad 1 (siempre que sea numérico)
                const g1raw = gananciaPorFila['1'] ?? porcentajeGanancia;
                const g1 = parseNum(g1raw);
                if (Number.isFinite(g1) && g1 >= 0) {
                  tramos.push({ cantidad_desde: 1, ganancia_pct: g1 });
                }

                for (const token of simMiddleOrder) {
                  if (token === SIM_ROW_ENVASE) {
                    if (tieneEnvase && contenidoNum > 0) {
                      const k = cantidadKey(contenidoNum);
                      const gr = gananciaPorFila[k];
                      const gn = parseNum(gr);
                      if (Number.isFinite(gn) && gn >= 0) {
                        tramos.push({
                          cantidad_desde: Math.round(contenidoNum * 1000) / 1000,
                          ganancia_pct: gn,
                        });
                      }
                    }
                  } else {
                    const ep = extraPacks.find((x) => x.id === token);
                    if (!ep) continue;
                    const n = parseNum(ep.cantidad);
                    if (!Number.isFinite(n) || n <= 0) continue;
                    const k = cantidadKey(n);
                    const gr = gananciaPorFila[k];
                    const gn = parseNum(gr);
                    if (!Number.isFinite(gn) || gn < 0) continue;
                    tramos.push({ cantidad_desde: Math.round(n * 1000) / 1000, ganancia_pct: gn });
                  }
                }

                debugGananciaTramos('panel PUT armando payload', {
                  productoId,
                  tiene_envase: tieneEnvase,
                  contenidoNum,
                  sim_middle_order: simMiddleOrder,
                  tramos_enviados: tramos,
                  extra_packs: extraPacks.map((e) => ({ id: e.id, cantidad: e.cantidad })),
                  ganancia_por_fila_keys_sample: Object.keys(gananciaPorFila),
                });

                const res = await fetch(`/api/productos/${encodeURIComponent(productoId)}/ganancia-tramos`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ tramos }),
                });
                const j = (await res.json()) as {
                  error?: string;
                  tramos?: { cantidad_desde: number; ganancia_pct: number; orden?: number }[];
                };
                if (!res.ok) {
                  debugGananciaTramos('panel PUT respuesta error', {
                    productoId,
                    status: res.status,
                    error: j.error,
                  });
                  setTramosMsg(j.error ?? 'No se pudo guardar');
                  return;
                }
                debugGananciaTramos('panel PUT ok', {
                  productoId,
                  tramos_servidor: j.tramos,
                });
                if (Array.isArray(j.tramos)) {
                  setTramosServidor(j.tramos);
                }
                setTramosMsg('Guardado');
              } catch {
                setTramosMsg('Error de conexión');
              } finally {
                setTramosSaving(false);
              }
            }}
          >
            {tramosSaving ? 'Guardando…' : 'Guardar ganancias por cantidad'}
          </Button>
        </div>
        {tramosMsg ? (
          <p className={`text-xs ${tramosMsg === 'Guardado' ? 'text-green-600' : 'text-destructive'}`}>
            {tramosMsg}
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground border-t pt-3">
          El sistema guarda un solo precio de venta con IVA por 1 {capU(unidad)} (primera fila). En el POS podés
          cobrar también por caja si cargaste compra por envase.
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        Tip: si tu lista viene por caja, elegí “Por caja/pack”, cargá precio del envase y cuántas unidades trae.
      </p>
    </div>
  );
}
