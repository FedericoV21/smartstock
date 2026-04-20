'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useModulos } from '@/hooks/useModulos';
import {
  clampPosPrefsForArca,
  loadPosPrefs,
  normalizePosPrefs,
  savePosPrefs,
  type PosPrefs,
} from '@/lib/pos/prefs';

type TenantData = {
  id: string;
  nombre: string;
  razon_social: string | null;
  cuit: string | null;
  domicilio: string | null;
  telefono: string | null;
  horarios_atencion: string | null;
  email: string | null;
  condicion_iva: string | null;
  punto_de_venta: number;
  plan: string;
  logo_url: string | null;
  arca_configurado?: boolean;
};

const CONDICION_IVA_LABELS: Record<string, string> = {
  responsable_inscripto: 'Responsable Inscripto',
  monotributista: 'Monotributista',
  exento: 'Exento',
  consumidor_final: 'Consumidor Final',
};

export default function ConfiguracionPage() {
  const { canEdit, isAdmin } = useDashboardRole();
  const { modulos } = useModulos();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  const [nombre, setNombre] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [cuit, setCuit] = useState('');
  const [domicilio, setDomicilio] = useState('');
  const [telefono, setTelefono] = useState('');
  const [horariosAtencion, setHorariosAtencion] = useState('');
  const [email, setEmail] = useState('');
  const [condicionIva, setCondicionIva] = useState('');
  const [puntoDeVenta, setPuntoDeVenta] = useState('1');

  // POS preferences (localStorage)
  const [posPrefs, setPosPrefs] = useState<PosPrefs>(() => loadPosPrefs());

  function updatePosPrefs(partial: Partial<PosPrefs>) {
    setPosPrefs((prev) => {
      const updated = normalizePosPrefs({ ...prev, ...partial });
      savePosPrefs(updated);
      return updated;
    });
  }

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/configuracion/tenant');
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? 'Error al cargar');
    } else {
      setError(null);
      setTenant(json);
      setPosPrefs((prev) => {
        const clamped = clampPosPrefsForArca(prev, json.arca_configurado === true);
        if (JSON.stringify(normalizePosPrefs(prev)) !== JSON.stringify(clamped)) {
          savePosPrefs(clamped);
          return clamped;
        }
        return prev;
      });
      setNombre(json.nombre ?? '');
      setRazonSocial(json.razon_social ?? '');
      setCuit(json.cuit ?? '');
      setDomicilio(json.domicilio ?? '');
      setTelefono(json.telefono ?? '');
      setHorariosAtencion(json.horarios_atencion ?? '');
      setEmail(json.email ?? '');
      setCondicionIva(json.condicion_iva ?? '');
      setPuntoDeVenta(String(json.punto_de_venta ?? 1));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleLogoFile(file: File | null) {
    if (!file || !isAdmin) return;
    setLogoError(null);
    setLogoUploading(true);
    const fd = new FormData();
    fd.set('file', file);
    const res = await fetch('/api/configuracion/logo', { method: 'POST', body: fd });
    const json = await res.json().catch(() => ({}));
    setLogoUploading(false);
    if (!res.ok) {
      setLogoError(typeof json.error === 'string' ? json.error : 'No se pudo subir el logo');
      return;
    }
    await load();
  }

  async function handleLogoRemove() {
    if (!isAdmin) return;
    setLogoError(null);
    setLogoUploading(true);
    const res = await fetch('/api/configuracion/logo', { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    setLogoUploading(false);
    if (!res.ok) {
      setLogoError(typeof json.error === 'string' ? json.error : 'No se pudo quitar el logo');
      return;
    }
    await load();
  }

  async function handleSave() {
    if (!nombre.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(false);

    const res = await fetch('/api/configuracion/tenant', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: nombre.trim(),
        razon_social: razonSocial || null,
        cuit: cuit || null,
        domicilio: domicilio || null,
        telefono: telefono || null,
        horarios_atencion: horariosAtencion || null,
        email: email || null,
        condicion_iva: condicionIva || null,
        punto_de_venta: parseInt(puntoDeVenta) || 1,
      }),
    });

    const json = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(json.error ?? 'Error al guardar');
      return;
    }

    setEditMode(false);
    setSuccess(true);
    await load();
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configuración</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Datos fiscales y de contacto de tu negocio. Los fiscales se usan en comprobantes.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {success ? (
        <p className="text-sm text-emerald-600">Datos guardados correctamente.</p>
      ) : null}

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">Datos del negocio</h2>
          {canEdit && !editMode ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEditMode(true);
                setSuccess(false);
              }}
            >
              Editar
            </Button>
          ) : null}
        </div>

        {editMode ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span className="text-muted-foreground">Nombre del negocio *</span>
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span className="text-muted-foreground">Razón social</span>
              <Input
                value={razonSocial}
                onChange={(e) => setRazonSocial(e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">CUIT</span>
              <Input value={cuit} onChange={(e) => setCuit(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Condición IVA</span>
              <select
                value={condicionIva}
                onChange={(e) => setCondicionIva(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Seleccionar…</option>
                <option value="responsable_inscripto">
                  Responsable Inscripto
                </option>
                <option value="monotributista">Monotributista</option>
                <option value="exento">Exento</option>
                <option value="consumidor_final">Consumidor Final</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span className="text-muted-foreground">Domicilio</span>
              <Input
                value={domicilio}
                onChange={(e) => setDomicilio(e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span className="text-muted-foreground">Número de teléfono</span>
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="Ej. 11 2345-6789"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span className="text-muted-foreground">Horarios de atención</span>
              <textarea
                value={horariosAtencion}
                onChange={(e) => setHorariosAtencion(e.target.value)}
                placeholder="Ej. Lun a Vie 9–18 hs, Sáb 9–13 hs"
                rows={3}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span className="text-muted-foreground">Email</span>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Punto de venta</span>
              <Input
                type="number"
                min={1}
                value={puntoDeVenta}
                onChange={(e) => setPuntoDeVenta(e.target.value)}
              />
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditMode(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={saving || !nombre.trim()}
                onClick={() => void handleSave()}
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </div>
        ) : (
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Nombre del negocio</dt>
              <dd className="font-medium">{tenant?.nombre ?? '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Razón social</dt>
              <dd>{tenant?.razon_social ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">CUIT</dt>
              <dd className="font-mono">{tenant?.cuit ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Condición IVA</dt>
              <dd>
                {tenant?.condicion_iva
                  ? (CONDICION_IVA_LABELS[tenant.condicion_iva] ??
                    tenant.condicion_iva)
                  : '—'}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Domicilio</dt>
              <dd>{tenant?.domicilio ?? '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Número de teléfono</dt>
              <dd>{tenant?.telefono ?? '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Horarios de atención</dt>
              <dd className="whitespace-pre-wrap">{tenant?.horarios_atencion ?? '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Email</dt>
              <dd>{tenant?.email ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Punto de venta</dt>
              <dd className="font-mono">{tenant?.punto_de_venta ?? 1}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Plan</dt>
              <dd>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {tenant?.plan === 'completo'
                    ? 'Plan Completo'
                    : 'Plan Base'}
                </span>
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="font-medium">Logo en tickets (POS)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          PNG con fondo transparente o imagen con fondo blanco (también JPG o WebP). Se muestra arriba del nombre en el ticket térmico. Máximo 2 MB.
        </p>
        {logoError ? <p className="mt-2 text-sm text-destructive">{logoError}</p> : null}
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div
            className="flex h-24 w-40 items-center justify-center rounded-lg border bg-muted/40"
            style={{
              backgroundImage:
                'linear-gradient(45deg, #e5e5e5 25%, transparent 25%), linear-gradient(-45deg, #e5e5e5 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e5e5 75%), linear-gradient(-45deg, transparent 75%, #e5e5e5 75%)',
              backgroundSize: '12px 12px',
              backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
            }}
          >
            {tenant?.logo_url ? (
              <img
                src={tenant.logo_url}
                alt="Logo actual"
                className="max-h-[5.5rem] max-w-[9.5rem] object-contain"
              />
            ) : (
              <span className="text-xs text-muted-foreground px-2 text-center">Sin logo</span>
            )}
          </div>
          {isAdmin ? (
            <div className="flex flex-wrap gap-2">
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  e.target.value = '';
                  void handleLogoFile(f);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={logoUploading}
                onClick={() => logoInputRef.current?.click()}
              >
                {logoUploading ? 'Subiendo…' : tenant?.logo_url ? 'Cambiar logo' : 'Subir logo'}
              </Button>
              {tenant?.logo_url ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={logoUploading}
                  onClick={() => void handleLogoRemove()}
                >
                  Quitar
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Solo el administrador puede subir el logo.</p>
          )}
        </div>
      </section>

      {modulos.facturador_pos && (
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="font-medium mb-4">Preferencias POS</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Estas preferencias se guardan en este dispositivo (no en el servidor).
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={posPrefs.sonidos}
                onChange={(e) => updatePosPrefs({ sonidos: e.target.checked })}
                className="size-4 rounded border-input"
              />
              Sonidos de confirmación y error
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Ancho de ticket térmico</span>
              <Select
                value={posPrefs.anchoTicket}
                onValueChange={(v) => updatePosPrefs({ anchoTicket: v as '80mm' | '57mm' })}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="80mm">80 mm</SelectItem>
                  <SelectItem value="57mm">57 mm</SelectItem>
                </SelectContent>
              </Select>
            </label>

            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={posPrefs.stockBloqueante}
                onChange={(e) => updatePosPrefs({ stockBloqueante: e.target.checked })}
                className="size-4 rounded border-input"
              />
              Bloquear ventas sin stock suficiente
            </label>

            <div className="sm:col-span-2 border-t pt-4 mt-1 space-y-3">
              <p className="text-sm font-medium">Tipo de comprobante en el POS</p>
              <p className="text-xs text-muted-foreground">
                Definí si en esta caja podés cobrar en ticket, en factura (blanco) o ambos, y cuál se elige al abrir el POS.
              </p>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={posPrefs.aceptaTicket}
                  onChange={(e) => updatePosPrefs({ aceptaTicket: e.target.checked })}
                  className="size-4 rounded border-input"
                />
                Permitir cobrar en ticket
              </label>
              <label
                className={`flex items-center gap-3 text-sm ${!tenant?.arca_configurado ? 'opacity-80' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={posPrefs.aceptaFactura}
                  disabled={!tenant?.arca_configurado}
                  onChange={(e) => updatePosPrefs({ aceptaFactura: e.target.checked })}
                  className="size-4 rounded border-input disabled:cursor-not-allowed"
                />
                Permitir cobrar en factura (blanco)
              </label>
              {!tenant?.arca_configurado ? (
                <p className="text-xs text-muted-foreground pl-7 -mt-2">
                  {modulos.facturador_arca ? (
                    <>
                      Configurá certificado y datos de ARCA / AFIP en{' '}
                      <Link href="/configuracion/arca" className="underline text-primary">
                        Facturación electrónica (ARCA)
                      </Link>{' '}
                      para poder habilitar facturas en el POS.
                    </>
                  ) : (
                    <>
                      La facturación electrónica ARCA no está incluida en tu plan; en el POS solo podés cobrar en ticket hasta activar ese módulo.
                    </>
                  )}
                </p>
              ) : null}
              <label className="grid gap-1 text-sm max-w-xs">
                <span className="text-muted-foreground">Comprobante por defecto al abrir el POS</span>
                <Select
                  value={posPrefs.comprobantePredeterminado}
                  onValueChange={(v) =>
                    updatePosPrefs({ comprobantePredeterminado: v as 'ticket' | 'factura' })
                  }
                  disabled={!posPrefs.aceptaTicket || !posPrefs.aceptaFactura}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {posPrefs.aceptaTicket ? (
                      <SelectItem value="ticket">Ticket</SelectItem>
                    ) : null}
                    {posPrefs.aceptaFactura ? (
                      <SelectItem value="factura">Factura (blanco)</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
                {!posPrefs.aceptaTicket || !posPrefs.aceptaFactura ? (
                  <span className="text-xs text-muted-foreground">
                    Solo aplica cuando ambos tipos están habilitados; si hay uno solo, el POS usa ese.
                  </span>
                ) : null}
              </label>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
