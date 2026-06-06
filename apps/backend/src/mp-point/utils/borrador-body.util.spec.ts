import { TipoComprobante } from '../../facturacion/enums/tipo-comprobante.enum';
import { ComprobanteItem } from '../../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../../facturacion/enums/estado-comprobante.enum';
import { buildEmitDtoFromBorrador } from './borrador-body.util';

describe('buildEmitDtoFromBorrador', () => {
  const tenantId = '00000000-0000-4000-8000-000000000001';
  const comprobanteId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  it('arma DTO desde borrador pendiente_posnet con metodo posnet_mp', async () => {
    const comprobanteRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: comprobanteId,
        tenantId,
        sucursalId: 's1',
        estado: EstadoComprobante.pendiente_posnet,
        tipo: TipoComprobante.ticket,
        clienteId: null,
        ivaPorcentaje: '21',
        medioPagoOpcionId: null,
        cajaId: 'caja-1',
        notas: 'test',
      } as Comprobante),
    };
    const itemRepo = {
      find: jest.fn().mockResolvedValue([
        {
          productoId: 'p1',
          cantidad: '2',
          precioUnitario: '100',
        } as ComprobanteItem,
      ]),
    };

    const dto = await buildEmitDtoFromBorrador(
      comprobanteRepo as never,
      itemRepo as never,
      tenantId,
      comprobanteId,
    );

    expect(dto).toMatchObject({
      tipo: TipoComprobante.ticket,
      sucursalId: 's1',
      metodoPago: 'posnet_mp',
      items: [{ productoId: 'p1', cantidad: 2, precioUnitario: 100 }],
    });
  });

  it('retorna null si comprobante no existe para el tenant', async () => {
    const comprobanteRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const dto = await buildEmitDtoFromBorrador(
      comprobanteRepo as never,
      { find: jest.fn() } as never,
      tenantId,
      comprobanteId,
    );
    expect(dto).toBeNull();
  });

  it('retorna null sin items', async () => {
    const comprobanteRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: comprobanteId,
        tenantId,
        estado: EstadoComprobante.borrador,
        tipo: TipoComprobante.ticket,
      } as Comprobante),
    };
    const dto = await buildEmitDtoFromBorrador(
      comprobanteRepo as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      tenantId,
      comprobanteId,
    );
    expect(dto).toBeNull();
  });
});
