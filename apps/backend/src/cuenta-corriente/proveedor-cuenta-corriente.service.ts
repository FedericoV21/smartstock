import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';
import { PagoProveedorFactura } from '../importaciones/entities/pago-proveedor-factura.entity';
import { ExtractoQueryDto } from './dto/extracto-query.dto';
import { PagoCuentaProveedorDto } from './dto/pago-cuenta-proveedor.dto';
import { PagoMultipleProveedorDto } from './dto/pago-multiple-proveedor.dto';
import { PatchProveedorCuentaCorrienteDto } from './dto/patch-proveedor-cuenta-corriente.dto';
import { PagoProveedorMovimiento } from './entities/pago-proveedor-movimiento.entity';
import { Pago } from './entities/pago.entity';
import { TipoPago } from './enums/tipo-pago.enum';
import {
  applyCondicionesCuentaPatch,
  CUENTA_CORRIENTE_PROVEEDOR_DEFAULTS,
  pickCondicionesKeys,
  type CondicionesCuentaState,
} from './utils/condiciones-cuenta.util';
import {
  armarExtractoProveedor,
  extractoProveedorACsv,
  type ObligacionExtractoRow,
} from './utils/extracto-proveedor.util';
import { resolverPeriodoExtracto } from './utils/periodo-reporte.util';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseMonto(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return round2(n);
}

function estadoObligacion(saldoPendiente: number, montoOriginal: number): string {
  if (saldoPendiente <= 0.000001) return 'pagada';
  if (saldoPendiente + 0.000001 < montoOriginal) return 'parcial';
  return 'pendiente';
}

function fechaMasDiasIso(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString();
}

@Injectable()
export class ProveedorCuentaCorrienteService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Proveedor) private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(CuentaCorriente) private readonly cuentaRepo: Repository<CuentaCorriente>,
    @InjectRepository(Pago) private readonly pagoRepo: Repository<Pago>,
    @InjectRepository(PagoProveedorFactura)
    private readonly obligacionRepo: Repository<PagoProveedorFactura>,
    @InjectRepository(PagoProveedorMovimiento)
    private readonly movimientoRepo: Repository<PagoProveedorMovimiento>,
    @InjectRepository(Comprobante) private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
  ) {}

  async getCuenta(proveedorId: string) {
    await this.assertStock();
    await this.assertProveedor(proveedorId);
    const cuenta = await this.cuentaRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId(), proveedorId },
    });
    return { data: { cuenta: cuenta ? this.serializeCuenta(cuenta) : null } };
  }

  async patchCuenta(proveedorId: string, dto: PatchProveedorCuentaCorrienteDto) {
    await this.assertStock();
    await this.assertProveedor(proveedorId);

    const rawPatch = pickCondicionesKeys(dto as Record<string, unknown>);
    const patch = { ...rawPatch };
    delete patch.tipo_cuenta;

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Sin cambios');
    }

    const existing = await this.cuentaRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId(), proveedorId },
    });

    if (Object.keys(patch).length === 0 && existing) {
      throw new BadRequestException('Sin cambios');
    }

    const base: CondicionesCuentaState = existing
      ? {
          ...CUENTA_CORRIENTE_PROVEEDOR_DEFAULTS,
          cobro_modalidad: existing.cobroModalidad,
          cobro_dias_plazo: existing.cobroDiasPlazo,
          cobro_periodicidad: existing.cobroPeriodicidad,
          cobro_dia_vencimiento_mes: existing.cobroDiaVencimientoMes,
          cobro_monto_minimo: Number(existing.cobroMontoMinimo),
          tipo_cuenta: 'proveedor',
        }
      : CUENTA_CORRIENTE_PROVEEDOR_DEFAULTS;

    const applied = applyCondicionesCuentaPatch(base, patch);
    if (!applied.ok) throw new BadRequestException(applied.error);
    if (applied.state.tipo_cuenta !== 'proveedor') {
      throw new BadRequestException(
        'La cuenta de proveedor solo admite plazos y vencimientos, no un tipo de persona distinto',
      );
    }

    const tenantId = this.tenantContext.getTenantId();
    const row = {
      tipoCuenta: 'proveedor' as const,
      cobroModalidad: applied.state.cobro_modalidad,
      cobroDiasPlazo: applied.state.cobro_dias_plazo,
      cobroPeriodicidad: applied.state.cobro_periodicidad,
      cobroDiaVencimientoMes: applied.state.cobro_dia_vencimiento_mes,
      cobroMontoMinimo: applied.state.cobro_monto_minimo.toFixed(6),
    };

    let saved: CuentaCorriente;
    if (existing) {
      await this.cuentaRepo.update({ id: existing.id, tenantId }, row);
      saved = (await this.cuentaRepo.findOne({ where: { id: existing.id } }))!;
    } else {
      saved = await this.cuentaRepo.save(
        this.cuentaRepo.create({
          tenantId,
          clienteId: null,
          proveedorId,
          saldo: '0',
          ...row,
        }),
      );
    }

    return { data: { cuenta: this.serializeCuenta(saved) } };
  }

  async getExtracto(proveedorId: string, query: ExtractoQueryDto) {
    await this.assertStock();
    const proveedor = await this.assertProveedor(proveedorId);
    const tenantId = this.tenantContext.getTenantId();
    const periodo = resolverPeriodoExtracto({
      periodo: query.periodo,
      desde: query.desde,
      hasta: query.hasta,
    });

    const cuenta = await this.cuentaRepo.findOne({ where: { tenantId, proveedorId } });
    const saldoActual = cuenta ? Number(cuenta.saldo) : 0;

    const obligacionesRaw = await this.obligacionRepo.find({
      where: { tenantId, proveedorId },
      order: { createdAt: 'ASC' },
    });

    const compIds = [
      ...new Set(obligacionesRaw.map((o) => o.comprobanteId).filter(Boolean)),
    ] as string[];
    const comprobantes =
      compIds.length > 0
        ? await this.comprobanteRepo.find({ where: { tenantId, id: In(compIds) } })
        : [];
    const compMap = new Map(comprobantes.map((c) => [c.id, c]));

    const obligaciones: ObligacionExtractoRow[] = obligacionesRaw
      .filter((o) => o.estado !== 'anulada')
      .map((o) => {
        const comp = o.comprobanteId ? compMap.get(o.comprobanteId) : null;
        return {
          id: o.id,
          monto_original: Number(o.montoOriginal),
          origen: (o.origen ?? 'comprobante') as 'comprobante' | 'import_lista',
          referencia: o.referencia,
          created_at: o.createdAt.toISOString(),
          estado: o.estado,
          comprobante: comp
            ? { tipo: comp.tipo, numero: comp.numero, fecha: comp.fecha }
            : null,
        };
      })
      .filter((o) => {
        const fecha = o.comprobante?.fecha?.slice(0, 10) ?? o.created_at.slice(0, 10);
        return fecha >= periodo.desde && fecha <= periodo.hasta;
      });

    const pagos = await this.pagoRepo
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.proveedor_id = :proveedorId', { proveedorId })
      .andWhere('p.fecha >= :desde', { desde: periodo.desde })
      .andWhere('p.fecha <= :hasta', { hasta: periodo.hasta })
      .orderBy('p.fecha', 'ASC')
      .addOrderBy('p.created_at', 'ASC')
      .getMany();

    const payload = armarExtractoProveedor({
      proveedorId,
      proveedorNombre: String(proveedor.nombre || 'Proveedor'),
      periodo,
      saldoActual,
      obligaciones,
      pagos: pagos.map((p) => ({
        id: p.id,
        fecha: p.fecha,
        created_at: p.createdAt.toISOString(),
        monto: Number(p.monto),
        tipo_pago: p.tipoPago,
        referencia: p.referencia,
        notas: p.notas,
      })),
    });

    if ((query.export ?? '').toLowerCase() === 'csv') {
      const safeName = payload.proveedor_nombre.replace(/[^\w\s-]/g, '').slice(0, 40);
      return {
        csv: extractoProveedorACsv(payload),
        filename: `extracto-cc-proveedor-${safeName}-${periodo.desde}-${periodo.hasta}.csv`,
      };
    }

    return { data: payload };
  }

  async registrarPagoCuenta(proveedorId: string, dto: PagoCuentaProveedorDto, userId: string) {
    await this.assertStock();
    await this.assertProveedor(proveedorId);
    const tenantId = this.tenantContext.getTenantId();

    const rows = (await this.dataSource.query(
      `SELECT * FROM public.registrar_pago_cuenta_proveedor(
        $1::uuid, $2::uuid, $3::numeric, $4::public.tipo_pago,
        $5::uuid, $6::text, $7::text, $8::uuid, $9::date
      ) AS pago`,
      [
        tenantId,
        proveedorId,
        dto.monto,
        dto.tipoPago ?? TipoPago.efectivo,
        null,
        dto.referencia?.trim() || null,
        dto.notas?.trim() || null,
        userId,
        dto.fecha?.trim() || null,
      ],
    )) as Array<Record<string, unknown>>;

    return { data: { pago: rows[0] ?? null } };
  }

  async registrarPagoMultiple(proveedorId: string, dto: PagoMultipleProveedorDto, userId: string) {
    await this.assertStock();
    await this.assertProveedor(proveedorId);
    const tenantId = this.tenantContext.getTenantId();

    const ids = [...new Set(dto.obligaciones.map((o) => o.id.trim()).filter(Boolean))];
    if (ids.length === 0) {
      throw new BadRequestException('Seleccion├í al menos una factura');
    }

    const obligaciones = await this.obligacionRepo.find({
      where: { tenantId, proveedorId, id: In(ids) },
    });
    if (obligaciones.length !== ids.length) {
      throw new BadRequestException('Una o m├ís facturas no pertenecen a este proveedor');
    }

    const montoPorId = new Map(
      dto.obligaciones.map((o) => [o.id, parseMonto(o.monto)] as const),
    );

    const aplicaciones = obligaciones.map((o) => {
      const saldo = Number(o.saldoPendiente);
      const montoSolicitado = montoPorId.get(o.id);
      const monto = montoSolicitado == null ? round2(saldo) : montoSolicitado;
      return { obligacion: o, monto };
    });

    for (const app of aplicaciones) {
      const saldo = Number(app.obligacion.saldoPendiente);
      if (app.obligacion.estado === 'anulada') {
        throw new BadRequestException('No se puede pagar una obligaci├│n anulada');
      }
      if (!Number.isFinite(saldo) || saldo <= 0.000001) {
        throw new BadRequestException('Una de las facturas no tiene saldo pendiente');
      }
      if (!Number.isFinite(app.monto) || app.monto <= 0) {
        throw new BadRequestException('Cada monto debe ser mayor a cero');
      }
      if (app.monto > saldo + 0.000001) {
        throw new BadRequestException('El monto aplicado no puede superar el saldo de la factura');
      }
    }

    const total = round2(aplicaciones.reduce((acc, app) => acc + app.monto, 0));
    if (total <= 0) {
      throw new BadRequestException('El monto total debe ser mayor a cero');
    }

    const detalle = dto.notas?.trim() || null;
    const tipoPago = dto.tipoPago ?? TipoPago.efectivo;
    const referencia = `Pago de ${aplicaciones.length} factura${aplicaciones.length === 1 ? '' : 's'}`;
    const fechaP = dto.fecha?.trim() || null;

    const resultado = await this.dataSource.transaction(async (manager) => {
      const pagoRows = (await manager.query(
        `SELECT * FROM public.registrar_pago_cuenta_proveedor(
          $1::uuid, $2::uuid, $3::numeric, $4::public.tipo_pago,
          $5::uuid, $6::text, $7::text, $8::uuid, $9::date
        ) AS pago`,
        [tenantId, proveedorId, total, tipoPago, null, referencia, detalle, userId, fechaP],
      )) as Array<{ id: string }>;

      const pago = pagoRows[0];
      if (!pago?.id) {
        throw new BadRequestException('No se pudo registrar el pago');
      }

      const facturas: { id: string; monto_aplicado: number; nuevo_saldo: number }[] = [];

      for (const app of aplicaciones) {
        await manager.insert(PagoProveedorMovimiento, {
          tenantId,
          pagoProveedorFacturaId: app.obligacion.id,
          pagoCuentaCorrienteId: pago.id,
          monto: app.monto.toFixed(6),
          tipoPago,
          fecha: fechaP ?? new Date().toISOString().slice(0, 10),
          usuarioId: userId,
          notas: detalle,
        });

        const saldoActual = Number(app.obligacion.saldoPendiente);
        const montoOriginal = Number(app.obligacion.montoOriginal);
        const nuevoSaldo = Math.max(round2(saldoActual - app.monto), 0);

        await manager.update(
          PagoProveedorFactura,
          { id: app.obligacion.id, tenantId },
          {
            saldoPendiente: nuevoSaldo.toFixed(6),
            estado: estadoObligacion(nuevoSaldo, montoOriginal),
            vencimientoAt:
              nuevoSaldo > 0 ? new Date(fechaMasDiasIso(7)) : app.obligacion.vencimientoAt,
          },
        );

        facturas.push({
          id: app.obligacion.id,
          monto_aplicado: app.monto,
          nuevo_saldo: nuevoSaldo,
        });
      }

      return {
        pago_id: pago.id,
        total_pagado: total,
        facturas,
      };
    });

    return { data: { resultado } };
  }

  private serializeCuenta(c: CuentaCorriente) {
    return {
      id: c.id,
      tipo_cuenta: c.tipoCuenta,
      cobro_modalidad: c.cobroModalidad,
      cobro_dias_plazo: c.cobroDiasPlazo,
      cobro_periodicidad: c.cobroPeriodicidad,
      cobro_dia_vencimiento_mes: c.cobroDiaVencimientoMes,
      cobro_monto_minimo: Number(c.cobroMontoMinimo),
      saldo: Number(c.saldo),
      limite_credito: c.limiteCredito != null ? Number(c.limiteCredito) : null,
    };
  }

  private async assertProveedor(proveedorId: string): Promise<Proveedor> {
    const proveedor = await this.proveedorRepo.findOne({
      where: { id: proveedorId, tenantId: this.tenantContext.getTenantId() },
    });
    if (!proveedor) throw new NotFoundException('Proveedor no encontrado');
    return proveedor;
  }

  private async assertStock(): Promise<void> {
    const modulos = await this.moduloRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId() },
    });
    if (!modulos?.stock) {
      throw new ForbiddenException('M├│dulo stock no habilitado');
    }
  }
}
