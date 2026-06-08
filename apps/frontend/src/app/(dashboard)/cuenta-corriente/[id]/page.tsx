import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ClienteDetalleClient } from '@/app/(dashboard)/cuenta-corriente/cliente-detalle-client';
import { ClienteDetalleCuentaRefreshGroup } from '@/app/(dashboard)/cuenta-corriente/cliente-detalle-cuenta-refresh-group';
import { CuentaCorrienteCondicionesClient } from '@/app/(dashboard)/cuenta-corriente/cuenta-corriente-condiciones-client';
import { buttonVariants } from '@/components/ui/button';
import { getSessionProfile } from '@/lib/dashboard/session-profile';
import { createServerClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';

export default async function ClienteDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerClient();

  const { data: cliente, error } = await supabase
    .from('cliente')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !cliente) notFound();

  const { data: membRows } = await supabase
    .from('cliente_sucursal')
    .select('sucursal_id')
    .eq('tenant_id', cliente.tenant_id)
    .eq('cliente_id', id);

  const sucursalIdsIniciales =
    membRows?.map((r) => r.sucursal_id).filter(Boolean) ?? ([] as string[]);

  const profile = await getSessionProfile();
  const canEdit = profile ? profile.rol !== 'visor' : false;

  let showCuentaCorriente = false;
  let showCobranzaFacturas = false;
  let showHistorialComprobantes = false;
  try {
    const { data: config } = await supabase
      .from('modulo_config')
      .select('analizador_rentabilidad, facturador_simple, facturador_pos')
      .maybeSingle();
    showCuentaCorriente = !!config?.analizador_rentabilidad;
    showCobranzaFacturas = !!config?.facturador_simple;
    showHistorialComprobantes = !!(config?.facturador_simple || config?.facturador_pos);
  } catch {
    // non-critical
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/cuenta-corriente"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          ← Volver
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {cliente.razon_social || cliente.nombre}
        </h1>
      </div>

      <ClienteDetalleClient cliente={cliente} sucursalIdsIniciales={sucursalIdsIniciales} />

      <ClienteDetalleCuentaRefreshGroup
        clienteId={id}
        showHistorialComprobantes={showHistorialComprobantes}
        showCobranzaFacturas={showCobranzaFacturas}
        showCuentaCorriente={showCuentaCorriente}
        canEdit={canEdit}
      >
        {showCobranzaFacturas ? <CuentaCorrienteCondicionesClient clienteId={id} /> : null}
      </ClienteDetalleCuentaRefreshGroup>
    </div>
  );
}
