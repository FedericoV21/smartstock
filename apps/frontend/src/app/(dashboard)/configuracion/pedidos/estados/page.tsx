'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import Link from 'next/link';

import { ConfigImpactGroup } from '@/components/configuracion/config-impact-group';
import { WorkflowEstadoColorField } from '@/components/configuracion/workflow-estado-color-field';
import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { normalizeWorkflowHexColor } from '@/lib/colors/workflow-hex';
import { slugifyWorkflowNombre } from '@/lib/ui/support-mode';
import { cn } from '@/lib/utils';

type EstadoPedido = 'borrador' | 'confirmado' | 'entregado' | 'cancelado';
type WorkflowEstado = {
  id: string;
  slug: string;
  nombre: string;
  color: string | null;
  fase: EstadoPedido;
  orden: number;
  activo: boolean;
};
type Edge = { desde_id: string; hacia_id: string };

/** Fila devuelta por GET/PATCH/POST workflow (sin timestamps en el tipo de UI). */
type ApiWorkflowEstadoRow = {
  id: string;
  slug: string;
  nombre: string;
  color: string | null;
  fase: EstadoPedido;
  orden: number;
  activo: boolean;
};

function toWorkflowEstado(row: ApiWorkflowEstadoRow): WorkflowEstado {
  return {
    id: row.id,
    slug: row.slug,
    nombre: row.nombre,
    color: row.color,
    fase: row.fase,
    orden: row.orden,
    activo: row.activo,
  };
}

const FASE_LABELS: Record<EstadoPedido, string> = {
  borrador: 'Borrador',
  confirmado: 'Confirmado (reserva stock)',
  entregado: 'Entregado/Enviado (descuenta stock)',
  cancelado: 'Cancelado',
};

export default function ConfigPedidosEstadosPage() {
  const { isSuperAdmin } = useDashboardRole();
  const supportMode = isSuperAdmin;
  const [loading, setLoading] = useState(true);
  const [savingEdges, setSavingEdges] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estados, setEstados] = useState<WorkflowEstado[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const [nuevoSlug, setNuevoSlug] = useState('');
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoFase, setNuevoFase] = useState<EstadoPedido>('confirmado');
  const [nuevoOrden, setNuevoOrden] = useState('25');
  const [nuevoColor, setNuevoColor] = useState('');
  const [creando, setCreando] = useState(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    const res = await fetch('/api/pedidos/workflow-estados?for_config=1');
    const json = (await res.json()) as { error?: string; estados?: WorkflowEstado[]; transiciones?: Edge[] };
    if (!res.ok) {
      setError(json.error ?? 'No se pudo cargar el workflow');
      if (!silent) {
        setEstados([]);
        setEdges([]);
      }
      if (!silent) setLoading(false);
      return;
    }
    setError(null);
    setEstados(json.estados ?? []);
    setEdges(json.transiciones ?? []);
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const checked = useMemo(() => {
    const s = new Set<string>();
    for (const e of edges) s.add(`${e.desde_id}→${e.hacia_id}`);
    return s;
  }, [edges]);

  async function crearEstado() {
    setCreando(true);
    setError(null);
    const orden = Number(nuevoOrden);
    const slug = supportMode ? nuevoSlug.trim() : slugifyWorkflowNombre(nuevoNombre);
    const res = await fetch('/api/pedidos/workflow-estados', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        nombre: nuevoNombre,
        fase: nuevoFase,
        orden: Number.isFinite(orden) ? orden : 0,
        color: normalizeWorkflowHexColor(nuevoColor) ?? null,
        activo: true,
      }),
    });
    const json = (await res.json()) as { error?: string; estado?: ApiWorkflowEstadoRow };
    setCreando(false);
    if (!res.ok) {
      setError(json.error ?? 'No se pudo crear el estado');
      return;
    }
    setNuevoSlug('');
    setNuevoNombre('');
    setNuevoColor('');
    if (json.estado) {
      setEstados((prev) => {
        const next = [...prev, toWorkflowEstado(json.estado!)];
        next.sort((a, b) => a.orden - b.orden || a.slug.localeCompare(b.slug));
        return next;
      });
    } else {
      await load({ silent: true });
    }
  }

  async function patchEstado(id: string, patch: Partial<WorkflowEstado>) {
    setError(null);
    const res = await fetch(`/api/pedidos/workflow-estados/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as { error?: string; estado?: ApiWorkflowEstadoRow };
    if (!res.ok) {
      setError(json.error ?? 'No se pudo actualizar el estado');
      return;
    }
    if (json.estado) {
      setEstados((prev) => {
        const row = toWorkflowEstado(json.estado!);
        const next = prev.map((e) => (e.id === id ? row : e));
        next.sort((a, b) => a.orden - b.orden || a.slug.localeCompare(b.slug));
        return next;
      });
    } else {
      await load({ silent: true });
    }
  }

  async function guardarTransiciones(next: Edge[]) {
    setSavingEdges(true);
    setError(null);
    const res = await fetch('/api/pedidos/workflow-transiciones', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transiciones: next }),
    });
    const json = (await res.json()) as { error?: string };
    setSavingEdges(false);
    if (!res.ok) {
      setError(json.error ?? 'No se pudieron guardar transiciones');
      return;
    }
    await load({ silent: true });
  }

  if (loading) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workflow de pedidos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Definí etiquetas personalizadas y transiciones. La fase define el efecto en stock/facturación.
          </p>
        </div>
        <Link href="/pedidos" className={cn(buttonVariants({ variant: 'outline' }))}>
          Volver
        </Link>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <ConfigImpactGroup impact="operacion" title="Estados visibles en pedidos">
      <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-medium">Crear estado</h2>
        <div className={cn('grid gap-3', supportMode ? 'md:grid-cols-5' : 'md:grid-cols-4')}>
          {supportMode ? (
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Slug (soporte)</span>
              <Input
                value={nuevoSlug}
                onChange={(e) => setNuevoSlug(e.target.value)}
                placeholder="transferido_sucursal"
              />
            </label>
          ) : null}
          <label className={cn('grid gap-1 text-sm', supportMode ? 'md:col-span-2' : 'md:col-span-2')}>
            <span className="text-muted-foreground">Nombre</span>
            <Input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="Transferido a sucursal" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Fase</span>
            <Select value={nuevoFase} onValueChange={(v) => setNuevoFase(v as EstadoPedido)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FASE_LABELS) as EstadoPedido[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {FASE_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Orden</span>
            <Input value={nuevoOrden} onChange={(e) => setNuevoOrden(e.target.value)} inputMode="numeric" />
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          <div className="grid gap-1 text-sm md:col-span-2">
            <span className="text-muted-foreground">Color (opcional)</span>
            <WorkflowEstadoColorField
              value={normalizeWorkflowHexColor(nuevoColor) ?? null}
              onChange={(n) => setNuevoColor(n ?? '')}
            />
          </div>
          <div className="flex items-end md:col-span-3">
            <Button
              type="button"
              onClick={() => void crearEstado()}
              disabled={creando || !nuevoNombre.trim() || (supportMode && !nuevoSlug.trim())}
            >
              {creando ? 'Creando…' : 'Crear'}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-medium">Estados</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {supportMode ? <th className="py-2 pr-3 font-medium">Slug (soporte)</th> : null}
                <th className="py-2 pr-3 font-medium">Nombre</th>
                <th className="py-2 pr-3 font-medium">Fase</th>
                <th className="py-2 pr-3 font-medium">Orden</th>
                <th className="py-2 pr-3 font-medium min-w-[12rem]">Color</th>
                <th className="py-2 pr-3 font-medium">Activo</th>
              </tr>
            </thead>
            <tbody>
              {estados.map((e) => (
                <tr key={e.id} className="border-b last:border-0">
                  {supportMode ? (
                    <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">{e.slug}</td>
                  ) : null}
                  <td className="py-2 pr-3">
                    <Input
                      defaultValue={e.nombre}
                      className="h-8"
                      onBlur={(ev) => {
                        const v = ev.target.value.trim();
                        if (v && v !== e.nombre) void patchEstado(e.id, { nombre: v });
                      }}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <Select
                      value={e.fase}
                      onValueChange={(v) => void patchEstado(e.id, { fase: v as EstadoPedido })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(FASE_LABELS) as EstadoPedido[]).map((k) => (
                          <SelectItem key={k} value={k}>
                            {FASE_LABELS[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-2 pr-3">
                    <Input
                      defaultValue={String(e.orden)}
                      className="h-8 w-24"
                      inputMode="numeric"
                      onBlur={(ev) => {
                        const n = Number(ev.target.value);
                        if (Number.isFinite(n) && n !== e.orden) void patchEstado(e.id, { orden: n });
                      }}
                    />
                  </td>
                  <td className="py-2 pr-3 align-middle">
                    <WorkflowEstadoColorField
                      value={normalizeWorkflowHexColor(e.color) ?? null}
                      onChange={(next) => {
                        const cur = normalizeWorkflowHexColor(e.color);
                        const n = normalizeWorkflowHexColor(next);
                        if ((n ?? null) !== (cur ?? null)) void patchEstado(e.id, { color: n });
                      }}
                      compact
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        defaultChecked={e.activo}
                        onChange={(ev) => void patchEstado(e.id, { activo: ev.target.checked })}
                      />
                      <span className="text-xs text-muted-foreground">{e.activo ? 'Sí' : 'No'}</span>
                    </label>
                  </td>
                </tr>
              ))}
              {estados.length === 0 ? (
                <tr>
                  <td className="py-3 text-muted-foreground" colSpan={supportMode ? 6 : 5}>
                    No hay estados configurados.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      </ConfigImpactGroup>

      <ConfigImpactGroup impact="avanzado" title="Transiciones entre estados">
      <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Transiciones permitidas</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={savingEdges}
            onClick={() => void guardarTransiciones(edges)}
            title="Guardar el set actual"
          >
            {savingEdges ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Marcá qué estados se pueden alcanzar desde cada uno. Esto controla el selector en pedidos.
        </p>

        <div className="space-y-4">
          {estados.map((desde) => {
            const destinos = estados.filter((x) => x.id !== desde.id);
            return (
              <div key={desde.id} className="rounded-lg border p-3">
                <p className="text-sm font-medium">
                  {desde.nombre}
                  {supportMode ? (
                    <span className="text-xs text-muted-foreground font-normal"> ({desde.slug})</span>
                  ) : null}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {destinos.map((hacia) => {
                    const key = `${desde.id}→${hacia.id}`;
                    const isChecked = checked.has(key);
                    return (
                      <label key={hacia.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(ev) => {
                            const on = ev.target.checked;
                            setEdges((prev) => {
                              const filtered = prev.filter(
                                (e) => !(e.desde_id === desde.id && e.hacia_id === hacia.id),
                              );
                              return on ? [...filtered, { desde_id: desde.id, hacia_id: hacia.id }] : filtered;
                            });
                          }}
                        />
                        {hacia.nombre}
                        <span className="text-xs text-muted-foreground">({hacia.fase})</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      </ConfigImpactGroup>

      <div className="text-xs text-muted-foreground">
        Tip: si querés un estado “Transferido a sucursal” entre confirmado y entregado, crealo con fase{' '}
        <span className="font-mono">confirmado</span> y agregá transiciones desde “Confirmado” hacia ese estado, y de ese estado hacia “Enviado”.
      </div>
    </div>
  );
}

