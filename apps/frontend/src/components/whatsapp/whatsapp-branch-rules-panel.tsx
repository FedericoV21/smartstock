'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type SucursalRow = {
  id: string;
  nombre: string;
  codigo: string | null;
  es_principal: boolean | null;
};

type BranchRuleRow = {
  id: string;
  sucursal_id: string;
  from_wa_id: string | null;
  prioridad: number;
  activa: boolean;
  sucursal: SucursalRow | SucursalRow[] | null;
};

function sucursalLabel(row: BranchRuleRow): string {
  const s = Array.isArray(row.sucursal) ? row.sucursal[0] : row.sucursal;
  if (!s) return row.sucursal_id;
  return `${s.nombre}${s.codigo ? ` (${s.codigo})` : ''}${s.es_principal ? ' · principal' : ''}`;
}

export function WhatsAppBranchRulesPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [rules, setRules] = useState<BranchRuleRow[]>([]);
  const [sucursales, setSucursales] = useState<SucursalRow[]>([]);
  const [newSucursalId, setNewSucursalId] = useState('');
  const [newFromWaId, setNewFromWaId] = useState('');
  const [newPrioridad, setNewPrioridad] = useState('10');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/whatsapp/branch-rules');
      const json = (await res.json()) as {
        error?: string;
        rules?: BranchRuleRow[];
        sucursales?: SucursalRow[];
        can_manage?: boolean;
      };
      if (!res.ok) throw new Error(json.error ?? 'No se pudieron cargar las reglas');
      setRules(json.rules ?? []);
      const list = json.sucursales ?? [];
      setSucursales(list);
      setCanManage(Boolean(json.can_manage));
      if (list.length > 0) {
        setNewSucursalId((current) => current || list[0]!.id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addRule() {
    if (!newSucursalId) {
      setError('Elegí una sucursal');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/whatsapp/branch-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sucursal_id: newSucursalId,
          from_wa_id: newFromWaId.trim() || null,
          prioridad: Number(newPrioridad) || 0,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'No se pudo crear la regla');
      setNewFromWaId('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removeRule(id: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/branch-rules?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'No se pudo eliminar');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm md:p-6">
      <div>
        <h2 className="text-sm font-medium text-muted-foreground">Sucursal para adjuntos WhatsApp</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Si hay varias sucursales, el bot usa una regla o la sucursal principal. Sin regla, pide al usuario
          que responda 1, 2, 3 por chat.
        </p>
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">Cargando reglas…</p>
      ) : (
        <>
          {rules.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No hay reglas. Se intentará usar la sucursal marcada como principal al subir facturas.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {rules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                >
                  <div>
                    <span className="font-medium">{sucursalLabel(rule)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      prioridad {rule.prioridad}
                      {rule.from_wa_id ? ` · WA ${rule.from_wa_id}` : ' · todos los números'}
                    </span>
                  </div>
                  {canManage ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={saving}
                      onClick={() => void removeRule(rule.id)}
                      aria-label="Eliminar regla"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canManage ? (
            <div className="mt-4 grid gap-2 md:grid-cols-4">
              <Select
                value={newSucursalId}
                onValueChange={(v) => setNewSucursalId(v ?? '')}
                disabled={saving}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sucursal" />
                </SelectTrigger>
                <SelectContent>
                  {sucursales.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.nombre}
                      {s.es_principal ? ' (principal)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={newFromWaId}
                onChange={(e) => setNewFromWaId(e.target.value)}
                placeholder="WhatsApp opcional (54911…)"
                disabled={saving}
              />
              <Input
                type="number"
                value={newPrioridad}
                onChange={(e) => setNewPrioridad(e.target.value)}
                placeholder="Prioridad"
                disabled={saving}
              />
              <Button type="button" disabled={saving} onClick={() => void addRule()}>
                <Plus className="mr-2 h-4 w-4" />
                Agregar regla
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">Solo admin puede editar reglas.</p>
          )}
        </>
      )}

      {error ? (
        <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      ) : null}
    </section>
  );
}
