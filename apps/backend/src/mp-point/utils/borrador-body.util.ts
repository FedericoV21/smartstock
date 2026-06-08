import { Repository } from 'typeorm';

import { EmitComprobanteDto } from '../../facturacion/dto/emit-comprobante.dto';
import { ComprobanteItem } from '../../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../../facturacion/enums/estado-comprobante.enum';

const ESTADOS_EMITIBLES: EstadoComprobante[] = [
  EstadoComprobante.borrador,
  EstadoComprobante.pendiente_posnet,
  EstadoComprobante.pendiente_qr,
  EstadoComprobante.pendiente_transferencia_mp,
];

export async function buildEmitDtoFromBorrador(
  comprobanteRepo: Repository<Comprobante>,
  itemRepo: Repository<ComprobanteItem>,
  tenantId: string,
  comprobanteId: string,
): Promise<EmitComprobanteDto | null> {
  const c = await comprobanteRepo.findOne({ where: { id: comprobanteId, tenantId } });
  if (!c || !ESTADOS_EMITIBLES.includes(c.estado)) return null;

  const items = await itemRepo.find({ where: { comprobanteId } });
  if (!items.length) return null;

  return {
    tipo: c.tipo,
    sucursalId: c.sucursalId ?? undefined,
    clienteId: c.clienteId,
    ivaPorcentaje: Number(c.ivaPorcentaje),
    medioPagoOpcionId: c.medioPagoOpcionId,
    metodoPago: 'posnet_mp',
    cajaId: c.cajaId,
    notas: c.notas,
    items: items.map((i) => ({
      productoId: i.productoId,
      cantidad: Number(i.cantidad),
      precioUnitario: Number(i.precioUnitario),
    })),
  };
}
