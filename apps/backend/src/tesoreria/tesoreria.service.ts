import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, MoreThan, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { TipoPago } from '../cuenta-corriente/enums/tipo-pago.enum';
import { PagoProveedorFactura } from '../importaciones/entities/pago-proveedor-factura.entity';
import { CajaTesoreria } from './entities/caja-tesoreria.entity';
import { CambiarEstadoChequeDto, RegistrarChequeDto } from './dto/cheque.dto';
import { IngresoEfectivoDto, TransferenciaDesdeCajaDto } from './dto/ingreso-efectivo.dto';
import { PagoProveedorTesoreriaDto } from './dto/pago-proveedor.dto';
import {
  ChequesQueryDto,
  ObligacionesQueryDto,
  TesoreriaOverviewQueryDto,
} from './dto/tesoreria-query.dto';
import { CajaTesoreriaCheque } from './entities/caja-tesoreria-cheque.entity';
import { CajaTesoreriaMovimiento } from './entities/caja-tesoreria-movimiento.entity';
import { CajaTesoreriaChequeEstado } from './enums/caja-tesoreria-cheque-estado.enum';
import { CajaTesoreriaMovimientoTipo } from './enums/caja-tesoreria-movimiento-tipo.enum';
import { TesoreriaContextService } from './tesoreria-context.service';
import {
  calcularMontoUsadoCheque,
  calcularSaldoDisponibleCheque,
  ETIQUETA_ESTADO_CHEQUE,
  ETIQUETA_MOVIMIENTO_TESORERIA,
} from './utils/cheque-saldo.util';
import { CajaService } from '../caja/caja.service';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';

@Injectable()
export class TesoreriaService {
  constructor(
    @InjectRepository(CajaTesoreria)
    private readonly cajaRepo: Repository<CajaTesoreria>,
    @InjectRepository(CajaTesoreriaMovimiento)
    private readonly movRepo: Repository<CajaTesoreriaMovimiento>,
    @InjectRepository(CajaTesoreriaCheque)
    private readonly chequeRepo: Repository<CajaTesoreriaCheque>,
    @InjectRepository(PagoProveedorFactura)
    private readonly obligacionRepo: Repository<PagoProveedorFactura>,
    @InjectRepository(Proveedor)
    private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly context: TesoreriaContextService,
    private readonly tenantContext: TenantContext,
    private readonly cajaService: CajaService,
  ) {}

  async getOverview(query: TesoreriaOverviewQueryDto) {
    const ctx = await this.context.resolve(query.sucursal_id);
    const limit = query.limit ?? 50;

    const qb = this.movRepo
      .createQueryBuilder('m')
      .leftJoin(Proveedor, 'p', 'p.id = m.proveedor_id')
      .where('m.caja_tesoreria_id = :cajaId', { cajaId: ctx.cajaTesoreriaId })
      .orderBy('m.created_at', 'DESC')
      .take(limit)
      .select([
        'm.id',
        'm.tipo',
        'm.monto',
        'm.es_ingreso',
        'm.cierre_z_id',
        'm.caja_id',
        'm.pago_id',
        'm.cheque_id',
        'm.proveedor_id',
        'm.notas',
        'm.fecha',
        'm.created_at',
        'm.usuario_id',
        'p.nombre',
      ]);

    if (query.fecha_desde) qb.andWhere('m.fecha >= :desde', { desde: query.fecha_desde });
    if (query.fecha_hasta) qb.andWhere('m.fecha <= :hasta', { hasta: query.fecha_hasta });

    const rawMovs = await qb.getRawMany<{
      m_id: string;
      m_tipo: CajaTesoreriaMovimientoTipo;
      m_monto: string;
      m_es_ingreso: boolean;
      m_cierre_z_id: string | null;
      m_caja_id: string | null;
      m_pago_id: string | null;
      m_cheque_id: string | null;
      m_proveedor_id: string | null;
      m_notas: string | null;
      m_fecha: string;
      m_created_at: Date;
      m_usuario_id: string | null;
      p_nombre: string | null;
    }>();

    const movsCheque = await this.movRepo.find({
      where: {
        cajaTesoreriaId: ctx.cajaTesoreriaId,
        tipo: In([
          CajaTesoreriaMovimientoTipo.egreso_cheque,
          CajaTesoreriaMovimientoTipo.ajuste,
        ]),
      },
      select: { chequeId: true, tipo: true, monto: true, esIngreso: true },
    });

    const cheques = await this.chequeRepo.find({
      where: { cajaTesoreriaId: ctx.cajaTesoreriaId },
      order: { createdAt: 'DESC' },
      take: 100,
    });

    const movsChequeList = movsCheque
      .filter((m) => m.chequeId)
      .map((m) => ({
        cheque_id: m.chequeId!,
        tipo: m.tipo,
        monto: Number(m.monto),
        es_ingreso: m.esIngreso,
      }));

    const chequesFmt = cheques.map((c) => {
      const monto = Number(c.monto);
      const saldoDisponible =
        c.estado === CajaTesoreriaChequeEstado.en_cartera
          ? calcularSaldoDisponibleCheque(monto, c.id, movsChequeList)
          : 0;
      return {
        id: c.id,
        numero: c.numero,
        banco: c.banco,
        titular: c.titular,
        fecha_emision: c.fechaEmision,
        fecha_cobro: c.fechaCobro,
        monto,
        estado: c.estado,
        notas: c.notas,
        created_at: c.createdAt.toISOString(),
        pago_id: c.pagoId,
        saldo_disponible: saldoDisponible,
        monto_usado: calcularMontoUsadoCheque(monto, saldoDisponible),
        estado_etiqueta: ETIQUETA_ESTADO_CHEQUE[c.estado] ?? c.estado,
      };
    });

    const enCartera = chequesFmt.filter(
      (c) => c.estado === CajaTesoreriaChequeEstado.en_cartera && c.saldo_disponible > 0.01,
    );

    const caja = await this.cajaRepo.findOne({ where: { id: ctx.cajaTesoreriaId } });

    return {
      data: {
        caja: caja
          ? {
              id: caja.id,
              nombre: caja.nombre,
              sucursal_id: caja.sucursalId,
              activa: caja.activa,
            }
          : null,
        alcance: ctx.alcance,
        saldo_efectivo: ctx.saldoEfectivo,
        total_cheques_cartera: enCartera.reduce((s, c) => s + c.saldo_disponible, 0),
        cantidad_cheques_cartera: enCartera.length,
        movimientos: rawMovs.map((m) => ({
          id: m.m_id,
          tipo: m.m_tipo,
          monto: Number(m.m_monto),
          es_ingreso: m.m_es_ingreso,
          cierre_z_id: m.m_cierre_z_id,
          caja_id: m.m_caja_id,
          pago_id: m.m_pago_id,
          cheque_id: m.m_cheque_id,
          proveedor_id: m.m_proveedor_id,
          notas: m.m_notas,
          fecha: m.m_fecha,
          created_at: m.m_created_at.toISOString(),
          usuario_id: m.m_usuario_id,
          tipo_etiqueta: ETIQUETA_MOVIMIENTO_TESORERIA[m.m_tipo] ?? m.m_tipo,
          proveedor_nombre: m.p_nombre,
        })),
        cheques: chequesFmt,
      },
    };
  }

  async ingresoEfectivo(dto: IngresoEfectivoDto, user: AccessTokenPayload, sucursalId?: string) {
    const ctx = await this.context.resolve(sucursalId);
    const rows = (await this.dataSource.query(
      `SELECT * FROM public.registrar_ingreso_efectivo_tesoreria(
        $1::uuid, $2::uuid, $3::numeric, $4::text, $5::uuid, $6::date
      ) AS movimiento`,
      [
        ctx.tenantId,
        ctx.cajaTesoreriaId,
        dto.monto,
        dto.notas?.trim() || null,
        user.sub,
        dto.fecha?.trim() || null,
      ],
    )) as Array<Record<string, unknown>>;
    return { data: { movimiento: rows[0] ?? null } };
  }

  async transferenciaDesdeCaja(
    dto: TransferenciaDesdeCajaDto,
    user: AccessTokenPayload,
    sucursalId?: string,
  ) {
    const ctx = await this.context.resolve(sucursalId);
    const rows = (await this.dataSource.query(
      `SELECT * FROM public.registrar_transferencia_desde_caja_tesoreria(
        $1::uuid, $2::uuid, $3::numeric, $4::uuid, $5::uuid, $6::text, $7::uuid, $8::date
      ) AS movimiento`,
      [
        ctx.tenantId,
        ctx.cajaTesoreriaId,
        dto.monto,
        dto.cierre_z_id?.trim() || null,
        dto.caja_id?.trim() || null,
        dto.notas?.trim() || null,
        user.sub,
        dto.fecha?.trim() || null,
      ],
    )) as Array<Record<string, unknown>>;
    return { data: { movimiento: rows[0] ?? null } };
  }

  async listCheques(query: ChequesQueryDto) {
    const ctx = await this.context.resolve(query.sucursal_id);
    const where: Record<string, unknown> = { cajaTesoreriaId: ctx.cajaTesoreriaId };
    if (query.estado) where.estado = query.estado as CajaTesoreriaChequeEstado;

    const cheques = await this.chequeRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });

    return {
      data: {
        cheques: cheques.map((c) => ({
          id: c.id,
          numero: c.numero,
          banco: c.banco,
          titular: c.titular,
          fecha_emision: c.fechaEmision,
          fecha_cobro: c.fechaCobro,
          monto: Number(c.monto),
          estado: c.estado,
          notas: c.notas,
          created_at: c.createdAt.toISOString(),
          pago_id: c.pagoId,
        })),
      },
    };
  }

  async registrarCheque(dto: RegistrarChequeDto, user: AccessTokenPayload, sucursalId?: string) {
    const ctx = await this.context.resolve(sucursalId);
    const rows = (await this.dataSource.query(
      `SELECT public.registrar_cheque_tesoreria(
        $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::date, $7::date,
        $8::numeric, $9::text, $10::uuid, $11::date
      ) AS resultado`,
      [
        ctx.tenantId,
        ctx.cajaTesoreriaId,
        dto.numero.trim(),
        dto.banco.trim(),
        dto.titular?.trim() || null,
        dto.fecha_emision?.trim() || null,
        dto.fecha_cobro?.trim() || null,
        dto.monto,
        dto.notas?.trim() || null,
        user.sub,
        dto.fecha?.trim() || null,
      ],
    )) as Array<{ resultado: Record<string, unknown> }>;
    return { data: { resultado: rows[0]?.resultado ?? null } };
  }

  async cambiarEstadoCheque(
    chequeId: string,
    dto: CambiarEstadoChequeDto,
    user: AccessTokenPayload,
    sucursalId?: string,
  ) {
    if (dto.estado !== 'depositado' && dto.estado !== 'rechazado') {
      throw new BadRequestException('estado debe ser depositado o rechazado');
    }
    const ctx = await this.context.resolve(sucursalId);
    const exists = await this.chequeRepo.findOne({
      where: { id: chequeId, cajaTesoreriaId: ctx.cajaTesoreriaId },
    });
    if (!exists) throw new NotFoundException('Cheque no encontrado');

    const rows = (await this.dataSource.query(
      `SELECT * FROM public.cambiar_estado_cheque_tesoreria(
        $1::uuid, $2::uuid, $3::public.caja_tesoreria_cheque_estado, $4::text, $5::uuid
      ) AS cheque`,
      [ctx.tenantId, chequeId, dto.estado, dto.notas?.trim() || null, user.sub],
    )) as Array<Record<string, unknown>>;
    return { data: { cheque: rows[0] ?? null } };
  }

  async pagoProveedor(dto: PagoProveedorTesoreriaDto, user: AccessTokenPayload, sucursalId?: string) {
    const ctx = await this.context.resolve(sucursalId);
    const proveedor = await this.proveedorRepo.findOne({
      where: { id: dto.proveedor_id, tenantId: ctx.tenantId },
    });
    if (!proveedor) throw new NotFoundException('Proveedor no encontrado');

    const tipoPago = dto.tipo_pago === TipoPago.cheque ? TipoPago.cheque : TipoPago.efectivo;
    if (tipoPago === TipoPago.cheque && !dto.cheque_id?.trim()) {
      throw new BadRequestException('cheque_id es obligatorio para pago con cheque');
    }

    const rows = (await this.dataSource.query(
      `SELECT public.registrar_pago_proveedor_tesoreria(
        $1::uuid, $2::uuid, $3::uuid, $4::numeric, $5::public.tipo_pago,
        $6::uuid, $7::uuid, $8::text, $9::uuid, $10::date
      ) AS resultado`,
      [
        ctx.tenantId,
        ctx.cajaTesoreriaId,
        dto.proveedor_id,
        dto.monto,
        tipoPago,
        dto.cheque_id?.trim() || null,
        dto.pago_proveedor_factura_id?.trim() || null,
        dto.notas?.trim() || null,
        user.sub,
        dto.fecha?.trim() || null,
      ],
    )) as Array<{ resultado: Record<string, unknown> }>;

    return { data: { resultado: rows[0]?.resultado ?? null } };
  }

  async getObligaciones(query: ObligacionesQueryDto) {
    await this.context.resolve(query.sucursal_id);
    const tenantId = this.tenantContext.getTenantId();

    if (!query.proveedor_id?.trim()) {
      throw new BadRequestException('proveedor_id es obligatorio');
    }

    const rows = await this.obligacionRepo.find({
      where: {
        tenantId,
        proveedorId: query.proveedor_id,
        saldoPendiente: MoreThan('0.001'),
      },
      order: { vencimientoAt: 'ASC' },
    });

    const compIds = rows.map((r) => r.comprobanteId).filter(Boolean) as string[];
    const comprobantes =
      compIds.length > 0
        ? await this.comprobanteRepo.find({
            where: { tenantId, id: In(compIds) },
            select: { id: true, tipo: true, numero: true, fecha: true },
          })
        : [];
    const compMap = new Map(comprobantes.map((c) => [c.id, c]));

    const obligaciones = rows.map((o) => {
      const comp = o.comprobanteId ? compMap.get(o.comprobanteId) : null;
      const referencia = this.etiquetaObligacion(o, comp);
      return {
        id: o.id,
        saldo_pendiente: Number(o.saldoPendiente),
        referencia,
      };
    });

    return { data: { obligaciones } };
  }

  async getCierresRecientes(sucursalId?: string, limit?: number) {
    const { cierres } = await this.cajaService.listCierresRecientes(sucursalId, limit ?? 20);
    return { data: { cierres } };
  }

  private etiquetaObligacion(
    row: PagoProveedorFactura,
    comp: { tipo: string; numero: number | null; fecha: Date | string | null } | null | undefined,
  ): string {
    if (comp?.tipo) {
      const tipo = comp.tipo.replace(/_/g, ' ');
      if (comp.numero != null) return `${tipo} ${comp.numero}`;
      if (comp.fecha) return `${tipo} ┬À ${String(comp.fecha).slice(0, 10)}`;
      return tipo;
    }
    const ref = row.referencia?.trim();
    if (ref && !/^[0-9a-f-]{36}$/i.test(ref)) return ref;
    if (row.origen === 'import_lista') return 'Importaci├│n de lista';
    if (row.vencimientoAt) return `Deuda ┬À vence ${row.vencimientoAt.toISOString().slice(0, 10)}`;
    return `Deuda ┬À ${Number(row.saldoPendiente).toFixed(2)}`;
  }
}
