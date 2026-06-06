import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Tenant } from '../config/entities/tenant.entity';
import { TipoComprobante } from '../facturacion/enums/tipo-comprobante.enum';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { FacturacionService } from '../facturacion/facturacion.service';
import { Producto } from '../products/entities/producto.entity';
import { CobranzaPago } from './entities/cobranza-pago.entity';
import {
  formatearNumeroComprobante,
  formatearTipoComprobante,
} from './utils/comprobante-formato.util';

export type EmitirReciboResult =
  | { ok: true; comprobanteId: string; pdfUrl: string | null }
  | { ok: false; error: string };

@Injectable()
export class CobranzaReciboService {
  constructor(
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Comprobante) private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(Producto) private readonly productoRepo: Repository<Producto>,
    @InjectRepository(CobranzaPago) private readonly cobranzaPagoRepo: Repository<CobranzaPago>,
    private readonly facturacionService: FacturacionService,
    private readonly tenantContext: TenantContext,
  ) {}

  async emitirTrasPago(
    params: {
      clienteId: string;
      monto: number;
      cobranzaPagoId: string;
      comprobanteFacturaId: string;
      tipoPago: string;
      notasCobro: string | null;
    },
    userId: string,
  ): Promise<EmitirReciboResult> {
    const tenantId = this.tenantContext.getTenantId();

    const [tenant, fac, prods] = await Promise.all([
      this.tenantRepo.findOne({
        where: { id: tenantId },
        select: { puntoDeVenta: true },
      }),
      this.comprobanteRepo.findOne({
        where: { id: params.comprobanteFacturaId, tenantId },
        select: { numero: true, tipo: true },
      }),
      this.productoRepo.find({
        where: { tenantId, activo: true },
        select: { id: true },
        take: 1,
        order: { createdAt: 'ASC' },
      }),
    ]);
    const prod = prods[0];

    if (!prod?.id) {
      return {
        ok: false,
        error:
          'Para generar el PDF del recibo hace falta al menos un producto activo en el cat├ílogo (l├¡nea interna).',
      };
    }

    const pv = tenant?.puntoDeVenta ?? 1;
    const refLabel = fac
      ? `${formatearTipoComprobante(fac.tipo)} ${formatearNumeroComprobante(pv, fac.numero)}`
      : params.comprobanteFacturaId;

    const notas = [`Recibo por cobro de ${refLabel}.`, params.notasCobro?.trim() || null]
      .filter(Boolean)
      .join('\n');

    const tp = params.tipoPago.trim().toLowerCase();
    const metodoPago =
      tp === 'tarjeta' ? 'credito' : tp === 'efectivo' ? 'efectivo' : 'transferencia';

    try {
      const emit = await this.facturacionService.emitir(
        {
          tipo: TipoComprobante.recibo,
          clienteId: params.clienteId,
          items: [{ productoId: prod.id, cantidad: 1, precioUnitario: params.monto }],
          notas,
          metodoPago,
        },
        userId,
      );

      const comprobanteId = emit.data.id;
      const pdfUrl = emit.data.pdf?.pdfUrl ?? null;

      await this.cobranzaPagoRepo.update(
        { id: params.cobranzaPagoId, tenantId },
        { reciboComprobanteId: comprobanteId },
      );

      return { ok: true, comprobanteId, pdfUrl };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }
}
