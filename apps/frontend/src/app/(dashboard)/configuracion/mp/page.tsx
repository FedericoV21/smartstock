'use client';

import Link from 'next/link';

import { useCallback, useState } from 'react';

import { useDashboardRole } from '@/components/dashboard/dashboard-role-context';
import { MpPointConfigSection } from '@/components/configuracion/mp-point-config';
import { MpQrConfigSection } from '@/components/configuracion/mp-qr-config';
import { useConfirm } from '@/hooks/use-confirm';
import { useModulos } from '@/hooks/useModulos';
import {
  useWarnUnsavedChanges,
  UNSAVED_LEAVE_DESCRIPTION,
  UNSAVED_LEAVE_TITLE,
} from '@/hooks/useWarnUnsavedChanges';

export default function ConfiguracionMpPage() {
  const { isAdmin } = useDashboardRole();
  const { modulos } = useModulos();
  const { confirm, ConfirmDialog } = useConfirm();
  const confirmLeave = useCallback(
    () =>
      confirm({
        title: UNSAVED_LEAVE_TITLE,
        description: UNSAVED_LEAVE_DESCRIPTION,
        cancelLabel: 'Seguir editando',
        confirmLabel: 'Salir sin guardar',
        confirmVariant: 'destructive',
      }),
    [confirm],
  );
  const [pointDirty, setPointDirty] = useState(false);
  const [qrDirty, setQrDirty] = useState(false);

  useWarnUnsavedChanges(Boolean(isAdmin && modulos.facturador_pos && (pointDirty || qrDirty)), {
    confirmLeave,
  });

  if (!isAdmin) {
    return (
      <>
        {ConfirmDialog}
        <div className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">
          Solo el administrador del negocio puede configurar Mercado Pago.
        </div>
      </>
    );
  }

  if (!modulos.facturador_pos) {
    return (
      <>
        {ConfirmDialog}
        <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Link
          href="/configuracion"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Configuración
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Mercado Pago</h1>
        <p className="text-sm text-muted-foreground">
          El módulo de terminal POS no está activo en tu plan. Activá «Terminal POS con escáner» en Plan y módulos
          para configurar Point y QR.
        </p>
        <Link
          href="/configuracion/plan"
          className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Ir a Plan y módulos
        </Link>
      </div>
      </>
    );
  }

  return (
    <>
      {ConfirmDialog}
      <div className="mx-auto max-w-3xl space-y-8 p-6">
      <div>
        <Link
          href="/configuracion"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Configuración
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Mercado Pago</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Integración con <strong className="font-medium text-foreground">Point</strong> (posnet) y cobro con{' '}
          <strong className="font-medium text-foreground">QR</strong> de mostrador en el POS.
        </p>
        <Link
          href="/configuracion/pasarelas"
          className="mt-3 inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Gestionar multiples pasarelas por caja
        </Link>
      </div>

      <MpPointConfigSection onDirtyChange={setPointDirty} />
      <MpQrConfigSection onDirtyChange={setQrDirty} />
      </div>
    </>
  );
}
