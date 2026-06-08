import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Cliente } from '../catalog/entities/cliente.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';
import { Producto } from '../products/entities/producto.entity';
import {
  formatearNumeroComprobante,
  formatearTipoComprobante,
} from '../cobranza/utils/comprobante-formato.util';
import { ExtractoQueryDto } from './dto/extracto-query.dto';
import { LiquidarItemsDto } from './dto/liquidar-items.dto';
import { MovimientosDiaQueryDto } from './dto/movimientos-dia-query.dto';
import { PatchPagoExtractoDto } from './dto/patch-pago-extracto.dto';
import { PatchClienteCuentaCorrienteDto } from './dto/patch-cliente-cuenta-corriente.dto';
import { RegistrarPagoDto } from './dto/registrar-pago.dto';
import { Pago } from './entities/pago.entity';
import { TipoPago } from './enums/tipo-pago.enum';
import { readCcDistribuidoraPrefs } from './utils/business-prefs-cc.util';
import {
  contarCargosHoyPorCliente,
  validarComprobanteLiquidable,
} from './utils/liquidar-comprobante.util';
import {
  applyCondicionesCuentaPatch,
  CUENTA_CORRIENTE_CONDICIONES_DEFAULTS,
  pickCondicionesKeys,
  type CondicionesCuentaState,
} from './utils/condiciones-cuenta.util';
import { armarExtractoCuentaCorriente, extractoACsv } from './utils/extracto.util';
import { formatCurrencyAr } from './utils/format-currency.util';
import { hoyEnAR, resolverPeriodoExtracto } from './utils/periodo-reporte.util';

const ESTADOS_MOVIMIENTOS_DIA: EstadoComprobante[] = [
  EstadoComprobante.emitido,
  EstadoComprobante.pendiente_arca,
];

const TIPOS_LIQUIDABLES = new Set(['ticket', 'factura_b', 'factura_c']);

@Injectable()
export class ClienteCuentaCorrienteService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Cliente) private readonly clienteRepo: Repository<Cliente>,
    @InjectRepository(CuentaCorriente) private readonly cuentaRepo: Repository<CuentaCorriente>,
    @InjectRepository(Pago) private readonly pagoRepo: Repository<Pago>,
    @InjectRepository(Comprobante) private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(ComprobanteItem) private readonly compItemRepo: Repository<ComprobanteItem>,
    @InjectRepository(Producto) private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Sucursal) private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(ModuloConfig)     private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
  ) {}

  async getCuenta(clienteId: string) {
    await this.assertFacturadorSimple();
    await this.assertCliente(clienteId);
    const cuenta = await this.cuentaRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId(), clienteId },
    });
    return { data: { cuenta: cuenta ? this.serializeCuenta(cuenta) : null } };
  }

  async patchCuenta(clienteId: string, dto: PatchClienteCuentaCorrienteDto) {
    await this.assertFacturadorSimple();
    await this.assertCliente(clienteId);

    const patch = pickCondicionesKeys(dto as Record<string, unknown>);
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Sin cambios');
    }

    const existing = await this.cuentaRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId(), clienteId },
    });

    const base: CondicionesCuentaState = existing
      ? {
          tipo_cuenta: existing.tipoCuenta as CondicionesCuentaState['tipo_cuenta'],
          cobro_modalidad: existing.cobroModalidad,
          cobro_dias_plazo: existing.cobroDiasPlazo,
          cobro_periodicidad: existing.cobroPeriodicidad,
          cobro_dia_vencimiento_mes: existing.cobroDiaVencimientoMes,
          cobro_monto_minimo: Number(existing.cobroMontoMinimo),
        }
      : CUENTA_CORRIENTE_CONDICIONES_DEFAULTS;

    const applied = applyCondicionesCuentaPatch(base, patch);
    if (!applied.ok) throw new BadRequestException(applied.error);

    const tenantId = this.tenantContext.getTenantId();
    const row = {
      tipoCuenta: applied.state.tipo_cuenta,
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
          clienteId,
          saldo: '0',
          ...row,
        }),
      );
    }

    return { data: { cuenta: this.serializeCuenta(saved) } };
  }

  async getExtracto(clienteId: string, query: ExtractoQueryDto) {
    await this.assertFacturadorSimple();
    const cliente = await this.assertCliente(clienteId);
    const tenantId = this.tenantContext.getTenantId();
    const periodo = resolverPeriodoExtracto({
      periodo: query.periodo,
      desde: query.desde,
      hasta: query.hasta,
    });

    const cuenta = await this.cuentaRepo.findOne({ where: { tenantId, clienteId } });
    const saldoActual = cuenta ? Number(cuenta.saldo) : 0;

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const puntoDeVenta = tenant?.puntoDeVenta ?? 1;

    const comprobantes = await this.comprobanteRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.cliente_id = :clienteId', { clienteId })
      .andWhere('c.fecha >= :desde', { desde: periodo.desde })
      .andWhere('c.fecha <= :hasta', { hasta: periodo.hasta })
      .andWhere('c.estado IN (:...estados)', {
        estados: [EstadoComprobante.emitido, EstadoComprobante.pendiente_arca],
      })
      .andWhere(query.sucursal_id ? 'c.sucursal_id = :sucursalId' : '1=1', {
        sucursalId: query.sucursal_id,
      })
      .orderBy('c.fecha', 'ASC')
      .addOrderBy('c.created_at', 'ASC')
      .getMany();

    let pagos = await this.pagoRepo
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.cliente_id = :clienteId', { clienteId })
      .andWhere('p.fecha >= :desde', { desde: periodo.desde })
      .andWhere('p.fecha <= :hasta', { hasta: periodo.hasta })
      .orderBy('p.fecha', 'ASC')
      .addOrderBy('p.created_at', 'ASC')
      .getMany();

    if (query.sucursal_id && pagos.length > 0) {
      const compIds = [...new Set(pagos.map((p) => p.comprobanteId).filter(Boolean))] as string[];
      if (compIds.length > 0) {
        const allowed = await this.comprobanteRepo.find({
          where: { tenantId, id: In(compIds), sucursalId: query.sucursal_id },
          select: { id: true },
        });
        const allowedSet = new Set(allowed.map((c) => c.id));
        pagos = pagos.filter((p) => !p.comprobanteId || allowedSet.has(p.comprobanteId));
      }
    }

    const payload = armarExtractoCuentaCorriente({
      clienteId,
      clienteNombre: String(cliente.razonSocial || cliente.nombre || 'Cliente'),
      periodo,
      sucursalId: query.sucursal_id ?? null,
      saldoActual,
      comprobantes: comprobantes.map((c) => ({
        id: c.id,
        tipo: c.tipo,
        numero: c.numero,
        fecha: c.fecha,
        createdAt: c.createdAt.toISOString(),
        total: Number(c.total),
        metodoPago: c.metodoPago,
        metodoPagoDetalle: c.metodoPagoDetalle,
        sucursalId: c.sucursalId,
        estado: c.estado,
        cae: c.cae,
      })),
      pagos: pagos.map((p) => ({
        id: p.id,
        fecha: p.fecha,
        createdAt: p.createdAt.toISOString(),
        monto: Number(p.monto),
        tipoPago: p.tipoPago,
        referencia: p.referencia,
        notas: p.notas,
        comprobanteId: p.comprobanteId,
      })),
      puntoDeVenta,
    });

    if ((query.export ?? '').toLowerCase() === 'csv') {
      return { csv: extractoACsv(payload), filename: `extracto-cc-${clienteId}-${periodo.desde}-${periodo.hasta}.csv` };
    }

    return { data: payload };
  }

  async getMovimientosDia(clienteId: string, query: MovimientosDiaQueryDto) {
    await this.assertFacturadorSimpleOrPos();
    await this.assertCliente(clienteId);
    if (!query.sucursal_id) {
      throw new BadRequestException('Indic├í la sucursal operativa.');
    }

    const tenantId = this.tenantContext.getTenantId();
    const sucursal = await this.sucursalRepo.findOne({
      where: { id: query.sucursal_id, tenantId },
    });
    if (!sucursal) throw new NotFoundException('Sucursal no encontrada');

    const prefs = readCcDistribuidoraPrefs(sucursal.businessPrefs);
    if (!prefs.panelMovimientosDia) {
      throw new ForbiddenException('El panel de movimientos del d├¡a no est├í habilitado en esta sucursal.');
    }

    const cuenta = await this.cuentaRepo.findOne({ where: { tenantId, clienteId } });
    const fechaHoy = hoyEnAR();

    const comprobantes = await this.comprobanteRepo.find({
      where: {
        tenantId,
        clienteId,
        sucursalId: query.sucursal_id,
        fecha: fechaHoy,
        metodoPago: 'cuenta_corriente',
        estado: In(ESTADOS_MOVIMIENTOS_DIA),
      },
      order: { createdAt: 'ASC' },
    });

    const compIds = comprobantes.map((c) => c.id);
    const items =
      compIds.length > 0
        ? await this.compItemRepo.find({ where: { comprobanteId: In(compIds) } })
        : [];
    const productIds = [...new Set(items.map((i) => i.productoId))];
    const products =
      productIds.length > 0
        ? await this.productoRepo.find({ where: { tenantId, id: In(productIds) } })
        : [];
    const productMap = new Map(products.map((p) => [p.id, p]));

    const itemsByComp = new Map<string, typeof items>();
    for (const it of items) {
      const list = itemsByComp.get(it.comprobanteId) ?? [];
      list.push(it);
      itemsByComp.set(it.comprobanteId, list);
    }

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const pv = tenant?.puntoDeVenta ?? 1;

    let totalCargosDia = 0;
    const compDtos = comprobantes.map((c) => {
      totalCargosDia += Number(c.total);
      const compItems = itemsByComp.get(c.id) ?? [];
      const editable = !c.cae?.trim() && TIPOS_LIQUIDABLES.has(c.tipo);
      return {
        id: c.id,
        tipo: c.tipo,
        tipoLabel: c.tipo,
        numeroLabel: c.numero != null ? `${String(pv).padStart(4, '0')}-${String(c.numero).padStart(8, '0')}` : 'ÔÇö',
        horaLabel: c.createdAt.toISOString().slice(11, 16),
        total: Number(c.total),
        totalLabel: formatCurrencyAr(Number(c.total)),
        editable,
        items: compItems.map((it) => {
          const p = productMap.get(it.productoId);
          const sub = Number(it.subtotal);
          return {
            id: it.id,
            nombre: p?.nombre ?? 'Producto',
            codigo: p?.codigo ?? null,
            cantidad: Number(it.cantidad),
            cantidadLabel: String(Number(it.cantidad)),
            precioUnitario: Number(it.precioUnitario),
            precioUnitarioLabel: formatCurrencyAr(Number(it.precioUnitario)),
            subtotal: sub,
            subtotalLabel: formatCurrencyAr(sub),
          };
        }),
      };
    });

    const saldoCuenta = cuenta ? Number(cuenta.saldo) : null;
    const saldoSinCargos =
      saldoCuenta != null ? Math.round((saldoCuenta - totalCargosDia) * 100) / 100 : null;

    return {
      data: {
        fecha: fechaHoy,
        sucursal_id: query.sucursal_id,
        sucursal_nombre: sucursal.nombre,
        liquidacion_habilitada: prefs.permitirLiquidacionItemsDia,
        saldo_cuenta: saldoCuenta,
        saldo_cuenta_label: saldoCuenta != null ? formatCurrencyAr(saldoCuenta) : 'ÔÇö',
        total_cargos_dia: Math.round(totalCargosDia * 100) / 100,
        total_cargos_dia_label: formatCurrencyAr(totalCargosDia),
        saldo_sin_cargos_hoy: saldoSinCargos,
        saldo_sin_cargos_hoy_label: saldoSinCargos != null ? formatCurrencyAr(saldoSinCargos) : 'ÔÇö',
        comprobantes: compDtos,
      },
    };
  }

  async liquidarItems(clienteId: string, dto: LiquidarItemsDto) {
    await this.assertFacturadorSimpleOrPos();
    await this.assertCliente(clienteId);
    if (!dto.sucursalId) throw new BadRequestException('Indic├í la sucursal operativa.');

    const tenantId = this.tenantContext.getTenantId();
    const sucursal = await this.sucursalRepo.findOne({
      where: { id: dto.sucursalId, tenantId },
    });
    if (!sucursal) throw new NotFoundException('Sucursal no encontrada');

    const prefs = readCcDistribuidoraPrefs(sucursal.businessPrefs);
    if (!prefs.permitirLiquidacionItemsDia) {
      throw new ForbiddenException('La liquidaci├│n de precios del d├¡a no est├í habilitada en esta sucursal.');
    }
    if (!prefs.panelMovimientosDia) {
      throw new ForbiddenException('Activ├í tambi├®n el panel de movimientos del d├¡a en esta sucursal.');
    }

    const comp = await this.comprobanteRepo.findOne({
      where: { id: dto.comprobanteId, tenantId },
    });
    if (!comp || comp.clienteId !== clienteId) {
      throw new NotFoundException('Comprobante no encontrado.');
    }
    if (comp.sucursalId !== dto.sucursalId) {
      throw new ForbiddenException('El comprobante no pertenece a la sucursal indicada.');
    }
    if (comp.fecha !== hoyEnAR()) {
      throw new BadRequestException('Solo se pueden liquidar comprobantes del d├¡a en curso.');
    }
    if (comp.metodoPago !== 'cuenta_corriente') {
      throw new BadRequestException('Solo aplica a ventas en cuenta corriente.');
    }
    if (!ESTADOS_MOVIMIENTOS_DIA.includes(comp.estado)) {
      throw new BadRequestException('El comprobante no est├í en un estado editable.');
    }
    if (!TIPOS_LIQUIDABLES.has(comp.tipo)) {
      throw new BadRequestException('Solo tickets o facturas B/C sin CAE pueden liquidarse desde aqu├¡.');
    }
    if (comp.cae?.trim()) {
      throw new BadRequestException('No se pueden modificar importes de un comprobante con CAE emitido.');
    }

    const dbItems = await this.compItemRepo.find({ where: { comprobanteId: comp.id } });
    if (dbItems.length === 0) throw new BadRequestException('El comprobante no tiene ├¡tems.');

    const precioPorId = new Map(dto.items.map((i) => [i.id, i.precio_unitario]));
    for (const row of dbItems) {
      const pu = precioPorId.get(row.id);
      if (pu == null || !Number.isFinite(pu) || pu < 0) {
        throw new BadRequestException('Faltan precios para uno o m├ís ├¡tems.');
      }
    }

    const subtotal = dbItems.reduce((acc, row) => {
      const pu = precioPorId.get(row.id)!;
      return acc + Number(row.cantidad) * pu;
    }, 0);
    const ivaPct = Number(comp.ivaPorcentaje);
    const ivaMonto = Math.round(subtotal * (ivaPct / 100) * 100) / 100;
    const total = Math.round((subtotal + ivaMonto) * 100) / 100;
    const oldTotal = Number(comp.total);
    const delta = Math.round((total - oldTotal) * 100) / 100;

    await this.dataSource.transaction(async (manager) => {
      for (const row of dbItems) {
        const pu = precioPorId.get(row.id)!;
        const itemSub = Math.round(Number(row.cantidad) * pu * 100) / 100;
        await manager.update(ComprobanteItem, { id: row.id }, {
          precioUnitario: pu.toFixed(2),
          subtotal: itemSub.toFixed(2),
        });
      }
      await manager.update(Comprobante, { id: comp.id, tenantId }, {
        subtotal: subtotal.toFixed(2),
        ivaMonto: ivaMonto.toFixed(2),
        total: total.toFixed(2),
      });

      if (Math.abs(delta) >= 0.005) {
        const cuenta = await manager.findOne(CuentaCorriente, { where: { tenantId, clienteId } });
        if (cuenta) {
          const nuevoSaldo = Math.round((Number(cuenta.saldo) + delta) * 100) / 100;
          await manager.update(CuentaCorriente, { id: cuenta.id }, { saldo: nuevoSaldo.toFixed(6) });
        }
      }
    });

    return { data: { ok: true, total, delta } };
  }

  async registrarPago(clienteId: string, dto: RegistrarPagoDto, userId: string) {
    await this.assertFacturadorSimple();
    await this.assertCliente(clienteId);
    const tenantId = this.tenantContext.getTenantId();

    const rows = (await this.dataSource.query(
      `SELECT public.registrar_pago_cliente_desde_cuenta_corriente(
        $1::uuid, $2::uuid, $3::numeric, $4::public.tipo_pago, $5::text, $6::text, $7::uuid
      ) AS resultado`,
      [
        tenantId,
        clienteId,
        dto.monto,
        dto.tipoPago ?? TipoPago.efectivo,
        dto.referencia ?? null,
        dto.notas ?? null,
        userId,
      ],
    )) as Array<{ resultado?: Record<string, unknown> }>;

    return { data: { resultado: rows[0]?.resultado ?? null } };
  }

  async getCargosHoy() {
    await this.assertFacturadorSimpleOrPos();
    const sucursalId = await this.sucursalContext.requireSucursalId();
    const tenantId = this.tenantContext.getTenantId();
    const fechaHoy = hoyEnAR();

    const sucursal = await this.sucursalRepo.findOne({ where: { id: sucursalId, tenantId } });
    if (!sucursal) throw new NotFoundException('Sucursal no encontrada');

    const prefs = readCcDistribuidoraPrefs(sucursal.businessPrefs);
    if (!prefs.panelMovimientosDia) {
      return {
        fecha: fechaHoy,
        sucursal_id: sucursalId,
        habilitado: false,
        por_cliente: {},
      };
    }

    const rows = await this.comprobanteRepo.find({
      where: {
        tenantId,
        sucursalId,
        fecha: fechaHoy,
        metodoPago: 'cuenta_corriente',
        estado: In(ESTADOS_MOVIMIENTOS_DIA),
      },
      select: { clienteId: true },
    });

    const porCliente = contarCargosHoyPorCliente(
      rows
        .filter((r) => r.clienteId != null)
        .map((r) => ({ clienteId: r.clienteId! })),
    );

    return {
      fecha: fechaHoy,
      sucursal_id: sucursalId,
      habilitado: true,
      por_cliente: porCliente,
    };
  }

  async getLiquidacionComprobante(
    clienteId: string,
    comprobanteId: string,
    query: MovimientosDiaQueryDto,
  ) {
    await this.assertFacturadorSimpleOrPos();
    await this.assertCliente(clienteId);
    if (!query.sucursal_id) {
      throw new BadRequestException('Indicá la sucursal operativa.');
    }

    const tenantId = this.tenantContext.getTenantId();
    const sucursal = await this.sucursalRepo.findOne({
      where: { id: query.sucursal_id, tenantId },
    });
    if (!sucursal) throw new NotFoundException('Sucursal no encontrada');

    const prefs = readCcDistribuidoraPrefs(sucursal.businessPrefs);
    if (!prefs.permitirLiquidacionItemsDia) {
      throw new ForbiddenException(
        'La liquidación de precios del día no está habilitada en esta sucursal.',
      );
    }

    const comp = await this.comprobanteRepo.findOne({ where: { id: comprobanteId, tenantId } });
    if (!comp || comp.clienteId !== clienteId) {
      throw new NotFoundException('Comprobante no encontrado.');
    }

    const val = validarComprobanteLiquidable({
      fechaHoy: hoyEnAR(),
      sucursalId: query.sucursal_id,
      comprobante: {
        fecha: comp.fecha,
        metodoPago: comp.metodoPago,
        estado: comp.estado,
        tipo: comp.tipo,
        cae: comp.cae,
        sucursalId: comp.sucursalId,
      },
    });
    if (!val.ok) {
      throw new HttpException(val.error, val.status);
    }

    const compItems = await this.compItemRepo.find({ where: { comprobanteId: comp.id } });
    const productIds = [...new Set(compItems.map((i) => i.productoId))];
    const products =
      productIds.length > 0
        ? await this.productoRepo.find({ where: { tenantId, id: In(productIds) } })
        : [];
    const productMap = new Map(products.map((p) => [p.id, p]));
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const pv = tenant?.puntoDeVenta ?? 1;

    const tipoLabel = formatearTipoComprobante(comp.tipo);
    const numeroLabel = formatearNumeroComprobante(pv, comp.numero);

    return {
      comprobante_id: comp.id,
      descripcion: `${tipoLabel} ${numeroLabel}`,
      total_label: formatCurrencyAr(Number(comp.total)),
      items: compItems.map((it) => {
        const p = productMap.get(it.productoId);
        const sub = Number(it.subtotal);
        return {
          id: it.id,
          nombre: p?.nombre ?? 'Producto',
          codigo: p?.codigo ?? null,
          cantidad: Number(it.cantidad),
          cantidadLabel: String(Number(it.cantidad)),
          precioUnitario: Number(it.precioUnitario),
          precioUnitarioLabel: formatCurrencyAr(Number(it.precioUnitario)),
          subtotal: sub,
          subtotalLabel: formatCurrencyAr(sub),
        };
      }),
    };
  }

  async actualizarPagoExtracto(
    clienteId: string,
    pagoId: string,
    dto: PatchPagoExtractoDto,
    user: AccessTokenPayload,
  ) {
    await this.assertFacturadorSimple();
    if (resolveAppRole(user) === 'visor') {
      throw new ForbiddenException('Los usuarios visor no pueden editar pagos.');
    }
    await this.assertCliente(clienteId);
    const tenantId = this.tenantContext.getTenantId();

    const pago = await this.pagoRepo.findOne({ where: { id: pagoId, tenantId, clienteId } });
    if (!pago) throw new NotFoundException('Pago no encontrado');

    const monto = Math.round(Number(dto.monto) * 100) / 100;
    if (!Number.isFinite(monto) || monto <= 0) {
      throw new BadRequestException('El monto debe ser mayor a cero.');
    }

    const rows = (await this.dataSource.query(
      `SELECT public.actualizar_pago_cliente_extracto(
        $1::uuid, $2::uuid, $3::numeric, $4::date, $5::public.tipo_pago, $6::text, $7::text
      ) AS result`,
      [
        tenantId,
        pagoId,
        monto,
        dto.fecha,
        dto.tipo_pago ?? TipoPago.efectivo,
        dto.referencia ?? null,
        dto.notas ?? null,
      ],
    )) as Array<{ result?: { delta?: unknown } }>;

    const deltaRaw = rows[0]?.result?.delta;
    const delta = Number(deltaRaw);
    return { ok: true, delta: Number.isFinite(delta) ? delta : 0 };
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

  private async assertCliente(clienteId: string): Promise<Cliente> {
    const cliente = await this.clienteRepo.findOne({
      where: { id: clienteId, tenantId: this.tenantContext.getTenantId() },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');
    return cliente;
  }

  private async assertFacturadorSimple(): Promise<void> {
    const modulos = await this.moduloRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId() },
    });
    if (!modulos?.facturadorSimple) {
      throw new ForbiddenException('M├│dulo facturador_simple no habilitado');
    }
  }

  private async assertFacturadorSimpleOrPos(): Promise<void> {
    const modulos = await this.moduloRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId() },
    });
    if (!modulos?.facturadorSimple && !modulos?.facturadorPos) {
      throw new ForbiddenException('M├│dulo facturador no habilitado');
    }
  }
}
