'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/hooks/use-confirm';
import type { Tables } from '@/types/database';

type Cliente = Tables<'cliente'>;

type SucursalOpt = { id: string; nombre: string; activa?: boolean | null };

const CONDICION_IVA_LABELS: Record<string, string> = {
  responsable_inscripto: 'Responsable Inscripto',
  monotributista: 'Monotributista',
  exento: 'Exento',
  consumidor_final: 'Consumidor Final',
};

export function ClienteDetalleClient({
  cliente,
  sucursalIdsIniciales,
}: {
  cliente: Cliente;
  sucursalIdsIniciales: string[];
}) {
  const { canEdit } = useDashboardRole();
  const { confirm: openConfirm, ConfirmDialog } = useConfirm();
  const router = useRouter();
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nombre, setNombre] = useState(cliente.nombre);
  const [razonSocial, setRazonSocial] = useState(cliente.razon_social ?? '');
  const [cuitDni, setCuitDni] = useState(cliente.cuit_dni ?? '');
  const [documentoFiscalTipo, setDocumentoFiscalTipo] = useState(
    cliente.documento_fiscal_tipo ?? '',
  );
  const [condicionIva, setCondicionIva] = useState(cliente.condicion_iva ?? '');
  const [direccion, setDireccion] = useState(cliente.direccion ?? '');
  const [telefono, setTelefono] = useState(cliente.telefono ?? '');
  const [email, setEmail] = useState(cliente.email ?? '');
  const [notas, setNotas] = useState(cliente.notas ?? '');

  const [sucursalesLista, setSucursalesLista] = useState<SucursalOpt[]>([]);
  const [cargandoSucursales, setCargandoSucursales] = useState(true);
  const [sucSeleccionadas, setSucSeleccionadas] = useState<Set<string>>(
    () => new Set(sucursalIdsIniciales),
  );

  useEffect(() => {
    setSucSeleccionadas(new Set(sucursalIdsIniciales));
  }, [sucursalIdsIniciales]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCargandoSucursales(true);
      const res = await fetch('/api/configuracion/sucursales');
      if (!res.ok) {
        setCargandoSucursales(false);
        return;
      }
      const j = (await res.json()) as { sucursales?: SucursalOpt[] };
      if (!cancelled && Array.isArray(j.sucursales)) {
        setSucursalesLista(j.sucursales);
      }
      setCargandoSucursales(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const textoSucursalesVista = useMemo(() => {
    const ids = sucursalIdsIniciales.filter(Boolean);
    if (!ids.length) return '—';
    if (!sucursalesLista.length && cargandoSucursales) return '…';
    return ids
      .map((sid) => {
        const row = sucursalesLista.find((s) => s.id === sid);
        return row ? row.nombre : sid;
      })
      .join(', ');
  }, [sucursalIdsIniciales, sucursalesLista, cargandoSucursales]);

  function toggleSucursal(id: string, checked: boolean) {
    setSucSeleccionadas((prev) => {
      const n = new Set(prev);
      if (checked) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  async function save() {
    const idsSel = [...sucSeleccionadas].filter(Boolean);
    if (idsSel.length === 0) {
      setError('Debés seleccionar al menos una sucursal.');
      return;
    }

    setSaving(true);
    setError(null);
    const res = await fetch(`/api/clientes/${cliente.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: nombre.trim(),
        razon_social: razonSocial || null,
        cuit_dni: cuitDni || null,
        documento_fiscal_tipo: documentoFiscalTipo === '' ? null : documentoFiscalTipo,
        condicion_iva: condicionIva || null,
        direccion: direccion || null,
        telefono: telefono || null,
        email: email || null,
        notas: notas || null,
        sucursal_ids: idsSel,
      }),
    });
    const json = (await res.json()) as { error?: string };
    setSaving(false);
    if (!res.ok) {
      setError(json.error ?? 'Error al guardar');
      return;
    }
    setEditMode(false);
    router.refresh();
  }

  async function handleDeactivate() {
    const ok = await openConfirm({
      title: 'Desactivar cliente',
      description: `¿Desactivar el cliente «${cliente.nombre}»?`,
      confirmLabel: 'Desactivar',
      cancelLabel: 'Cancelar',
      confirmVariant: 'destructive',
    });
    if (!ok) return;
    const res = await fetch(`/api/clientes/${cliente.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo: false }),
    });
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      setError(json.error ?? 'Error');
      return;
    }
    router.refresh();
  }

  async function handleActivate() {
    const res = await fetch(`/api/clientes/${cliente.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo: true }),
    });
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      setError(json.error ?? 'Error');
      return;
    }
    router.refresh();
  }

  const sucParaCheckboxes = sucursalesLista.filter((s) => s.activa !== false);

  return (
    <>
      {ConfirmDialog}
      <div className="space-y-6">
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">Datos del cliente</h2>
          <div className="flex gap-2">
            {canEdit && !editMode ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditMode(true)}
                >
                  Editar
                </Button>
                {cliente.activo ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => void handleDeactivate()}
                  >
                    Desactivar
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleActivate()}
                  >
                    Reactivar
                  </Button>
                )}
              </>
            ) : null}
          </div>
        </div>

        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}

        {editMode ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span className="text-muted-foreground">Nombre *</span>
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span className="text-muted-foreground">Razón social</span>
              <Input value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">CUIT / DNI</span>
              <Input value={cuitDni} onChange={(e) => setCuitDni(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Tipo de documento (AFIP)</span>
              <select
                value={documentoFiscalTipo}
                onChange={(e) => setDocumentoFiscalTipo(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Automático (según cantidad de dígitos)</option>
                <option value="cuit">CUIT (código 80)</option>
                <option value="dni">DNI (código 96)</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Condición IVA</span>
              <select
                value={condicionIva}
                onChange={(e) => setCondicionIva(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Seleccionar…</option>
                <option value="responsable_inscripto">Responsable Inscripto</option>
                <option value="monotributista">Monotributista</option>
                <option value="exento">Exento</option>
                <option value="consumidor_final">Consumidor Final</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span className="text-muted-foreground">Dirección</span>
              <Input value={direccion} onChange={(e) => setDireccion(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Teléfono</span>
              <Input value={telefono} onChange={(e) => setTelefono(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Email</span>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span className="text-muted-foreground">Notas</span>
              <Input value={notas} onChange={(e) => setNotas(e.target.value)} />
            </label>

            <div className="sm:col-span-2 rounded-lg border border-dashed bg-muted/20 p-3">
              <p className="mb-2 text-sm font-medium">Sucursales donde puede operar</p>
              <p className="mb-3 text-xs text-muted-foreground">
                El mismo cliente y la misma cuenta corriente (un solo saldo) quedan disponibles en el
                punto de venta y facturación de cada sucursal marcada.
              </p>
              {cargandoSucursales ? (
                <p className="text-sm text-muted-foreground">Cargando sucursales…</p>
              ) : sucParaCheckboxes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay sucursales configuradas.</p>
              ) : (
                <ul className="space-y-2">
                  {sucParaCheckboxes.map((s) => (
                    <li key={s.id}>
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={sucSeleccionadas.has(s.id)}
                          onChange={(e) => toggleSucursal(s.id, e.target.checked)}
                          className="size-4 rounded border-input"
                        />
                        {s.nombre}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex gap-2 sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setEditMode(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={saving || !nombre.trim()}
                onClick={() => void save()}
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </div>
        ) : (
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Sucursales</dt>
              <dd className="text-pretty">{textoSucursalesVista}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Nombre</dt>
              <dd className="font-medium">{cliente.nombre}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Razón social</dt>
              <dd>{cliente.razon_social ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">CUIT / DNI</dt>
              <dd className="font-mono">{cliente.cuit_dni ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Tipo doc. (facturación)</dt>
              <dd>
                {cliente.documento_fiscal_tipo === 'cuit'
                  ? 'CUIT'
                  : cliente.documento_fiscal_tipo === 'dni'
                    ? 'DNI'
                    : 'Automático'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Condición IVA</dt>
              <dd>
                {cliente.condicion_iva
                  ? (CONDICION_IVA_LABELS[cliente.condicion_iva] ?? cliente.condicion_iva)
                  : '—'}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Dirección</dt>
              <dd>{cliente.direccion ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Teléfono</dt>
              <dd>{cliente.telefono ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd>{cliente.email ?? '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Notas</dt>
              <dd className="whitespace-pre-wrap">{cliente.notas ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Estado</dt>
              <dd>
                <span
                  className={
                    cliente.activo
                      ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800'
                      : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                  }
                >
                  {cliente.activo ? 'Activo' : 'Inactivo'}
                </span>
              </dd>
            </div>
          </dl>
        )}
      </section>
      </div>
    </>
  );
}
