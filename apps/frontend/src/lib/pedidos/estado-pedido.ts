/** Etiquetas de UI. `entregado` se muestra como «Enviado» (envío/entrega completada). */
export const PEDIDO_ESTADO_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  confirmado: 'Confirmado',
  entregado: 'Enviado',
  cancelado: 'Cancelado',
};

/** Alineado con `TRANSICIONES_VALIDAS` en `api/pedidos/[id]/estado`. */
export const PEDIDO_ESTADOS_TRANSICION: Record<string, string[]> = {
  borrador: ['confirmado', 'cancelado'],
  confirmado: ['entregado', 'cancelado'],
  entregado: [],
  cancelado: [],
};

/** Estado actual + estados a los que se puede pasar (para armar el `<select>`). */
export function pedidoValoresSelectEstado(estado: string): string[] {
  const sig = PEDIDO_ESTADOS_TRANSICION[estado] ?? [];
  if (sig.length === 0) return [estado];
  return [estado, ...sig];
}
