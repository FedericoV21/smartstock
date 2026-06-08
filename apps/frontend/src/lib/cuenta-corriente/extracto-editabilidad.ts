import { validarComprobanteLiquidable } from '@/lib/cuenta-corriente/liquidar-items-dia';
import type { ComprobanteExtractoRow, ExtractoLineaDto } from '@/lib/cuenta-corriente/extracto';
import { hoyEnAR } from '@/lib/utils/formatters';

export type ExtractoLineaConEdicion = ExtractoLineaDto & {
  editable: boolean;
  editable_motivo: string | null;
  sucursal_id: string | null;
};

export function enriquecerLineasExtractoEditables(opts: {
  lineas: ExtractoLineaDto[];
  comprobantes: ComprobanteExtractoRow[];
  /** Sucursal del filtro activo; si es null se usa liquidacionPorSucursal por comprobante. */
  liquidacionHabilitada: boolean;
  liquidacionPorSucursal?: Record<string, boolean>;
  puedeEditar: boolean;
  fechaHoy?: string;
}): ExtractoLineaConEdicion[] {
  const fechaHoy = opts.fechaHoy ?? hoyEnAR();
  const compById = new Map(opts.comprobantes.map((c) => [c.id, c]));

  return opts.lineas.map((l) => {
    if (!opts.puedeEditar) {
      return { ...l, editable: false, editable_motivo: null, sucursal_id: null };
    }

    if (l.tipo === 'pago' && l.pago_id) {
      return {
        ...l,
        editable: true,
        editable_motivo: null,
        sucursal_id: null,
      };
    }

    if ((l.tipo === 'cargo' || l.tipo === 'nota_credito') && l.comprobante_id) {
      const comp = compById.get(l.comprobante_id);
      if (!comp) {
        return {
          ...l,
          editable: false,
          editable_motivo: 'Comprobante no disponible.',
          sucursal_id: null,
        };
      }
      const liqSucursal =
        opts.liquidacionHabilitada ||
        opts.liquidacionPorSucursal?.[comp.sucursal_id] === true;
      if (!liqSucursal) {
        return {
          ...l,
          editable: false,
          editable_motivo: 'Activá «Liquidar precios del día» en preferencias de la sucursal.',
          sucursal_id: comp.sucursal_id,
        };
      }
      const val = validarComprobanteLiquidable({
        fechaHoy,
        sucursalId: comp.sucursal_id,
        comprobante: {
          fecha: comp.fecha,
          metodo_pago: comp.metodo_pago,
          estado: comp.estado ?? 'emitido',
          tipo: comp.tipo,
          cae: comp.cae ?? null,
          sucursal_id: comp.sucursal_id,
        },
      });
      if (!val.ok) {
        return {
          ...l,
          editable: false,
          editable_motivo: val.error,
          sucursal_id: comp.sucursal_id,
        };
      }
      if (l.tipo === 'nota_credito') {
        return {
          ...l,
          editable: false,
          editable_motivo: 'Las notas de crédito no se editan desde el extracto.',
          sucursal_id: comp.sucursal_id,
        };
      }
      return {
        ...l,
        editable: true,
        editable_motivo: null,
        sucursal_id: comp.sucursal_id,
      };
    }

    return { ...l, editable: false, editable_motivo: null, sucursal_id: null };
  });
}
