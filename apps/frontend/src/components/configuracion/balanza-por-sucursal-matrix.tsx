'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseBarcode } from '@/lib/pos/barcode-parser';
import {
  BALANZA_TEMPLATES_MAX,
  clampPosPrefsForArca,
  finalizePosPrefsForStorage,
  normalizeBalanzaImporteTemplate,
  normalizeBalanzaTemplates,
  normalizeBalanzaUnidadTemplate,
  normalizePosPrefs,
  type PosPrefs,
} from '@/lib/pos/prefs';

export type BalanzaSucursalMatrixRow = {
  sucursalId: string;
  nombre: string;
  codigo: string;
  inheritFromTenant: boolean;
  templates: [string, string];
  unidadTemplate: string;
  importeTemplate: string;
  baseline: string;
};

function rowToBaseline(r: Omit<BalanzaSucursalMatrixRow, 'baseline'>): string {
  return JSON.stringify({
    inheritFromTenant: r.inheritFromTenant,
    templates: r.templates,
    unidadTemplate: r.unidadTemplate,
    importeTemplate: r.importeTemplate,
  });
}

function effectiveToRow(
  s: { sucursal_id: string; nombre: string; codigo: string; effective_pos_prefs: PosPrefs },
  inherit: boolean,
): BalanzaSucursalMatrixRow {
  const p = s.effective_pos_prefs;
  const base = {
    sucursalId: s.sucursal_id,
    nombre: s.nombre,
    codigo: s.codigo,
    inheritFromTenant: inherit,
    templates: [p.balanzaTemplates[0] ?? '', p.balanzaTemplates[1] ?? ''] as [string, string],
    unidadTemplate: p.balanzaUnidadTemplate ?? '',
    importeTemplate: p.balanzaImporteTemplate ?? '',
  };
  return { ...base, baseline: rowToBaseline(base) };
}

function getTemplatesDraftError(templates: [string, string]): string | null {
  const raw = templates.map((s) => s.trim()).filter(Boolean);
  if (raw.length === 0) return null;
  for (const t of raw) {
    if (!normalizeBalanzaTemplates([t]).length) {
      return 'Plantilla de peso inválida (8-14 caracteres; X y A).';
    }
  }
  return null;
}

type Props = {
  arcaConfigurado: boolean;
  disabled?: boolean;
  onError: (msg: string | null) => void;
  onSaved?: () => void;
};

export function BalanzaPorSucursalMatrix({ arcaConfigurado, disabled, onError, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tenantPosPrefs, setTenantPosPrefs] = useState<PosPrefs>(() => normalizePosPrefs({}));
  const [rows, setRows] = useState<BalanzaSucursalMatrixRow[]>([]);
  const [previewCodigo, setPreviewCodigo] = useState('');
  const [previewSucursalId, setPreviewSucursalId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    onError(null);
    const res = await fetch('/api/configuracion/pos-prefs/balanza-sucursales', { cache: 'no-store' });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      tenant_pos_prefs?: PosPrefs;
      sucursales?: {
        sucursal_id: string;
        nombre: string;
        codigo: string;
        balanza_override: boolean;
        effective_pos_prefs: PosPrefs;
      }[];
    };
    setLoading(false);
    if (!res.ok) {
      onError(typeof json.error === 'string' ? json.error : 'No se pudo cargar la configuración por sucursal.');
      return;
    }
    setTenantPosPrefs(normalizePosPrefs(json.tenant_pos_prefs));
    const list = (json.sucursales ?? []).map((s) =>
      effectiveToRow(s, !s.balanza_override),
    );
    setRows(list);
    if (list.length > 0 && !previewSucursalId) setPreviewSucursalId(list[0].sucursalId);
  }, [onError, previewSucursalId]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirtyCount = rows.filter((r) => rowToBaseline(r) !== r.baseline).length;

  function updateRow(sucursalId: string, patch: Partial<BalanzaSucursalMatrixRow>) {
    setRows((prev) =>
      prev.map((r) => (r.sucursalId === sucursalId ? { ...r, ...patch, inheritFromTenant: false } : r)),
    );
  }

  const previewRow = rows.find((r) => r.sucursalId === previewSucursalId);
  const previewParse = previewRow && previewCodigo.trim()
    ? (() => {
        if (previewRow.inheritFromTenant) {
          const t = tenantPosPrefs;
          return parseBarcode(previewCodigo.trim(), {
            templates: normalizeBalanzaTemplates(t.balanzaTemplates),
            unidadTemplate: normalizeBalanzaUnidadTemplate(t.balanzaUnidadTemplate),
            importeTemplate: normalizeBalanzaImporteTemplate(t.balanzaImporteTemplate),
          });
        }
        const templates = normalizeBalanzaTemplates(
          previewRow.templates.map((s) => s.trim()).filter(Boolean),
        );
        return parseBarcode(previewCodigo.trim(), {
          templates,
          unidadTemplate: normalizeBalanzaUnidadTemplate(previewRow.unidadTemplate.trim() || null),
          importeTemplate: normalizeBalanzaImporteTemplate(previewRow.importeTemplate.trim() || null),
        });
      })()
    : null;

  async function saveAll() {
    onError(null);
    for (const row of rows) {
      if (rowToBaseline(row) === row.baseline) continue;
      if (!row.inheritFromTenant) {
        const tplErr = getTemplatesDraftError(row.templates);
        if (tplErr) {
          onError(`${row.nombre}: ${tplErr}`);
          return;
        }
        const u = row.unidadTemplate.trim();
        if (u && !normalizeBalanzaUnidadTemplate(u)) {
          onError(`${row.nombre}: plantilla por unidad inválida.`);
          return;
        }
        const i = row.importeTemplate.trim();
        if (i && !normalizeBalanzaImporteTemplate(i)) {
          onError(`${row.nombre}: plantilla por importe inválida.`);
          return;
        }
      }
    }

    setSaving(true);
    const tenantNorm = finalizePosPrefsForStorage(tenantPosPrefs);
    let failMsg: string | null = null;

    for (const row of rows) {
      if (rowToBaseline(row) === row.baseline) continue;

      if (row.inheritFromTenant) {
        const res = await fetch('/api/configuracion/pos-prefs', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sucursal_id: row.sucursalId, inherit_from_tenant: true }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          failMsg = json.error ?? `No se pudo resetear ${row.nombre}.`;
          break;
        }
        continue;
      }

      const slots = row.templates.map((s) => s.trim()).filter(Boolean).slice(0, BALANZA_TEMPLATES_MAX);
      const body = finalizePosPrefsForStorage(
        clampPosPrefsForArca(
          normalizePosPrefs({
            ...tenantNorm,
            balanzaTemplate: slots[0] ?? null,
            balanzaTemplates: slots,
            balanzaUnidadTemplate: row.unidadTemplate.trim() || null,
            balanzaImporteTemplate: row.importeTemplate.trim() || null,
          }),
          arcaConfigurado,
        ),
      );

      const res = await fetch('/api/configuracion/pos-prefs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sucursal_id: row.sucursalId, pos_prefs: body }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        inherited?: boolean;
        effective_balanza_templates?: string[];
      };
      if (!res.ok || json.inherited === true) {
        failMsg =
          json.error ??
          (json.inherited
            ? `${row.nombre}: no se guardó (igual al negocio o plantilla inválida).`
            : `No se pudo guardar ${row.nombre}.`);
        break;
      }
    }

    setSaving(false);
    if (failMsg) {
      onError(failMsg);
      return;
    }
    await load();
    onSaved?.();
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Cargando asignación por sucursal…</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground rounded-md border border-dashed px-3 py-2">
        No hay sucursales cargadas. Creá al menos una sucursal en esta pantalla.
      </p>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-primary/25 bg-primary/5 p-4">
      <div>
        <p className="text-sm font-medium text-foreground">Asignación de formato por sucursal</p>
        <p className="text-xs text-muted-foreground mt-1">
          Cada fila es lo que usa el POS en esa sucursal. Vacío en peso = formato estándar argentino (13 dígitos).
          Marcá «Heredar negocio» para usar el default de arriba (pestaña Negocio).
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[720px]">
          <thead>
            <tr className="text-left text-muted-foreground border-b">
              <th className="py-2 pr-3 font-medium">Sucursal</th>
              <th className="py-2 pr-3 font-medium">Peso (principal)</th>
              <th className="py-2 pr-3 font-medium">2.ª peso</th>
              <th className="py-2 pr-3 font-medium">Unidad</th>
              <th className="py-2 pr-3 font-medium">Importe</th>
              <th className="py-2 font-medium w-28">Heredar negocio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.sucursalId} className="border-b border-border/60 align-top">
                <td className="py-2 pr-3 whitespace-nowrap">
                  <span className="font-medium text-foreground">{row.nombre}</span>
                  <span className="block text-xs text-muted-foreground font-mono">{row.codigo}</span>
                </td>
                <td className="py-2 pr-3">
                  <Input
                    value={row.templates[0]}
                    onChange={(e) =>
                      updateRow(row.sucursalId, {
                        templates: [e.target.value, row.templates[1]],
                      })
                    }
                    disabled={disabled || saving || row.inheritFromTenant}
                    className="font-mono text-xs h-8 min-w-[140px]"
                    placeholder="2?XXXXXAAAAA?"
                    spellCheck={false}
                  />
                </td>
                <td className="py-2 pr-3">
                  <Input
                    value={row.templates[1]}
                    onChange={(e) =>
                      updateRow(row.sucursalId, {
                        templates: [row.templates[0], e.target.value],
                      })
                    }
                    disabled={disabled || saving || row.inheritFromTenant}
                    className="font-mono text-xs h-8 min-w-[120px]"
                    placeholder="Opcional"
                    spellCheck={false}
                  />
                </td>
                <td className="py-2 pr-3">
                  <Input
                    value={row.unidadTemplate}
                    onChange={(e) => updateRow(row.sucursalId, { unidadTemplate: e.target.value })}
                    disabled={disabled || saving || row.inheritFromTenant}
                    className="font-mono text-xs h-8 min-w-[120px]"
                    placeholder="21XXXXXUUUUU?"
                    spellCheck={false}
                  />
                </td>
                <td className="py-2 pr-3">
                  <Input
                    value={row.importeTemplate}
                    onChange={(e) => updateRow(row.sucursalId, { importeTemplate: e.target.value })}
                    disabled={disabled || saving || row.inheritFromTenant}
                    className="font-mono text-xs h-8 min-w-[120px]"
                    placeholder="2XXXXX?IIIII?"
                    spellCheck={false}
                  />
                </td>
                <td className="py-2">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={row.inheritFromTenant}
                      disabled={disabled || saving}
                      className="size-4 rounded border-input"
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setRows((prev) =>
                          prev.map((r) => {
                            if (r.sucursalId !== row.sucursalId) return r;
                            if (checked) {
                              const t = tenantPosPrefs;
                              const next = {
                                ...r,
                                inheritFromTenant: true,
                                templates: [t.balanzaTemplates[0] ?? '', t.balanzaTemplates[1] ?? ''] as [
                                  string,
                                  string,
                                ],
                                unidadTemplate: t.balanzaUnidadTemplate ?? '',
                                importeTemplate: t.balanzaImporteTemplate ?? '',
                              };
                              return next;
                            }
                            return { ...r, inheritFromTenant: false };
                          }),
                        );
                      }}
                    />
                    Heredar
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={disabled || saving || dirtyCount === 0} onClick={() => void saveAll()}>
          {saving ? 'Guardando…' : dirtyCount > 0 ? `Guardar asignaciones (${dirtyCount})` : 'Sin cambios'}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled || saving} onClick={() => void load()}>
          Recargar
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,200px)_1fr] max-w-2xl border-t pt-3">
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Probar en sucursal</span>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={previewSucursalId}
            onChange={(e) => setPreviewSucursalId(e.target.value)}
          >
            {rows.map((r) => (
              <option key={r.sucursalId} value={r.sucursalId}>
                {r.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Código de balanza</span>
          <Input
            value={previewCodigo}
            onChange={(e) => setPreviewCodigo(e.target.value)}
            className="font-mono h-8"
            placeholder="Ej. 2001680002556"
            spellCheck={false}
          />
        </label>
        {previewCodigo.trim() ? (
          <p className="sm:col-span-2 text-xs font-mono text-muted-foreground">
            {previewParse
              ? `tipo=${previewParse.tipo} lookup=${previewParse.codigoLookup || '—'}${
                  previewParse.pesoKg != null ? ` pesoKg=${previewParse.pesoKg}` : ''
                }${previewParse.cantidadUnidades != null ? ` unidades=${previewParse.cantidadUnidades}` : ''}${
                  previewParse.importePesos != null ? ` importe=${previewParse.importePesos}` : ''
                }`
              : 'Sin resultado'}
          </p>
        ) : null}
      </div>
    </div>
  );
}
