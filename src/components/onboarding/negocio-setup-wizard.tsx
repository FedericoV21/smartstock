'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const STEPS = 2;

export function NegocioSetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nombre, setNombre] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [cuit, setCuit] = useState('');
  const [condicionIva, setCondicionIva] = useState('');
  const [domicilio, setDomicilio] = useState('');
  const [telefono, setTelefono] = useState('');
  const [horariosAtencion, setHorariosAtencion] = useState('');
  const [email, setEmail] = useState('');
  const [puntoDeVenta, setPuntoDeVenta] = useState('1');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/configuracion/tenant');
    const json = await res.json();
    if (res.ok) {
      setNombre(json.nombre ?? '');
      setRazonSocial(json.razon_social ?? '');
      setCuit(json.cuit ?? '');
      setCondicionIva(json.condicion_iva ?? '');
      setDomicilio(json.domicilio ?? '');
      setTelefono(json.telefono ?? '');
      setHorariosAtencion(json.horarios_atencion ?? '');
      setEmail(json.email ?? '');
      setPuntoDeVenta(String(json.punto_de_venta ?? 1));
      setError(null);
    } else {
      setError(typeof json.error === 'string' ? json.error : 'No se pudieron cargar los datos');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function validarPaso1(): boolean {
    if (!nombre.trim()) {
      setError('Indicá el nombre del negocio.');
      return false;
    }
    if (!String(razonSocial).trim()) {
      setError('La razón social es obligatoria.');
      return false;
    }
    if (!String(cuit).trim()) {
      setError('El CUIT es obligatorio.');
      return false;
    }
    if (!String(condicionIva).trim()) {
      setError('Seleccioná la condición frente al IVA.');
      return false;
    }
    setError(null);
    return true;
  }

  async function guardarYEntrar() {
    if (!validarPaso1()) {
      setStep(0);
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch('/api/configuracion/tenant', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: nombre.trim(),
        razon_social: razonSocial.trim() || null,
        cuit: cuit.trim() || null,
        domicilio: domicilio.trim() || null,
        telefono: telefono.trim() || null,
        horarios_atencion: horariosAtencion.trim() || null,
        email: email.trim() || null,
        condicion_iva: condicionIva || null,
        punto_de_venta: parseInt(puntoDeVenta, 10) || 1,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(typeof json.error === 'string' ? json.error : 'No se pudo guardar');
      return;
    }
    router.push('/');
    router.refresh();
  }

  if (loading) {
    return (
      <div className="w-full max-w-lg py-12 text-center text-sm text-muted-foreground">
        Cargando datos del negocio…
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg">
      <div className="mb-8 text-center md:text-left">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Configuración inicial
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Tu negocio en Nexus</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Completá estos datos para usar el panel. Podés editarlos después en Mi negocio.
        </p>
      </div>

      <div className="mb-6 flex gap-2" aria-hidden>
        {Array.from({ length: STEPS }, (_, i) => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              i <= step ? 'bg-primary' : 'bg-muted'
            )}
          />
        ))}
      </div>

      {error ? (
        <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {step === 0 ? (
        <div className="space-y-4 rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="text-sm font-medium">Paso 1 de 2 · Identificación fiscal</h2>
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">Nombre del negocio *</span>
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. Distribuidora Norte"
              autoComplete="organization"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">Razón social *</span>
            <Input
              value={razonSocial}
              onChange={(e) => setRazonSocial(e.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">CUIT *</span>
              <Input value={cuit} onChange={(e) => setCuit(e.target.value)} className="font-mono" />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">Condición IVA *</span>
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
          </div>
          <div className="flex justify-end pt-2">
            <Button type="button" onClick={() => validarPaso1() && setStep(1)}>
              Continuar
            </Button>
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-4 rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="text-sm font-medium">Paso 2 de 2 · Contacto y operación</h2>
          <p className="text-xs text-muted-foreground">
            Opcional: podés dejarlo en blanco y completarlo más tarde.
          </p>
          <label className="grid gap-1.5 text-sm sm:col-span-2">
            <span className="text-muted-foreground">Domicilio</span>
            <Input value={domicilio} onChange={(e) => setDomicilio(e.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">Teléfono</span>
            <Input
              type="tel"
              inputMode="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">Email</span>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">Horarios de atención</span>
            <textarea
              value={horariosAtencion}
              onChange={(e) => setHorariosAtencion(e.target.value)}
              placeholder="Ej. Lun a Vie 9–18 hs"
              rows={3}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">Punto de venta</span>
            <Input
              type="number"
              min={1}
              value={puntoDeVenta}
              onChange={(e) => setPuntoDeVenta(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap justify-between gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setStep(0)} disabled={saving}>
              Atrás
            </Button>
            <Button type="button" onClick={() => void guardarYEntrar()} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar e ir al panel'}
            </Button>
          </div>
        </div>
      ) : null}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Cuando termines, podés cambiar estos datos en Configuración → Mi negocio.
      </p>
    </div>
  );
}
