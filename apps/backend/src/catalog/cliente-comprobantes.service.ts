import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { CobranzaFactura } from '../cobranza/entities/cobranza-factura.entity';
import { CobranzaPago } from '../cobranza/entities/cobranza-pago.entity';
import {
  formatearNumeroComprobante,
  formatearTipoComprobante,
} from '../cobranza/utils/comprobante-formato.util';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { formatCurrencyAr } from '../cuenta-corriente/utils/format-currency.util';
import { Cliente } from './entities/cliente.entity';

const TIPOS_FACTURA = ['factura_a', 'factura_b', 'factura_c'] as const;

@Injectable()
export class ClienteComprobantesService {
  constructor(
    @InjectRepository(Cliente) private readonly clienteRepo: Repository<Cliente>,
    @InjectRepository(Comprobante) private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(CobranzaFactura) private readonly cobranzaFacturaRepo: Repository<CobranzaFactura>,
    @InjectRepository(CobranzaPago) private readonly cobranzaPagoRepo: Repository<CobranzaPago>,
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    private readonly tenantContext: TenantContext,
  ) {}

  async listComprobantes(clienteId: string) {
    const tenantId = this.tenantContext.getTenantId();
    const modulos = await this.moduloRepo.findOne({ where: { tenantId } });
    if (!modulos?.facturadorSimple && !modulos?.facturadorPos) {
      throw new ForbiddenException(
        'Activá facturación o POS para ver el historial de comprobantes.',
      );
    }

    const cliente = await this.clienteRepo.findOne({ where: { id: clienteId, tenantId } });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');

    const tipos: string[] = [];
    if (modulos.facturadorSimple) tipos.push(...TIPOS_FACTURA, 'recibo');
    if (modulos.facturadorPos) tipos.push('ticket');
    if (!tipos.length) return { items: [] };

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const pv = tenant?.puntoDeVenta ?? 1;

    const rows = await this.comprobanteRepo.find({
      where: {
        tenantId,
        clienteId,
        tipo: In(tipos),
        estado: Not(EstadoComprobante.borrador),
      },
      order: { numeroOrden: 'DESC', fecha: 'DESC', numero: 'DESC' },
      take: 120,
    });

    const compIds = rows.map((r) => r.id);
    const cobranzas =
      compIds.length > 0
        ? await this.cobranzaFacturaRepo.find({
            where: { tenantId, comprobanteId: In(compIds) },
          })
        : [];
    const cobranzaByComp = new Map(cobranzas.map((c) => [c.comprobanteId, c]));

    const reciboIds = rows.filter((r) => r.tipo === 'recibo').map((r) => r.id);
    const montoPorReciboId = new Map<string, number>();
    if (reciboIds.length > 0) {
      const pagosRecibo = await this.cobranzaPagoRepo.find({
        where: { tenantId, reciboComprobanteId: In(reciboIds) },
      });
      for (const p of pagosRecibo) {
        if (p.reciboComprobanteId) {
          montoPorReciboId.set(p.reciboComprobanteId, Number(p.monto));
        }
      }
    }

    const items = rows.map((r) => {
      const totalNormalizado =
        r.tipo === 'recibo' ? (montoPorReciboId.get(r.id) ?? Number(r.total)) : Number(r.total);
      const cobranza = cobranzaByComp.get(r.id);
      const saldoPendiente = cobranza ? Number(cobranza.saldoPendiente) : null;
      const montoOriginal = cobranza ? Number(cobranza.montoOriginal) : null;

      const esFacturaFiscal = TIPOS_FACTURA.includes(r.tipo as (typeof TIPOS_FACTURA)[number]);
      const esTicket = r.tipo === 'ticket';

      let estadoCobro: 'pendiente' | 'parcial' | 'pagada' | null = null;
      if (esFacturaFiscal || esTicket) {
        if (saldoPendiente != null && montoOriginal != null) {
          if (saldoPendiente <= 0) estadoCobro = 'pagada';
          else if (saldoPendiente < montoOriginal) estadoCobro = 'parcial';
          else estadoCobro = 'pendiente';
        } else if (esFacturaFiscal) {
          estadoCobro = 'pendiente';
        } else if (!r.metodoPago?.trim()) {
          estadoCobro = 'pendiente';
        }
      }

      return {
        id: r.id,
        tipo: r.tipo,
        tipoLabel: formatearTipoComprobante(r.tipo),
        numeroLabel: formatearNumeroComprobante(pv, r.numero),
        fecha: r.fecha,
        fechaLabel: r.fecha,
        estado: r.estado,
        estadoCobro,
        total: totalNormalizado,
        totalLabel: formatCurrencyAr(totalNormalizado),
        pdf_url: r.pdfUrl ?? null,
        categoria: r.tipo === 'ticket' ? 'ticket' : r.tipo === 'recibo' ? 'recibo' : 'factura',
      };
    });

    return { items };
  }
}
