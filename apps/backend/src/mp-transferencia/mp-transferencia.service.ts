import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Caja } from '../caja/entities/caja.entity';
import { lineaEtiquetaCajaFisica } from '../caja/utils/caja-linea-etiqueta.util';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { FacturacionService } from '../facturacion/facturacion.service';
import { buildEmitDtoFromBorrador } from '../mp-point/utils/borrador-body.util';
import { MpQrConfigService } from '../mp-qr/mp-qr-config.service';
import { MpTransferenciaMovimiento } from './entities/mp-transferencia-movimiento.entity';
import { MpTransferenciaVerificacion } from './entities/mp-transferencia-verificacion.entity';
import { createMpTransferenciaClient, MpTransferenciaClientError } from './mp-transferencia-api.client';
import {
  fechaMpTransferenciaHoy,
  rangoDiaArgentinaUtc,
} from './utils/mp-transferencia-parse.util';
import {
  movimientoPublico,
  pagoToMovimiento,
  type MpTransferenciaVerificacionEstado,
} from './utils/mp-transferencia-movimiento.util';
import {
  COLUMNAS_TRANSFERENCIA_MP,
  payloadConfigReportesMp,
} from './utils/mp-transferencia-report.util';

function redondearPesos(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class MpTransferenciaService {
  private readonly logger = new Logger(MpTransferenciaService.name);

  constructor(
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(ComprobanteItem)
    private readonly comprobanteItemRepo: Repository<ComprobanteItem>,
    @InjectRepository(MpTransferenciaMovimiento)
    private readonly movimientoRepo: Repository<MpTransferenciaMovimiento>,
    @InjectRepository(MpTransferenciaVerificacion)
    private readonly verificacionRepo: Repository<MpTransferenciaVerificacion>,
    @InjectRepository(Caja)
    private readonly cajaRepo: Repository<Caja>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
    private readonly mpQrConfigService: MpQrConfigService,
    private readonly facturacionService: FacturacionService,
  ) {}

  async iniciar(comprobanteId: string) {
    await this.mpQrConfigService.ensureFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const comp = await this.findComprobante(comprobanteId, tenantId);

    if (
      comp.estado !== EstadoComprobante.borrador &&
      comp.estado !== EstadoComprobante.pendiente_transferencia_mp
    ) {
      throw new BadRequestException(
        'Solo se puede verificar Transferencia MP sobre un borrador o una verificación en curso.',
      );
    }

    if (!comp.sucursalId) {
      throw new BadRequestException('El borrador no tiene sucursal asociada');
    }
    if (!comp.cajaId) {
      throw new BadRequestException('El borrador no tiene caja asociada');
    }

    const totalDb = Number(comp.total);
    if (!Number.isFinite(totalDb) || totalDb <= 0) {
      throw new BadRequestException(
        'El borrador no tiene un total válido para verificar Transferencia MP',
      );
    }

    const token = await this.mpQrConfigService.loadTransferenciaAccessToken(comp.sucursalId);
    if (!token.ok) {
      throw new HttpException(token.error, token.status);
    }

    if (comp.estado === EstadoComprobante.borrador) {
      comp.estado = EstadoComprobante.pendiente_transferencia_mp;
      comp.metodoPago = 'transferencia_mp';
      await this.comprobanteRepo.save(comp);
    }

    return {
      comprobante_id: comprobanteId,
      estado: EstadoComprobante.pendiente_transferencia_mp,
      monto_terminal_pesos: redondearPesos(totalDb),
    };
  }

  async verificar(comprobanteId: string) {
    await this.mpQrConfigService.ensureFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const comp = await this.findComprobante(comprobanteId, tenantId);

    if (!comp.sucursalId) {
      throw new BadRequestException('El comprobante no tiene sucursal asociada');
    }
    if (!comp.cajaId) {
      throw new BadRequestException('El comprobante no tiene caja asociada');
    }
    if (comp.estado !== EstadoComprobante.pendiente_transferencia_mp) {
      throw new BadRequestException(
        'El comprobante no está esperando verificación de Transferencia MP',
      );
    }

    const token = await this.mpQrConfigService.loadTransferenciaAccessToken(comp.sucursalId);
    if (!token.ok) {
      throw new HttpException(token.error, token.status);
    }

    try {
      const result = await this.verificarTransferencia({
        tenantId,
        sucursalId: comp.sucursalId,
        comprobanteId,
        total: Number(comp.total),
        accessToken: token.token,
      });
      return { comprobante_id: comprobanteId, ...result };
    } catch (e) {
      if (e instanceof MpTransferenciaClientError) {
        const status = e.status === 401 ? HttpStatus.BAD_REQUEST : e.status >= 500 ? 503 : 400;
        this.logger.error(
          `verificar MP comprobante=${comprobanteId} status=${e.status} ${e.message}`,
        );
        throw new HttpException(
          {
            estado: 'error',
            error: e.message,
            mp_status: e.status,
            mp_details: e.details ?? null,
          },
          status,
        );
      }
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`verificar comprobante=${comprobanteId} ${msg}`);
      throw new HttpException(
        { estado: 'error', error: msg || 'No se pudo verificar Transferencia MP' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async confirmar(comprobanteId: string, movimientoId: string, usuarioId: string) {
    await this.mpQrConfigService.ensureFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const comp = await this.findComprobante(comprobanteId, tenantId);

    if (!comp.sucursalId) {
      throw new BadRequestException('El comprobante no tiene sucursal asociada');
    }
    if (comp.estado !== EstadoComprobante.pendiente_transferencia_mp) {
      throw new BadRequestException(
        'El comprobante no está esperando verificación de Transferencia MP',
      );
    }

    const total = redondearPesos(Number(comp.total));
    const mov = await this.movimientoRepo.findOne({
      where: { id: movimientoId, tenantId, sucursalId: comp.sucursalId },
    });
    if (!mov) {
      throw new NotFoundException('Movimiento MP no encontrado');
    }
    if (Math.abs(Number(mov.monto) - total) > 0.005) {
      throw new BadRequestException('El movimiento no coincide con el total de la venta');
    }

    const uso = await this.verificacionRepo.findOne({
      where: { tenantId, mpMovimientoId: mov.mpMovimientoId },
    });
    if (uso && uso.comprobanteId !== comp.id) {
      throw new ConflictException('Este movimiento de Mercado Pago ya fue usado en otra venta');
    }
    if (uso && uso.estado === 'verificado') {
      throw new ConflictException('Este movimiento de Mercado Pago ya fue verificado');
    }

    let verificacionId = uso?.id ?? null;
    if (!verificacionId) {
      try {
        const ins = this.verificacionRepo.create({
          tenantId,
          sucursalId: comp.sucursalId,
          comprobanteId: comp.id,
          movimientoId: mov.id,
          mpMovimientoId: mov.mpMovimientoId,
          monto: mov.monto,
          fechaOperacion: mov.fechaOperacion,
          usuarioId,
          estado: 'reservado',
          raw: mov.raw ?? {},
        });
        const saved = await this.verificacionRepo.save(ins);
        verificacionId = saved.id;
      } catch (e) {
        if (e instanceof QueryFailedError && (e as QueryFailedError & { code?: string }).code === '23505') {
          throw new ConflictException('Este movimiento de Mercado Pago ya fue reservado');
        }
        throw e;
      }
    } else if (uso && uso.estado === 'error') {
      await this.verificacionRepo.update(verificacionId, {
        estado: 'reservado',
        ultimoError: null,
        usuarioId,
      });
    }

    const dto = await buildEmitDtoFromBorrador(
      this.comprobanteRepo,
      this.comprobanteItemRepo,
      tenantId,
      comp.id,
    );
    if (!dto) {
      throw new BadRequestException('No se pudo armar la venta desde el borrador');
    }
    dto.metodoPago = 'transferencia_mp';
    dto.metodoPagoDetalle = {
      mp_movimiento_id: mov.mpMovimientoId,
      movimiento_id: mov.id,
      monto: Number(mov.monto),
      fecha_operacion: mov.fechaOperacion,
    };

    const result = await this.facturacionService.emitirDesdeBorradorMpTransferencia({
      tenantId,
      borradorId: comp.id,
      usuarioId,
      dto,
    });

    if (!result.ok) {
      await this.verificacionRepo.update(verificacionId, {
        estado: 'error',
        ultimoError: result.error,
      });
      throw new BadRequestException(result.error);
    }

    await this.verificacionRepo.update(verificacionId, {
      estado: 'verificado',
      verificadoAt: new Date(),
      ultimoError: null,
      usuarioId,
    });

    const emitido = result.data.data as Record<string, unknown> & {
      id: string;
      tipo: string;
      numero: number | null;
      numeroOrden: number | null;
      fecha: string;
      estado: string;
      cae?: string | null;
      caeVencimiento?: string | null;
      total: number;
      subtotal: number;
      ivaMonto: number;
      ivaPorcentaje: number;
      metodoPago?: string | null;
      pdf?: { pdfUrl?: string | null };
    };
    const lineaCaja = await this.buildLineaCajaTicket(comp);
    const pdfUrl = emitido.pdf?.pdfUrl ?? null;

    return {
      comprobante: {
        id: emitido.id,
        tipo: emitido.tipo,
        numero: emitido.numero,
        numero_orden: emitido.numeroOrden,
        fecha: emitido.fecha,
        estado: emitido.estado,
        cae: emitido.cae ?? null,
        cae_vencimiento: emitido.caeVencimiento ?? null,
        total: emitido.total,
        subtotal: emitido.subtotal,
        iva_monto: emitido.ivaMonto,
        iva_porcentaje: emitido.ivaPorcentaje,
        metodo_pago: emitido.metodoPago,
        pdf_url: pdfUrl,
      },
      sucursal_id: comp.sucursalId,
      importes: {
        subtotal: emitido.subtotal,
        iva_monto: emitido.ivaMonto,
        iva_porcentaje: emitido.ivaPorcentaje,
        total: emitido.total,
      },
      promociones_aplicadas: [],
      qr_url: pdfUrl,
      ...(lineaCaja ? { linea_caja_ticket: lineaCaja } : {}),
    };
  }

  async cancelar(comprobanteId: string) {
    await this.mpQrConfigService.ensureFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const comp = await this.findComprobante(comprobanteId, tenantId);

    if (comp.estado === EstadoComprobante.borrador) {
      return { mensaje: 'Verificación cancelada' };
    }
    if (comp.estado !== EstadoComprobante.pendiente_transferencia_mp) {
      throw new BadRequestException(
        'El comprobante no está esperando verificación de Transferencia MP',
      );
    }

    await this.verificacionRepo
      .createQueryBuilder()
      .delete()
      .where('tenant_id = :tenantId', { tenantId })
      .andWhere('comprobante_id = :comprobanteId', { comprobanteId })
      .andWhere("estado IN ('reservado', 'error')")
      .execute();

    comp.estado = EstadoComprobante.borrador;
    comp.metodoPago = null;
    comp.metodoPagoDetalle = null;
    await this.comprobanteRepo.save(comp);

    return { mensaje: 'Verificación cancelada' };
  }

  async diagnostico(user: AccessTokenPayload) {
    this.rejectIfVisor(user);
    await this.mpQrConfigService.ensureFacturadorPos();
    const sucursalId = await this.sucursalContext.requireSucursalId();

    const token = await this.mpQrConfigService.loadTransferenciaAccessToken(sucursalId);
    if (!token.ok) {
      throw new HttpException({ ok: false, error: token.error }, token.status);
    }

    const client = createMpTransferenciaClient(token.token);
    try {
      const fecha = fechaMpTransferenciaHoy();
      const { beginDateIso, endDateIso } = rangoDiaArgentinaUtc(fecha);
      const pagos = await client.searchPayments({
        status: 'approved',
        limit: 5,
        offset: 0,
        sort: 'date_created',
        criteria: 'desc',
        beginDateIso,
        endDateIso,
      });
      return {
        ok: true,
        token_qr_mp: 'valido',
        cuenta_pagos_mp: 'accesible',
        sucursal_id: sucursalId,
        fecha,
        pagos_count: pagos.paging?.total ?? pagos.results?.length ?? 0,
        ultimos_pagos: (pagos.results ?? []).slice(0, 5).map((p) => ({
          id: p.id ?? null,
          date_created: p.date_created ?? null,
          date_approved: p.date_approved ?? null,
          status: p.status ?? null,
          status_detail: p.status_detail ?? null,
          transaction_amount: p.transaction_amount ?? null,
          currency_id: p.currency_id ?? null,
          payment_method_id: p.payment_method_id ?? null,
          payment_type_id: p.payment_type_id ?? null,
        })),
      };
    } catch (e) {
      if (e instanceof MpTransferenciaClientError) {
        this.logger.error(
          `diagnostico MP sucursal=${sucursalId} status=${e.status} ${e.message}`,
        );
        const status =
          e.status === 401 || e.status === 403
            ? HttpStatus.BAD_REQUEST
            : e.status >= 500
              ? HttpStatus.SERVICE_UNAVAILABLE
              : HttpStatus.BAD_REQUEST;
        throw new HttpException(
          {
            ok: false,
            token_qr_mp: e.status === 401 || e.status === 403 ? 'rechazado' : 'no_validado',
            cuenta_pagos_mp: 'no_accesible',
            error: e.message,
            mp_status: e.status,
            mp_details: e.details ?? null,
          },
          status,
        );
      }
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`diagnostico MP sucursal=${sucursalId} ${msg}`);
      throw new HttpException(
        { ok: false, error: msg || 'No se pudo diagnosticar Mercado Pago' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async configurarReportes(user: AccessTokenPayload, dto: { sucursal_id?: string; actualizar?: boolean }) {
    this.rejectIfVisor(user);
    await this.mpQrConfigService.ensureFacturadorPos();
    if (dto.sucursal_id?.trim()) {
      this.sucursalContext.setActiveSucursalId(dto.sucursal_id.trim());
    }
    const sucursalId = await this.sucursalContext.requireSucursalId();

    const token = await this.mpQrConfigService.loadTransferenciaAccessToken(sucursalId);
    if (!token.ok) {
      throw new HttpException({ ok: false, error: token.error }, token.status);
    }

    const client = createMpTransferenciaClient(token.token);
    const payload = payloadConfigReportesMp();

    try {
      let existeConfig = false;
      try {
        await client.getConfig();
        existeConfig = true;
      } catch (e) {
        if (!(e instanceof MpTransferenciaClientError) || e.status !== 404) throw e;
      }

      const raw = existeConfig
        ? dto.actualizar === true
          ? await client.updateConfig(payload)
          : null
        : await client.createConfig(payload);

      return {
        ok: true,
        accion: existeConfig ? (dto.actualizar === true ? 'actualizada' : 'ya_existia') : 'creada',
        mensaje:
          existeConfig && dto.actualizar !== true
            ? 'La configuracion de reportes MP ya existia. No se modifico.'
            : 'Configuracion de reportes MP lista para Transferencia MP.',
        columnas: COLUMNAS_TRANSFERENCIA_MP,
        raw_response: raw,
      };
    } catch (e) {
      if (e instanceof MpTransferenciaClientError) {
        this.logger.error(
          `configurar-reportes MP sucursal=${sucursalId} status=${e.status} ${e.message}`,
        );
        const status =
          e.status === 401 || e.status === 403
            ? HttpStatus.BAD_REQUEST
            : e.status >= 500
              ? HttpStatus.SERVICE_UNAVAILABLE
              : HttpStatus.BAD_REQUEST;
        throw new HttpException(
          {
            ok: false,
            error: e.message,
            mp_status: e.status,
            mp_details: e.details ?? null,
          },
          status,
        );
      }
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`configurar-reportes MP sucursal=${sucursalId} ${msg}`);
      throw new HttpException({ ok: false, error: msg }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  private rejectIfVisor(user: AccessTokenPayload): void {
    if (resolveAppRole(user) === 'visor') {
      throw new ForbiddenException('Los usuarios visor no pueden configurar Transferencia MP.');
    }
  }

  private async verificarTransferencia(params: {
    tenantId: string;
    sucursalId: string;
    comprobanteId: string;
    total: number;
    accessToken: string;
    fecha?: string;
  }): Promise<MpTransferenciaVerificacionEstado> {
    const fecha = params.fecha ?? fechaMpTransferenciaHoy();
    await this.importarPagosAprobados({
      tenantId: params.tenantId,
      sucursalId: params.sucursalId,
      fecha,
      accessToken: params.accessToken,
    });

    const movimientos = await this.buscarCoincidencias({
      tenantId: params.tenantId,
      sucursalId: params.sucursalId,
      comprobanteId: params.comprobanteId,
      fecha,
      monto: params.total,
    });

    if (movimientos.length === 0) return { estado: 'sin_coincidencias', movimientos };
    if (movimientos.length === 1) return { estado: 'una_coincidencia', movimientos };
    return { estado: 'multiples', movimientos };
  }

  private async importarPagosAprobados(params: {
    tenantId: string;
    sucursalId: string;
    fecha: string;
    accessToken: string;
  }): Promise<void> {
    const { beginDateIso, endDateIso } = rangoDiaArgentinaUtc(params.fecha);
    const client = createMpTransferenciaClient(params.accessToken);
    const limit = 100;
    const maxResults = 500;
    let offset = 0;
    const movimientos: ReturnType<typeof pagoToMovimiento>[] = [];

    this.logger.log(
      `importarPagos MP tenant=${params.tenantId} fecha=${params.fecha} begin=${beginDateIso}`,
    );

    while (offset < maxResults) {
      const page = await client.searchPayments({
        status: 'approved',
        limit,
        offset,
        sort: 'date_created',
        criteria: 'desc',
        beginDateIso,
        endDateIso,
      });
      const results = Array.isArray(page.results) ? page.results : [];
      movimientos.push(...results.map(pagoToMovimiento));

      if (results.length < limit) break;
      offset += limit;
      const total = Number(page.paging?.total ?? 0);
      if (total > 0 && offset >= total) break;
    }

    const rows = movimientos.filter((m): m is NonNullable<typeof m> => Boolean(m));
    if (rows.length === 0) return;

    for (const m of rows) {
      const entity = {
        tenantId: params.tenantId,
        sucursalId: params.sucursalId,
        reporteId: null,
        mpMovimientoId: m.mp_movimiento_id,
        fechaOperacion: m.fecha_operacion,
        fechaHora: m.fecha_hora ? new Date(m.fecha_hora) : null,
        monto: m.monto.toFixed(2),
        moneda: m.moneda,
        transactionType: m.transaction_type,
        paymentType: m.payment_type,
        descripcion: m.descripcion,
        contraparte: m.contraparte,
        raw: m.raw,
      } satisfies Partial<MpTransferenciaMovimiento>;
      await this.movimientoRepo.upsert(
        entity as Parameters<Repository<MpTransferenciaMovimiento>['upsert']>[0],
        ['tenantId', 'mpMovimientoId'],
      );
    }
  }

  private async buscarCoincidencias(params: {
    tenantId: string;
    sucursalId: string;
    comprobanteId: string;
    fecha: string;
    monto: number;
  }) {
    const montoBuscado = redondearPesos(params.monto);
    const movs = await this.movimientoRepo.find({
      where: {
        tenantId: params.tenantId,
        sucursalId: params.sucursalId,
        fechaOperacion: params.fecha,
        monto: montoBuscado.toFixed(2),
      },
      order: { fechaHora: 'DESC' },
    });

    if (!movs.length) return [];

    const ids = movs.map((m) => m.mpMovimientoId);
    const usos = await this.verificacionRepo
      .createQueryBuilder('v')
      .select(['v.mpMovimientoId', 'v.comprobanteId', 'v.estado'])
      .where('v.tenant_id = :tenantId', { tenantId: params.tenantId })
      .andWhere('v.mp_movimiento_id IN (:...ids)', { ids })
      .andWhere("v.estado IN ('reservado', 'verificado')")
      .getMany();

    const usados = new Set(
      usos
        .filter((u) => u.estado === 'verificado' || u.comprobanteId !== params.comprobanteId)
        .map((u) => u.mpMovimientoId),
    );

    return movs.filter((m) => !usados.has(m.mpMovimientoId)).map(movimientoPublico);
  }

  private async findComprobante(id: string, tenantId: string): Promise<Comprobante> {
    const comp = await this.comprobanteRepo.findOne({ where: { id, tenantId } });
    if (!comp) {
      throw new NotFoundException('Comprobante no encontrado');
    }
    return comp;
  }

  private async buildLineaCajaTicket(comp: Comprobante): Promise<string | null> {
    if (!comp.cajaUuid) return null;
    const caja = await this.cajaRepo.findOne({
      where: { id: comp.cajaUuid },
      select: ['numero', 'nombre'],
    });
    if (!caja) return null;
    return lineaEtiquetaCajaFisica(caja.nombre, caja.numero);
  }
}
