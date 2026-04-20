'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'smartstock_onboarding_done';

type Step = 0 | 1 | 2;

export function OnboardingWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(0);
  const [loading, setLoading] = useState(true);

  const evaluar = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(STORAGE_KEY) === '1') {
      setOpen(false);
      setLoading(false);
      return;
    }

    const [prodRes, tenantRes] = await Promise.all([
      fetch('/api/productos?pagina=1&por_pagina=1'),
      fetch('/api/configuracion/tenant'),
    ]);
    const prodJson = prodRes.ok ? await prodRes.json() : { total: 0 };
    const tenantJson = tenantRes.ok ? await tenantRes.json() : {};

    const totalProductos = typeof prodJson.total === 'number' ? prodJson.total : 0;
    const fiscalOk = Boolean(
      String(tenantJson.nombre ?? '').trim() &&
        String(tenantJson.razon_social ?? '').trim() &&
        String(tenantJson.cuit ?? '').trim() &&
        String(tenantJson.condicion_iva ?? '').trim()
    );

    // Los datos fiscales mínimos ya se completan en /onboarding (admin). Este asistente sugiere categorías y productos.
    const conviene = totalProductos === 0 && fiscalOk;
    setOpen(conviene);
    setLoading(false);
  }, []);

  useEffect(() => {
    void evaluar();
  }, [evaluar]);

  function cerrarDefinitivo() {
    localStorage.setItem(STORAGE_KEY, '1');
    setOpen(false);
  }

  function saltearPaso() {
    if (step < 2) {
      setStep((s) => (s + 1) as Step);
    } else {
      cerrarDefinitivo();
    }
  }

  function continuarPaso() {
    if (step < 2) {
      setStep((s) => (s + 1) as Step);
    } else {
      cerrarDefinitivo();
    }
  }

  if (loading || !open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border bg-card p-6 shadow-lg">
        <h2 id="onboarding-title" className="text-lg font-semibold">
          Primeros pasos en SmartStock
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Paso {step + 1} de 3 · Podés saltear cualquier paso o cerrar el asistente cuando quieras.
        </p>

        {step === 0 ? (
          <div className="mt-4 space-y-3 text-sm">
            <p>Completá los datos fiscales de tu negocio (razón social, CUIT y condición frente al IVA).</p>
            <Link
              href="/configuracion"
              className={cn(buttonVariants({ variant: 'outline' }))}
            >
              Ir a configuración del negocio
            </Link>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="mt-4 space-y-3 text-sm">
            <p>Creá al menos una categoría para organizar tus productos.</p>
            <Link href="/categorias" className={cn(buttonVariants({ variant: 'outline' }))}>
              Ir a categorías
            </Link>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-4 space-y-3 text-sm">
            <p>Agregá tu primer producto manualmente o importá un archivo Excel/CSV.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href="/productos/nuevo"
                className={cn(buttonVariants({ variant: 'outline' }))}
              >
                Nuevo producto
              </Link>
              <Link href="/importar" className={cn(buttonVariants({ variant: 'outline' }))}>
                Importar archivo
              </Link>
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2 border-t pt-4">
          <Button type="button" variant="ghost" onClick={saltearPaso}>
            Saltear paso
          </Button>
          <Button type="button" variant="secondary" onClick={continuarPaso}>
            {step === 2 ? 'Listo, cerrar' : 'Continuar'}
          </Button>
          <Button type="button" variant="outline" onClick={cerrarDefinitivo}>
            No volver a mostrar
          </Button>
        </div>
      </div>
    </div>
  );
}
