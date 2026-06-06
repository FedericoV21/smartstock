import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { CobranzaPago } from '../cobranza/entities/cobranza-pago.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Pago } from '../cuenta-corriente/entities/pago.entity';
import { TipoPago } from '../cuenta-corriente/enums/tipo-pago.enum';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { TipoComprobante } from '../facturacion/enums/tipo-comprobante.enum';
import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';
import { AnalyzerCuentaCorrientePagoDto } from './dto/analyzer-cuenta-corriente-pago.dto';

@Injectable()
export class AnalyzerCuentaCorrienteService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(CuentaCorriente) private readonly cuentaRepo: Repository<CuentaCorriente>,
    @InjectRepository(Pago) private readonly pagoRepo: Repository<Pago>,
    @InjectRepository(Comprobante) private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(CobranzaPago) private readonly cobranzaPagoRepo: Repository<CobranzaPago>,
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
  ) {}

  async getResumen(clienteId: string) {
    await this.assertAnalizadorAccess();
    const tenantId = this.tenantContext.getTenantId();

    if (!clienteId?.trim()) {
      throw new BadRequestException('cliente_id requerido');
    }

    const [cuenta, pagos, comprobantes] = await Promise.all([
      this.cuentaRepo.findOne({ where: { tenantId, clienteId: clienteId.trim() } }),
      this.pagoRepo.find({
        where: { tenantId, clienteId: clienteId.trim() },
        order: { fecha: 'DESC' },
        take: 50,
      }),
      this.comprobanteRepo.find({
        where: {
          tenantId,
          clienteId: clienteId.trim(),
          estado: EstadoComprobante.emitido,
        },
        select: {
          id: true,
          tipo: true,
          numero: true,
          total: true,
          fecha: true,
          estado: true,
        },
        order: { fecha: 'DESC' },
        take: 20,
      }),
    ]);

    const reciboIds = comprobantes
      .filter((c) => c.tipo === TipoComprobante.recibo)
      .map((c) => c.id);

    const montoPorReciboId = new Map<string, number>();
    if (reciboIds.length > 0) {
      const recibosCobranza = await this.cobranzaPagoRepo.find({
        where: { tenantId, reciboComprobanteId: In(reciboIds) },
        select: { reciboComprobanteId: true, monto: true },
      });
      for (const r of recibosCobranza) {
        if (r.reciboComprobanteId) {
          montoPorReciboId.set(r.reciboComprobanteId, Number(r.monto));
        }
      }
    }

    const comprobantesNormalizados = comprobantes.map((c) => {
      if (c.tipo !== TipoComprobante.recibo) {
        return this.serializeComprobante(c);
      }
      const montoCobrado = montoPorReciboId.get(c.id);
      if (montoCobrado == null || !Number.isFinite(montoCobrado)) {
        return this.serializeComprobante(c);
      }
      return { ...this.serializeComprobante(c), total: montoCobrado };
    });

    return {
      cuenta: cuenta ? this.serializeCuenta(cuenta) : null,
      pagos: pagos.map((p) => this.serializePago(p)),
      comprobantes: comprobantesNormalizados,
    };
  }

  async registrarPago(dto: AnalyzerCuentaCorrientePagoDto, userId: string) {
    await this.assertAnalizadorAccess();
    const tenantId = this.tenantContext.getTenantId();

    if (!dto.cliente_id?.trim() || !dto.monto || dto.monto <= 0) {
      throw new BadRequestException('cliente_id y monto (> 0) son requeridos');
    }

    const tipoPago = (dto.tipo_pago?.trim() || TipoPago.efectivo) as TipoPago;

    try {
      const rows = (await this.dataSource.query(
        `SELECT public.registrar_pago_cliente_desde_cuenta_corriente(
          $1::uuid, $2::uuid, $3::numeric, $4::public.tipo_pago, $5::text, $6::text, $7::uuid
        ) AS resultado`,
        [
          tenantId,
          dto.cliente_id.trim(),
          dto.monto,
          tipoPago,
          dto.referencia ?? null,
          dto.notas ?? null,
          userId,
        ],
      )) as Array<{ resultado?: Record<string, unknown> }>;

      return { resultado: rows[0]?.resultado ?? null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('m├¡nimo acordado') || msg.includes('monto m├¡nimo')) {
        throw new BadRequestException(msg);
      }
      throw e;
    }
  }

  private serializeCuenta(c: CuentaCorriente) {
    return {
      id: c.id,
      tenant_id: c.tenantId,
      cliente_id: c.clienteId,
      proveedor_id: c.proveedorId,
      saldo: Number(c.saldo),
      limite_credito: c.limiteCredito != null ? Number(c.limiteCredito) : null,
      tipo_cuenta: c.tipoCuenta,
      cobro_modalidad: c.cobroModalidad,
      cobro_dias_plazo: c.cobroDiasPlazo,
      cobro_periodicidad: c.cobroPeriodicidad,
      cobro_dia_vencimiento_mes: c.cobroDiaVencimientoMes,
      cobro_monto_minimo: Number(c.cobroMontoMinimo),
      created_at: c.createdAt.toISOString(),
      updated_at: c.updatedAt.toISOString(),
    };
  }

  private serializePago(p: Pago) {
    return {
      id: p.id,
      tenant_id: p.tenantId,
      cliente_id: p.clienteId,
      proveedor_id: p.proveedorId,
      cuenta_id: p.cuentaId,
      comprobante_id: p.comprobanteId,
      monto: Number(p.monto),
      tipo_pago: p.tipoPago,
      referencia: p.referencia,
      notas: p.notas,
      fecha: p.fecha,
      usuario_id: p.usuarioId,
      created_at: p.createdAt.toISOString(),
    };
  }

  private serializeComprobante(c: Comprobante) {
    return {
      id: c.id,
      tipo: c.tipo,
      numero: c.numero,
      total: Number(c.total),
      fecha: c.fecha,
      estado: c.estado,
    };
  }

  private async assertAnalizadorAccess() {
    const mod = await this.moduloRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId() },
    });
    if (!mod?.analizadorRentabilidad) {
      throw new ForbiddenException(
        'El m├│dulo analizador_rentabilidad no est├í habilitado para tu plan.',
      );
    }
  }
}
