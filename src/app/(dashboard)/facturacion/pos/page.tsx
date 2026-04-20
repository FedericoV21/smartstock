'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { BarcodeInput, type BarcodeInputRef } from '@/components/pos/barcode-input';
import { CobroModal } from '@/components/pos/cobro-modal';
import {
  ShortcutsHelpModal,
  usePosKeyboardShortcuts,
} from '@/components/pos/keyboard-shortcuts';
import { ProductSearchModal } from '@/components/pos/product-search-modal';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { determinarTipoFactura } from '@/lib/facturacion/tipo-comprobante';
import { clearCart, loadCart, saveCart } from '@/lib/pos/cart-persistence';
import {
  clampPosPrefsForArca,
  clampTipoComprobante,
  loadPosPrefs,
  normalizePosPrefs,
  savePosPrefs,
  resolveTipoComprobanteInicial,
  type PosPrefs,
} from '@/lib/pos/prefs';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/formatters';

type CondicionIVA = Parameters<typeof determinarTipoFactura>[0];

type Cliente = {
  id: string;
  nombre: string;
  condicion_iva: string | null;
};

type ProductoScanned = {
  id: string;
  codigo: string;
  codigo_barras?: string | null;
  nombre: string;
  precio_venta: number;
  stock_actual: number;
  es_pesable?: boolean;
  unidad?: string;
  iva_porcentaje?: number | null;
};

type ScanResult = {
  producto: ProductoScanned;
  tipo: string;
  peso?: number;
};

export type CartItem = {
  producto: ProductoScanned;
  cantidad: number;
  peso?: number;
};

type DescuentoTipo = 'porcentaje' | 'monto';

function normalizarCondicionIVA(value: string | null | undefined): CondicionIVA {
  switch (value) {
    case 'responsable_inscripto':
    case 'monotributista':
    case 'exento':
    case 'consumidor_final':
      return value;
    default:
      return 'consumidor_final';
  }
}

function CantidadEditor({
  value,
  isPesable,
  unidad,
  onChange,
  onAdjust,
}: {
  value: number;
  isPesable: boolean;
  unidad?: string;
  onChange: (v: number) => void;
  onAdjust: (delta: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const step = isPesable && unidad !== 'gramo' ? 0.001 : 1;
  const displayValue = isPesable && unidad !== 'gramo'
    ? value.toFixed(3)
    : String(value);

  function startEdit() {
    setDraft(displayValue);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  }

  function commit() {
    const n = parseFloat(draft);
    if (n && n > 0) onChange(n);
    setEditing(false);
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        type="number"
        min={step}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') setEditing(false);
        }}
        className="w-24 ml-auto text-right h-8"
        autoFocus
      />
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        className="flex h-7 w-7 items-center justify-center rounded-md border text-sm hover:bg-muted transition-colors"
        onClick={() => onAdjust(-step)}
      >
        −
      </button>
      <button
        type="button"
        className="min-w-[3rem] rounded-md border px-2 py-1 text-center text-sm font-medium hover:bg-muted transition-colors tabular-nums"
        onClick={startEdit}
        title="Clic para editar"
      >
        {displayValue}
      </button>
      <button
        type="button"
        className="flex h-7 w-7 items-center justify-center rounded-md border text-sm hover:bg-muted transition-colors"
        onClick={() => onAdjust(step)}
      >
        +
      </button>
    </div>
  );
}

export default function PosPage() {
  const barcodeRef = useRef<BarcodeInputRef>(null);
  const [tenantId, setTenantId] = useState('');
  const [tenantIva, setTenantIva] = useState<CondicionIVA>('consumidor_final');
  const [tenantName, setTenantName] = useState('');
  const [tenantLogoUrl, setTenantLogoUrl] = useState<string | null>(null);
  const [tenantCuit, setTenantCuit] = useState<string | null>(null);
  const [tenantDomicilio, setTenantDomicilio] = useState<string | null>(null);
  const [tenantPuntoVenta, setTenantPuntoVenta] = useState<number>(1);
  const [userName, setUserName] = useState('');
  const [canEmit, setCanEmit] = useState(true);
  const [ivaDefault, setIvaDefault] = useState(21);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteId, setClienteId] = useState('');
  const [clienteSearch, setClienteSearch] = useState('');
  const [showClienteSearch, setShowClienteSearch] = useState(false);
  const [arcaConfigurado, setArcaConfigurado] = useState(false);
  const [posPrefs, setPosPrefs] = useState<PosPrefs>(() => loadPosPrefs());
  const [tipoComprobante, setTipoComprobante] = useState<'ticket' | 'factura'>(() =>
    resolveTipoComprobanteInicial(loadPosPrefs()),
  );
  const [lastScanned, setLastScanned] = useState<ProductoScanned | null>(null);
  const [scanError, setScanError] = useState('');
  const [stockWarning, setStockWarning] = useState('');
  const [now, setNow] = useState(new Date());
  const [highlightIdx, setHighlightIdx] = useState<number | null>(null);

  const [items, setItems] = useState<CartItem[]>([]);

  // Discount
  const [descuentoTipo, setDescuentoTipo] = useState<DescuentoTipo>('porcentaje');
  const [descuentoValor, setDescuentoValor] = useState(0);

  // Weight entry modal
  const [showWeightModal, setShowWeightModal] = useState(false);
  const [weightProduct, setWeightProduct] = useState<ProductoScanned | null>(null);
  const [weightInput, setWeightInput] = useState('');

  // Product search modal
  const [showSearch, setShowSearch] = useState(false);
  const [searchInitialQuery, setSearchInitialQuery] = useState('');

  // Cancel confirmation
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Restore cart prompt
  const [showRestorePrompt, setShowRestorePrompt] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<ReturnType<typeof loadCart>>(null);

  // Cobro modal
  const [showCobro, setShowCobro] = useState(false);

  useEffect(() => {
    async function init() {
      const [profileRes, clientesRes, tenantRes] = await Promise.all([
        fetch('/api/perfil'),
        fetch('/api/clientes'),
        fetch('/api/configuracion/tenant'),
      ]);

      if (profileRes.ok) {
        const p = await profileRes.json();
        const tid = p.tenantId ?? '';
        setTenantId(tid);
        setTenantName(p.tenantName ?? 'Mi Negocio');
        setUserName(p.userDisplayName ?? 'Usuario');
        setCanEmit(p.rol !== 'visor');
        if (p.ivaDefault != null) setIvaDefault(p.ivaDefault);

        // Check for items from pedido (sessionStorage)
        const fromPedido = sessionStorage.getItem('smartstock_pos_from_pedido');
        if (fromPedido) {
          sessionStorage.removeItem('smartstock_pos_from_pedido');
          try {
            const parsed = JSON.parse(fromPedido);
            if (parsed.items?.length) {
              setItems(parsed.items as CartItem[]);
            }
          } catch { /* ignore bad data */ }
        } else if (tid) {
          const saved = loadCart(tid);
          if (saved && saved.items?.length) {
            setPendingRestore(saved);
            setShowRestorePrompt(true);
          }
        }
      }

      if (clientesRes.ok) {
        const c = await clientesRes.json();
        const list = c.clientes ?? c ?? [];
        setClientes(list);
      }

      if (tenantRes.ok) {
        const t = await tenantRes.json();
        const arcaOk = t.arca_configurado === true;
        setArcaConfigurado(arcaOk);
        const rawPrefs = loadPosPrefs();
        const prefsAjustadas = clampPosPrefsForArca(rawPrefs, arcaOk);
        if (JSON.stringify(normalizePosPrefs(rawPrefs)) !== JSON.stringify(prefsAjustadas)) {
          savePosPrefs(prefsAjustadas);
        }
        setPosPrefs(prefsAjustadas);
        setTipoComprobante(resolveTipoComprobanteInicial(prefsAjustadas));
        setTenantIva(normalizarCondicionIVA(t.condicion_iva));
        setTenantLogoUrl(typeof t.logo_url === 'string' ? t.logo_url : null);
        setTenantCuit(typeof t.cuit === 'string' ? t.cuit : null);
        setTenantDomicilio(typeof t.domicilio === 'string' ? t.domicilio : null);
        setTenantPuntoVenta(
          typeof t.punto_de_venta === 'number' && Number.isFinite(t.punto_de_venta)
            ? t.punto_de_venta
            : 1,
        );
      }
    }
    void init();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function syncPosPrefs() {
      const raw = loadPosPrefs();
      const clamped = clampPosPrefsForArca(raw, arcaConfigurado);
      if (JSON.stringify(normalizePosPrefs(raw)) !== JSON.stringify(clamped)) {
        savePosPrefs(clamped);
      }
      setPosPrefs(clamped);
    }
    window.addEventListener('focus', syncPosPrefs);
    return () => window.removeEventListener('focus', syncPosPrefs);
  }, [arcaConfigurado]);

  useEffect(() => {
    const p = normalizePosPrefs(posPrefs);
    setTipoComprobante((t) => clampTipoComprobante(t, p));
  }, [posPrefs]);

  // Persist cart to localStorage (debounced)
  useEffect(() => {
    if (!tenantId || items.length === 0) return;
    const t = setTimeout(() => {
      saveCart(tenantId, { items, clienteId, tipoComprobante });
    }, 500);
    return () => clearTimeout(t);
  }, [items, clienteId, tipoComprobante, tenantId]);

  // Clear highlight after animation
  useEffect(() => {
    if (highlightIdx === null) return;
    const t = setTimeout(() => setHighlightIdx(null), 800);
    return () => clearTimeout(t);
  }, [highlightIdx]);

  const clienteActual = clienteId ? clientes.find((c) => c.id === clienteId) : null;
  const clienteNombre = clienteActual?.nombre ?? 'Consumidor Final';
  const clienteCondicionIva = normalizarCondicionIVA(clienteActual?.condicion_iva);

  const addUnitProduct = useCallback((producto: ProductoScanned) => {
    setItems((prev) => {
      const existing = prev.findIndex(
        (it) => it.producto.id === producto.id && !it.peso,
      );
      if (existing >= 0) {
        const updated = [...prev];
        const newCant = updated[existing].cantidad + 1;
        updated[existing] = { ...updated[existing], cantidad: newCant };
        setHighlightIdx(existing);
        if (newCant > producto.stock_actual) {
          setStockWarning(
            `"${producto.nombre}" tiene stock ${producto.stock_actual}, se agregaron ${newCant}.`,
          );
        }
        return updated;
      }

      if (1 > producto.stock_actual) {
        setStockWarning(
          `"${producto.nombre}" tiene stock ${producto.stock_actual}.`,
        );
      }

      const newItems = [...prev, { producto, cantidad: 1 }];
      setHighlightIdx(newItems.length - 1);
      return newItems;
    });
  }, []);

  const addProduct = useCallback(
    (producto: ProductoScanned) => {
      setScanError('');
      setStockWarning('');
      setLastScanned(producto);

      if (producto.es_pesable) {
        setWeightProduct(producto);
        setWeightInput('');
        setShowWeightModal(true);
        return;
      }

      addUnitProduct(producto);
    },
    [addUnitProduct],
  );

  const openSearchWith = useCallback((initial: string) => {
    setScanError('');
    setStockWarning('');
    setLastScanned(null);
    setSearchInitialQuery(initial);
    setShowSearch(true);
  }, []);

  const handleScan = useCallback(
    async (codigo: string) => {
      setScanError('');
      setStockWarning('');
      setLastScanned(null);

      // Heuristic: free-text input (spaces or accents) → skip the
      // barcode lookup and go straight to the search modal.
      if (/[\s\u00C0-\u017F]/.test(codigo)) {
        openSearchWith(codigo);
        return;
      }

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setScanError('Sin conexión a internet. Verificá tu red y reintentá.');
        return;
      }

      try {
        const res = await fetch(
          `/api/productos/buscar-por-barcode?codigo=${encodeURIComponent(codigo)}`,
        );

        if (res.status === 404) {
          // Not a known code/SKU/PLU → fall back to name search with the
          // typed phrase pre-filled, so "martillo" or "clavo" still work.
          openSearchWith(codigo);
          return;
        }

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setScanError(err.error ? `${err.error}: ${codigo}` : `Producto no encontrado: ${codigo}`);
          return;
        }

        const data: ScanResult = await res.json();
        setLastScanned(data.producto);

        // Scale barcode with embedded weight → add directly with that weight
        if (data.tipo === 'balanza_peso' && data.peso) {
          const cantidad = data.producto.unidad === 'gramo'
            ? Math.round(data.peso * 1000)
            : data.peso;
          setItems((prev) => {
            const newItems = [
              ...prev,
              { producto: data.producto, cantidad, peso: cantidad },
            ];
            setHighlightIdx(newItems.length - 1);
            return newItems;
          });
          return;
        }

        // Weighable product scanned without embedded weight → ask for weight
        if (data.producto.es_pesable) {
          setWeightProduct(data.producto);
          setWeightInput('');
          setShowWeightModal(true);
          return;
        }

        addUnitProduct(data.producto);
      } catch {
        setScanError('Error de conexión');
      }
    },
    [addUnitProduct, openSearchWith],
  );

  function confirmWeight() {
    const peso = parseFloat(weightInput);
    if (!peso || peso <= 0 || !weightProduct) return;

    setItems((prev) => {
      const newItems = [
        ...prev,
        { producto: weightProduct, cantidad: peso, peso },
      ];
      setHighlightIdx(newItems.length - 1);
      return newItems;
    });
    setShowWeightModal(false);
    setWeightProduct(null);
  }

  function updateCantidad(idx: number, val: number) {
    if (!val || val <= 0) return;
    setItems((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], cantidad: val };
      return updated;
    });
  }

  function adjustCantidad(idx: number, delta: number) {
    setItems((prev) => {
      const item = prev[idx];
      const next = Math.round((item.cantidad + delta) * 1000) / 1000;
      if (next <= 0) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], cantidad: next };
      return updated;
    });
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function cancelVenta() {
    setItems([]);
    setDescuentoValor(0);
    setLastScanned(null);
    setScanError('');
    setStockWarning('');
    setShowCancelConfirm(false);
    if (tenantId) clearCart(tenantId);
    barcodeRef.current?.focus();
  }

  // Calculations
  const subtotal = items.reduce(
    (sum, it) => sum + it.cantidad * it.producto.precio_venta,
    0,
  );
  const subtotalRounded = Math.round(subtotal * 100) / 100;

  const descuentoMonto =
    descuentoTipo === 'porcentaje'
      ? Math.round(subtotalRounded * (descuentoValor / 100) * 100) / 100
      : Math.min(descuentoValor, subtotalRounded);

  const afterDiscount = Math.round((subtotalRounded - descuentoMonto) * 100) / 100;

  const esFactura = tipoComprobante === 'factura';

  // Precios IVA-incluidos: al facturar sólo discriminamos el IVA embebido,
  // no se suma al total.
  const ivaDesglose = esFactura
    ? items.reduce<Record<number, number>>((acc, it) => {
        const rate = it.producto.iva_porcentaje ?? ivaDefault;
        const lineGross = Math.round(it.cantidad * it.producto.precio_venta * 100) / 100;
        const proportion = subtotalRounded > 0 ? lineGross / subtotalRounded : 0;
        const grossAfterDiscount = afterDiscount * proportion;
        // IVA embebido: gross * rate / (100 + rate)
        const ivaLine = (grossAfterDiscount * rate) / (100 + rate);
        acc[rate] = Math.round(((acc[rate] ?? 0) + ivaLine) * 100) / 100;
        return acc;
      }, {})
    : {};

  const ivaMonto = Object.values(ivaDesglose).reduce((s, v) => s + v, 0);
  const total = afterDiscount;
  const netoGravado = esFactura
    ? Math.round((afterDiscount - ivaMonto) * 100) / 100
    : afterDiscount;

  const filteredClientes = clienteSearch.trim()
    ? clientes.filter((c) =>
        c.nombre.toLowerCase().includes(clienteSearch.toLowerCase()),
      )
    : clientes;

  const anyModalOpen =
    showClienteSearch ||
    showWeightModal ||
    showCancelConfirm ||
    showCobro ||
    showSearch;

  const prefsPos = normalizePosPrefs(clampPosPrefsForArca(posPrefs, arcaConfigurado));
  const puedeAlternarComprobante = prefsPos.aceptaTicket && prefsPos.aceptaFactura;

  const { showHelp, setShowHelp } = usePosKeyboardShortcuts({
    onCobrar: () => {
      if (items.length > 0 && canEmit && !anyModalOpen) setShowCobro(true);
    },
    onBuscarProducto: () => {
      if (canEmit && !anyModalOpen) {
        setSearchInitialQuery('');
        setShowSearch(true);
      }
    },
    onCambiarCliente: () => {
      if (!anyModalOpen) setShowClienteSearch(true);
    },
    onCancelarVenta: () => {
      if (items.length > 0 && !anyModalOpen) setShowCancelConfirm(true);
    },
    onCambiarTipo: () => {
      if (!anyModalOpen && puedeAlternarComprobante) {
        setTipoComprobante((t) => (t === 'ticket' ? 'factura' : 'ticket'));
      }
    },
    disabled: false,
  });

  return (
    <>
      {/* Top bar */}
      <header className="flex items-center justify-between border-b bg-card px-4 py-2 shadow-sm shrink-0">
        <div className="flex items-center gap-4">
          <Link
            href="/facturacion"
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
          >
            ← Salir
          </Link>
          <span className="font-semibold text-lg">{tenantName}</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Cliente:</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowClienteSearch(!showClienteSearch)}
              >
                {clienteNombre}
              </Button>
            </div>

            {showClienteSearch && (
              <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border bg-popover p-2 shadow-lg">
                <Input
                  placeholder="Buscar cliente…"
                  value={clienteSearch}
                  onChange={(e) => setClienteSearch(e.target.value)}
                  autoFocus
                  className="mb-2"
                />
                <div className="max-h-48 overflow-y-auto">
                  <button
                    type="button"
                    className={cn(
                      'w-full rounded px-3 py-1.5 text-left text-sm hover:bg-muted font-medium',
                      !clienteId && 'bg-primary/10 text-primary',
                    )}
                    onClick={() => {
                      setClienteId('');
                      setShowClienteSearch(false);
                      setClienteSearch('');
                    }}
                  >
                    Consumidor Final
                  </button>
                  {filteredClientes.length > 0 && (
                    <div className="my-1 border-t" />
                  )}
                  {filteredClientes.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={cn(
                        'w-full rounded px-3 py-1.5 text-left text-sm hover:bg-muted',
                        c.id === clienteId && 'bg-muted font-medium',
                      )}
                      onClick={() => {
                        setClienteId(c.id);
                        setShowClienteSearch(false);
                        setClienteSearch('');
                      }}
                    >
                      {c.nombre}
                    </button>
                  ))}
                  {filteredClientes.length === 0 && !clienteSearch.trim() && (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      No hay clientes registrados
                    </p>
                  )}
                  {filteredClientes.length === 0 && clienteSearch.trim() && (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      Sin resultados
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {puedeAlternarComprobante ? (
            <Select
              value={tipoComprobante}
              onValueChange={(v) => setTipoComprobante(v as 'ticket' | 'factura')}
            >
              <SelectTrigger className="w-[8.5rem]" title="Tipo de comprobante (F12)">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {prefsPos.aceptaTicket ? (
                  <SelectItem value="ticket">Ticket</SelectItem>
                ) : null}
                {prefsPos.aceptaFactura ? (
                  <SelectItem value="factura">Factura</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          ) : (
            <span
              className="inline-flex h-9 min-w-[8.5rem] items-center rounded-md border bg-muted/30 px-3 text-sm font-medium"
              title="Configurá los tipos permitidos en Configuración → Preferencias POS"
            >
              {tipoComprobante === 'ticket' ? 'Ticket' : 'Factura'}
            </span>
          )}

          <span className="hidden text-sm text-muted-foreground md:inline">
            {now.toLocaleDateString('es-AR')}{' '}
            {now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
          </span>

          <span className="text-sm font-medium">{userName}</span>
        </div>
      </header>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Scan + items list (~65%) */}
        <div className="flex flex-[65] flex-col p-4 gap-3 overflow-hidden">
          {/* Scan bar */}
          <div className="shrink-0 flex gap-2">
            <div className="flex-1">
              <BarcodeInput
                ref={barcodeRef}
                onScan={handleScan}
                placeholder="Escaneá código, escribí SKU o nombre del producto…"
                pauseRefocus={anyModalOpen}
                disabled={!canEmit}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-12 px-4 shrink-0"
              disabled={!canEmit}
              onClick={() => {
                setSearchInitialQuery('');
                setShowSearch(true);
              }}
              title="Buscar por nombre (F3)"
            >
              🔍 Buscar (F3)
            </Button>
          </div>

          {/* Scan feedback */}
          {scanError && (
            <div className="shrink-0 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {scanError}
            </div>
          )}
          {stockWarning && (
            <div className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              ⚠ Stock bajo — {stockWarning}
            </div>
          )}
          {lastScanned && !scanError && (
            <div className="shrink-0 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm dark:border-green-800 dark:bg-green-950/30">
              <span className="font-medium">{lastScanned.nombre}</span>
              <span className="ml-2 text-muted-foreground">
                {formatCurrency(lastScanned.precio_venta)}
              </span>
            </div>
          )}

          {/* Items list */}
          {items.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-lg text-muted-foreground">
                Escaneá el primer producto para empezar
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto rounded-xl border bg-card shadow-sm">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium w-12">#</th>
                    <th className="px-4 py-2 font-medium">Producto</th>
                    <th className="px-4 py-2 font-medium w-16">Unidad</th>
                    <th className="px-4 py-2 text-right font-medium w-28">Cantidad</th>
                    <th className="px-4 py-2 text-right font-medium w-28">P. Unit.</th>
                    {esFactura && (
                      <>
                        <th className="px-4 py-2 text-right font-medium w-20">IVA %</th>
                        <th className="px-4 py-2 text-right font-medium w-24">IVA</th>
                      </>
                    )}
                    <th className="px-4 py-2 text-right font-medium w-28">Subtotal</th>
                    <th className="px-4 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => {
                    const lineSubtotal = Math.round(it.cantidad * it.producto.precio_venta * 100) / 100;
                    const lineRate = it.producto.iva_porcentaje ?? ivaDefault;
                    const lineIva = esFactura
                      ? Math.round(((lineSubtotal * lineRate) / (100 + lineRate)) * 100) / 100
                      : 0;
                    return (
                      <tr
                        key={`${it.producto.id}-${i}`}
                        className={cn(
                          'border-b last:border-0 transition-colors',
                          highlightIdx === i && 'bg-green-50 dark:bg-green-950/20',
                        )}
                      >
                        <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>
                        <td className="px-4 py-2 font-medium">{it.producto.nombre}</td>
                        <td className="px-4 py-2 text-muted-foreground text-xs">
                          {it.producto.unidad ?? 'unidad'}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <CantidadEditor
                            value={it.cantidad}
                            isPesable={!!it.peso}
                            unidad={it.producto.unidad}
                            onChange={(v) => updateCantidad(i, v)}
                            onAdjust={(d) => adjustCantidad(i, d)}
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          {formatCurrency(it.producto.precio_venta)}
                        </td>
                        {esFactura && (
                          <>
                            <td className="px-4 py-2 text-right text-muted-foreground tabular-nums">
                              {lineRate}%
                            </td>
                            <td className="px-4 py-2 text-right text-muted-foreground tabular-nums">
                              {formatCurrency(lineIva)}
                            </td>
                          </>
                        )}
                        <td className="px-4 py-2 text-right font-medium">
                          {formatCurrency(lineSubtotal)}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-destructive transition-colors"
                            onClick={() => removeItem(i)}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Summary panel (~35%) */}
        <aside className="flex w-80 shrink-0 flex-col border-l bg-card p-4">
          <h2 className="text-sm font-medium text-muted-foreground mb-4">Resumen</h2>

          <div className="flex-1 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(subtotalRounded)}</span>
            </div>

            {/* Discount */}
            <div className="space-y-1">
              <span className="text-sm text-muted-foreground">Descuento</span>
              <div className="flex gap-2">
                <Select
                  value={descuentoTipo}
                  onValueChange={(v) => setDescuentoTipo(v as DescuentoTipo)}
                >
                  <SelectTrigger className="w-20 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="porcentaje">%</SelectItem>
                    <SelectItem value="monto">$</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={0}
                  max={descuentoTipo === 'porcentaje' ? 100 : subtotalRounded}
                  value={descuentoValor || ''}
                  onChange={(e) =>
                    setDescuentoValor(Math.max(0, parseFloat(e.target.value) || 0))
                  }
                  className="flex-1 h-8"
                  placeholder="0"
                />
              </div>
              {descuentoMonto > 0 && (
                <p className="text-xs text-muted-foreground">
                  -{formatCurrency(descuentoMonto)}
                </p>
              )}
            </div>

            {esFactura && (
              <>
                <div className="flex justify-between text-sm border-t pt-3">
                  <span className="text-muted-foreground">Neto gravado</span>
                  <span>{formatCurrency(netoGravado)}</span>
                </div>
                {Object.entries(ivaDesglose).map(([rate, monto]) => (
                  <div key={rate} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      IVA {rate}% <span className="text-xs">(incluido)</span>
                    </span>
                    <span>{formatCurrency(monto)}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="space-y-3 pt-4 border-t">
            <div className="flex justify-between text-3xl font-bold">
              <span>Total</span>
              <span>{formatCurrency(total)}</span>
            </div>

            <Button
              className="w-full h-16 text-xl font-bold"
              disabled={items.length === 0 || !canEmit}
              onClick={() => setShowCobro(true)}
            >
              COBRAR (F2)
            </Button>

            {items.length > 0 && (
              <Button
                variant="outline"
                className="w-full text-destructive hover:text-destructive"
                onClick={() => setShowCancelConfirm(true)}
              >
                Cancelar venta (F8)
              </Button>
            )}

            {!canEmit && (
              <p className="text-xs text-muted-foreground text-center">
                Tu rol no permite emitir comprobantes
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* Bottom bar */}
      <footer className="flex items-center justify-between border-t bg-card px-4 py-1.5 text-xs text-muted-foreground shrink-0">
        <span>
          {items.length} ítem(s) ·{' '}
          {items.reduce((sum, it) => sum + it.cantidad, 0).toFixed(items.some((it) => it.peso) ? 3 : 0)} unidades
        </span>
        <span>Cajero: {userName}</span>
        <button
          type="button"
          className="hover:text-foreground underline"
          onClick={() => setShowHelp(true)}
        >
          F1 Ayuda
        </button>
      </footer>

      {/* Weight entry modal */}
      {showWeightModal && weightProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-96 rounded-xl border bg-background p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-semibold">Ingresar cantidad manualmente</h3>
            <p className="text-sm text-muted-foreground">
              {weightProduct.nombre} — Producto pesable
            </p>
            <div className="flex items-end gap-2">
              <label className="flex-1 grid gap-1">
                <span className="text-sm text-muted-foreground">
                  {weightProduct.unidad === 'gramo' ? 'Peso (gramos)' : 'Peso (kg)'}
                </span>
                <Input
                  type="number"
                  min={weightProduct.unidad === 'gramo' ? 1 : 0.001}
                  step={weightProduct.unidad === 'gramo' ? 1 : 0.001}
                  value={weightInput}
                  onChange={(e) => setWeightInput(e.target.value)}
                  placeholder={weightProduct.unidad === 'gramo' ? '0' : '0.000'}
                  className="text-2xl h-14 text-center"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmWeight();
                    if (e.key === 'Escape') {
                      setShowWeightModal(false);
                      setWeightProduct(null);
                    }
                  }}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowWeightModal(false);
                  setWeightProduct(null);
                }}
              >
                Cancelar
              </Button>
              <Button onClick={confirmWeight} disabled={!parseFloat(weightInput)}>
                Agregar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel confirmation */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-96 rounded-xl border bg-background p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-semibold">Cancelar venta</h3>
            <p className="text-sm text-muted-foreground">
              Se eliminarán {items.length} ítem(s) del carrito. Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCancelConfirm(false)}>
                Volver
              </Button>
              <Button variant="destructive" onClick={cancelVenta}>
                Sí, cancelar venta
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Cobro modal */}
      {showCobro && (
        <CobroModal
          items={items}
          clienteId={clienteId}
          clienteNombre={clienteNombre}
          clienteCondicionIva={clienteCondicionIva}
          tipoComprobante={tipoComprobante}
          total={total}
          subtotal={subtotalRounded}
          descuentoMonto={descuentoMonto}
          ivaMonto={ivaMonto}
          tenantCondicionIva={tenantIva}
          tenantNombre={tenantName}
          tenantLogoUrl={tenantLogoUrl}
          tenantCuit={tenantCuit}
          tenantDomicilio={tenantDomicilio}
          tenantPuntoVenta={tenantPuntoVenta}
          cajeroNombre={userName}
          ivaPorcentajeDefault={ivaDefault}
          onSuccess={() => {}}
          onClose={() => {
            setShowCobro(false);
            cancelVenta();
          }}
        />
      )}

      {/* Restore cart prompt */}
      {showRestorePrompt && pendingRestore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-96 rounded-xl border bg-background p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-semibold">Venta en curso detectada</h3>
            <p className="text-sm text-muted-foreground">
              Hay una venta sin emitir con {(pendingRestore.items as unknown[]).length} ítem(s).
              ¿Querés restaurarla?
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowRestorePrompt(false);
                  setPendingRestore(null);
                  if (tenantId) clearCart(tenantId);
                }}
              >
                No, empezar de cero
              </Button>
              <Button
                onClick={() => {
                  setItems(pendingRestore.items as CartItem[]);
                  if (pendingRestore.clienteId) setClienteId(pendingRestore.clienteId);
                  if (pendingRestore.tipoComprobante) {
                    setTipoComprobante(
                      clampTipoComprobante(
                        pendingRestore.tipoComprobante as 'ticket' | 'factura',
                        loadPosPrefs(),
                      ),
                    );
                  }
                  setShowRestorePrompt(false);
                  setPendingRestore(null);
                }}
              >
                Sí, restaurar
              </Button>
            </div>
          </div>
        </div>
      )}

      <ProductSearchModal
        open={showSearch}
        initialQuery={searchInitialQuery}
        onClose={() => {
          setShowSearch(false);
          setSearchInitialQuery('');
          barcodeRef.current?.focus();
        }}
        onSelect={(p) => {
          addProduct({
            id: p.id,
            codigo: p.codigo,
            codigo_barras: p.codigo_barras ?? null,
            nombre: p.nombre,
            precio_venta: p.precio_venta,
            stock_actual: p.stock_actual,
            es_pesable: p.es_pesable,
            unidad: p.unidad,
            iva_porcentaje: p.iva_porcentaje,
          });
        }}
      />

      <ShortcutsHelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </>
  );
}
