import { EmitirComprobanteClient } from '@/app/(dashboard)/facturacion/nueva/emitir-comprobante-client';

export default async function NuevaFacturacionPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; desde_ticket?: string }>;
}) {
  const sp = await searchParams;
  const initialTipo = sp.tipo === 'presupuesto' ? 'presupuesto' : undefined;
  const desdeTicketId =
    typeof sp.desde_ticket === 'string' && /^[0-9a-f-]{36}$/i.test(sp.desde_ticket)
      ? sp.desde_ticket
      : undefined;
  return (
    <EmitirComprobanteClient initialTipo={initialTipo} desdeTicketId={desdeTicketId} />
  );
}
