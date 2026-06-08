'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/hooks/use-confirm';
import { cn } from '@/lib/utils';

type ProveedorOpt = { id: string; nombre: string; cuit: string | null; activo: boolean };

type DryRunPayload = {
  dry_run?: boolean;
  counts?: Record<string, number>;
  cuentas_corriente?: { proveedor_id: string; saldo: number }[];
};

const money = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n);

const LABEL_COUNTS: Record<string, string> = {
  producto: 'Productos (proveedor principal)',
  producto_proveedor_rows: 'Vínculos catálogo–proveedor',
  producto_proveedor_duplicate_junction_removed: 'Vínculos duplicados a descartar',
  lista_precios: 'Listas de precios',
  comprobante: 'Comprobantes de compra',
  importacion_log: 'Importaciones',
  lector_factura_log: 'Lecturas de factura',
  movimiento: 'Movimientos de stock',
  producto_lote_ingreso: 'Lotes de ingreso',
  pago: 'Pagos',
  pago_proveedor_factura: 'Obligaciones / cuenta por pagar',
  whatsapp_branch_rule: 'Reglas WhatsApp',
};

export function FusionarProveedorEnDestino({
  survivorId,
  survivorNombre,
  canEdit,
  onMerged,
  variant = 'standalone',
}: {
  survivorId: string;
  survivorNombre: string;
  canEdit: boolean;
  onMerged: () => void;
  /** `embedded`: sin caja propia ni título (p. ej. dentro de un &lt;details&gt;). */
  variant?: 'standalone' | 'embedded';
}) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [opts, setOpts] = useState<ProveedorOpt[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loserId, setLoserId] = useState('');
  const [simPayload, setSimPayload] = useState<DryRunPayload | null>(null);
  const [simErr, setSimErr] = useState<string | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [mergeLoading, setMergeLoading] = useState(false);

  const loadProveedores = useCallback(async () => {
    setLoadingList(true);
    setLoadErr(null);
    try {
      const res = await fetch('/api/proveedores?estado=todos');
      const json = (await res.json()) as { proveedores?: ProveedorOpt[]; error?: string };
      if (!res.ok) {
        setLoadErr(json.error ?? 'No se pudo cargar la lista');
        setOpts([]);
        return;
      }
      const list = (json.proveedores ?? []).filter((p) => p.id !== survivorId);
      setOpts(list.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
    } finally {
      setLoadingList(false);
    }
  }, [survivorId]);

  useEffect(() => {
    void loadProveedores();
  }, [loadProveedores]);

  async function simular() {
    if (!loserId) return;
    setSimLoading(true);
    setSimErr(null);
    setSimPayload(null);
    try {
      const res = await fetch('/api/proveedores/fusionar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          survivor_id: survivorId,
          loser_ids: [loserId],
          dry_run: true,
        }),
      });
      const json = (await res.json()) as DryRunPayload & { error?: string };
      if (!res.ok) {
        setSimErr(json.error ?? 'Error en simulación');
        return;
      }
      setSimPayload(json);
    } finally {
      setSimLoading(false);
    }
  }

  async function ejecutarFusion() {
    if (!loserId) return;
    const loser = opts.find((p) => p.id === loserId);
    const ok = await confirm({
      title: 'Fusionar proveedores',
      description: (
        <div className="space-y-2 text-sm">
          <p>
            Se unificarán en <strong>{survivorNombre}</strong> todos los movimientos, productos, deudas y demás
            datos vinculados a{' '}
            <strong>{loser?.nombre ?? 'el proveedor elegido'}</strong>. El proveedor duplicado se eliminará.
          </p>
          <p className="font-medium text-destructive">Esta acción no se puede deshacer.</p>
        </div>
      ),
      confirmLabel: 'Fusionar',
      cancelLabel: 'Cancelar',
      confirmVariant: 'destructive',
    });
    if (!ok) return;

    setMergeLoading(true);
    setSimErr(null);
    try {
      const res = await fetch('/api/proveedores/fusionar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          survivor_id: survivorId,
          loser_ids: [loserId],
          dry_run: false,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSimErr(json.error ?? 'No se pudo fusionar');
        return;
      }
      setLoserId('');
      setSimPayload(null);
      await loadProveedores();
      onMerged();
    } finally {
      setMergeLoading(false);
    }
  }

  if (!canEdit) return null;

  const Shell = variant === 'embedded' ? 'div' : 'section';
  const shellClass =
    variant === 'embedded'
      ? 'space-y-4'
      : 'rounded-xl border border-amber-200/80 bg-amber-50/50 p-5 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/20';

  return (
    <>
      {ConfirmDialog}
      <Shell className={shellClass}>
        {variant === 'standalone' ? (
          <h2 className="font-medium text-foreground">Unificar con otro proveedor</h2>
        ) : null}
        <p
          className={
            variant === 'standalone'
              ? 'mt-1 text-sm text-muted-foreground'
              : 'text-sm text-muted-foreground'
          }
        >
          Si cargaste el mismo proveedor dos veces con distinto nombre o CUIT, podés concentrar historial, productos y
          cuenta corriente en <span className="text-foreground">{survivorNombre}</span>. Primero simulá el impacto.
        </p>

        {loadErr ? <p className="mt-2 text-sm text-destructive">{loadErr}</p> : null}

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="grid min-w-[220px] flex-1 gap-1 text-sm">
            <span className="text-muted-foreground">Proveedor a absorber (se elimina)</span>
            <select
              className={cn(
                'border-input h-9 w-full rounded-md border bg-background px-2 text-sm',
                loadingList && 'opacity-60',
              )}
              disabled={loadingList || opts.length === 0}
              value={loserId}
              onChange={(e) => {
                setLoserId(e.target.value);
                setSimPayload(null);
                setSimErr(null);
              }}
            >
              <option value="">{loadingList ? 'Cargando…' : opts.length === 0 ? 'No hay otros proveedores' : 'Elegí…'}</option>
              {opts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                  {p.cuit ? ` · ${p.cuit}` : ''}
                  {!p.activo ? ' (inactivo)' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!loserId || simLoading}
              onClick={() => void simular()}
            >
              {simLoading ? 'Simulando…' : 'Simular impacto'}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!loserId || mergeLoading || !simPayload?.dry_run}
              onClick={() => void ejecutarFusion()}
            >
              {mergeLoading ? 'Fusionando…' : 'Fusionar ahora'}
            </Button>
          </div>
        </div>

        {simErr ? <p className="mt-3 text-sm text-destructive">{simErr}</p> : null}

        {simPayload?.dry_run === true && simPayload.counts ? (
          <div className="mt-4 rounded-lg border border-border bg-card/80 p-3 text-sm">
            <p className="font-medium text-foreground">Resultado de la simulación</p>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {Object.entries(simPayload.counts).map(([k, v]) => (
                <li key={k} className="flex justify-between gap-3 tabular-nums">
                  <span className="text-muted-foreground">{LABEL_COUNTS[k] ?? k}</span>
                  <span className="font-medium">{v}</span>
                </li>
              ))}
            </ul>
            {Array.isArray(simPayload.cuentas_corriente) && simPayload.cuentas_corriente.length > 0 ? (
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-xs font-medium text-muted-foreground">Saldos de cuenta a consolidar</p>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {simPayload.cuentas_corriente.map((c) => (
                    <li key={String(c.proveedor_id)} className="tabular-nums">
                      Proveedor {String(c.proveedor_id).slice(0, 8)}… → {money(Number(c.saldo))}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="mt-3 text-xs text-muted-foreground">
              Si los números te cierran, usá &quot;Fusionar ahora&quot;. Los vínculos duplicados en catálogo se descartan
              automáticamente cuando ya existía el mismo producto para {survivorNombre}.
            </p>
          </div>
        ) : null}
      </Shell>
    </>
  );
}
