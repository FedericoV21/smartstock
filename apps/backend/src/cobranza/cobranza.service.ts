import {

  BadRequestException,

  ForbiddenException,

  Injectable,

  NotFoundException,

} from '@nestjs/common';

import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { DataSource, In, IsNull, Not, Repository } from 'typeorm';



import { TenantContext } from '../auth/tenant-context.service';

import { Cliente } from '../catalog/entities/cliente.entity';

import { Tenant } from '../config/entities/tenant.entity';

import { ModuloConfig } from '../config/entities/modulo-config.entity';

import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';

import { TipoComprobante } from '../facturacion/enums/tipo-comprobante.enum';

import { Comprobante } from '../facturacion/entities/comprobante.entity';

import { CobroModalidad } from '../cuenta-corriente/enums/cobro-modalidad.enum';

import { CobroPeriodicidad } from '../cuenta-corriente/enums/cobro-periodicidad.enum';

import { formatCurrencyAr } from '../cuenta-corriente/utils/format-currency.util';

import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';

import { CobranzaReciboService } from './cobranza-recibo.service';

import { RegistrarPagoCobranzaDto } from './dto/registrar-pago-cobranza.dto';

import { CobranzaFactura } from './entities/cobranza-factura.entity';

import { CobranzaPago } from './entities/cobranza-pago.entity';

import {

  anticipacionRecordatorioSegunCondicion,

  construirUrlWhatsAppCobranza,

  debeMostrarEnCampanaCobranza,

  telefonoArgentinoAE164,

  type CampanaCobranzaEstado,

} from './utils/cobranza-logic.util';

import {

  formatearNumeroComprobante,

  formatearTipoComprobante,

} from './utils/comprobante-formato.util';

import {

  resolverVencimientoCobranza,

  type CuentaCobroResolver,

} from './utils/dias-vencimiento-cuenta.util';

import { formatDateAr } from './utils/format-date-ar.util';

import { montoPendienteCuentaCorrienteEmitir } from './utils/monto-pendiente-emision.util';



const SNOOZE_HORAS = 24;



type CondicionCobroCuenta = {

  cobroModalidad: CobroModalidad | null;

  cobroPeriodicidad: CobroPeriodicidad | null;

  cobroDiasPlazo: number | null;

  cobroDiaVencimientoMes: number | null;

};



type CampanaItem = {

  id: string;

  clienteId: string;

  estado: CampanaCobranzaEstado;

  clienteNombre: string;

  telefonoRaw: string | null;

  telefonoE164: string | null;

  puedeWhatsApp: boolean;

  mensajeUrl: string | null;

  numeroComprobanteLabel: string;

  tipoComprobanteLabel: string;

  saldoPendiente: number;

  vencimientoAt: string;

  vencimientoLabel: string;

  pdfUrl: string | null;

};



function normalizarCuentaCobroParaResolver(

  input: CondicionCobroCuenta | null | undefined,

): CuentaCobroResolver {

  if (!input?.cobroModalidad) return null;

  if (

    input.cobroModalidad !== CobroModalidad.por_comprobante &&

    input.cobroModalidad !== CobroModalidad.periodico &&

    input.cobroModalidad !== CobroModalidad.dia_fijo_mes

  ) {

    return null;

  }

  return {

    cobroModalidad: input.cobroModalidad,

    cobroPeriodicidad:

      input.cobroPeriodicidad === CobroPeriodicidad.diaria ||

      input.cobroPeriodicidad === CobroPeriodicidad.semanal ||

      input.cobroPeriodicidad === CobroPeriodicidad.quincenal ||

      input.cobroPeriodicidad === CobroPeriodicidad.mensual

        ? input.cobroPeriodicidad

        : null,

    cobroDiasPlazo: typeof input.cobroDiasPlazo === 'number' ? input.cobroDiasPlazo : 7,

    cobroDiaVencimientoMes:

      typeof input.cobroDiaVencimientoMes === 'number' ? input.cobroDiaVencimientoMes : null,

  };

}



@Injectable()

export class CobranzaService {

  constructor(

    @InjectDataSource() private readonly dataSource: DataSource,

    @InjectRepository(CobranzaFactura) private readonly cobranzaRepo: Repository<CobranzaFactura>,

    @InjectRepository(CobranzaPago) private readonly cobranzaPagoRepo: Repository<CobranzaPago>,

    @InjectRepository(Comprobante) private readonly comprobanteRepo: Repository<Comprobante>,

    @InjectRepository(Cliente) private readonly clienteRepo: Repository<Cliente>,

    @InjectRepository(CuentaCorriente) private readonly cuentaRepo: Repository<CuentaCorriente>,

    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,

    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,

    private readonly cobranzaReciboService: CobranzaReciboService,

    private readonly tenantContext: TenantContext,

  ) {}



  async list(clienteId?: string) {

    await this.assertFacturadorSimple();

    const tenantId = this.tenantContext.getTenantId();

    const pv = await this.resolvePuntoDeVenta(tenantId);



    const qb = this.cobranzaRepo

      .createQueryBuilder('c')

      .where('c.tenant_id = :tenantId', { tenantId })

      .andWhere('c.saldo_pendiente > 0')

      .orderBy('c.vencimiento_at', 'ASC');



    if (clienteId?.trim()) {

      qb.andWhere('c.cliente_id = :clienteId', { clienteId: clienteId.trim() });

    }



    const rows = await qb.getMany();

    const clienteIds = [...new Set(rows.map((r) => r.clienteId))];

    const comprobanteIds = [...new Set(rows.map((r) => r.comprobanteId))];



    const [clientes, comprobantes] = await Promise.all([

      clienteIds.length

        ? this.clienteRepo.find({

            where: clienteIds.map((id) => ({ id, tenantId })),

            select: { id: true, nombre: true, telefono: true },

          })

        : [],

      comprobanteIds.length

        ? this.comprobanteRepo.find({

            where: comprobanteIds.map((id) => ({ id, tenantId })),

            select: { id: true, numero: true, tipo: true, pdfUrl: true, total: true },

          })

        : [],

    ]);



    const clienteMap = new Map(clientes.map((c) => [c.id, c]));

    const compMap = new Map(comprobantes.map((c) => [c.id, c]));



    const items = rows.map((r) => {

      const comp = compMap.get(r.comprobanteId);

      const cli = clienteMap.get(r.clienteId);

      const saldo = Number(r.saldoPendiente);

      return {

        id: r.id,

        saldoPendiente: saldo,

        montoOriginal: Number(r.montoOriginal),

        vencimientoAt: r.vencimientoAt.toISOString(),

        vencimientoLabel: formatDateAr(r.vencimientoAt),

        recordatorioSnoozeUntil: r.recordatorioSnoozeUntil?.toISOString() ?? null,

        comprobanteId: r.comprobanteId,

        numeroComprobanteLabel: comp ? formatearNumeroComprobante(pv, comp.numero) : '',

        tipoComprobanteLabel: comp ? formatearTipoComprobante(comp.tipo) : '',

        totalFactura: comp ? Number(comp.total) : 0,

        pdfUrl: comp?.pdfUrl ?? null,

        clienteNombre: cli?.nombre ?? '',

        saldoLabel: formatCurrencyAr(saldo),

      };

    });



    return { items };

  }



  async listPendientes() {

    await this.assertFacturadorSimple();

    const tenantId = this.tenantContext.getTenantId();

    const pv = await this.resolvePuntoDeVenta(tenantId);



    const rows = await this.cobranzaRepo

      .createQueryBuilder('c')

      .where('c.tenant_id = :tenantId', { tenantId })

      .andWhere('c.saldo_pendiente > 0')

      .getMany();



    const comprobanteIdsConCobranza = new Set(rows.map((r) => r.comprobanteId));

    const clienteIds = [...new Set(rows.map((r) => r.clienteId))];



    const condicionMaps = await this.loadCondicionesCobro(tenantId, clienteIds);

    const { periodicidadDiariaPorClienteId, condicionCobroPorClienteId, anticipacionPorClienteId } =

      condicionMaps;



    const ticketsLegacy = await this.comprobanteRepo.find({

      where: {

        tenantId,

        estado: EstadoComprobante.emitido,

        clienteId: Not(IsNull()),

        tipo: In([

          TipoComprobante.ticket,

          TipoComprobante.factura_a,

          TipoComprobante.factura_b,

          TipoComprobante.factura_c,

        ]),

      },

      select: {

        id: true,

        clienteId: true,

        numero: true,

        tipo: true,

        total: true,

        pdfUrl: true,

        fecha: true,

        metodoPago: true,

        metodoPagoDetalle: true,

      },

    });



    const clienteIdsLegacy = [

      ...new Set(ticketsLegacy.map((t) => t.clienteId).filter(Boolean)),

    ] as string[];

    const clienteIdsTodos = [...new Set([...clienteIds, ...clienteIdsLegacy])];



    const faltantesEnMapa = clienteIdsLegacy.filter((id) => !periodicidadDiariaPorClienteId.has(id));

    if (faltantesEnMapa.length > 0) {

      const extra = await this.loadCondicionesCobro(tenantId, faltantesEnMapa);

      for (const [k, v] of extra.periodicidadDiariaPorClienteId) {

        periodicidadDiariaPorClienteId.set(k, v);

      }

      for (const [k, v] of extra.condicionCobroPorClienteId) {

        condicionCobroPorClienteId.set(k, v);

      }

      for (const [k, v] of extra.anticipacionPorClienteId) {

        anticipacionPorClienteId.set(k, v);

      }

    }



    const cobranzaIds = rows.map((r) => r.id);

    const { ultimaFechaPagoPorCobranzaId, ultimaFechaPagoPorClienteId } =

      await this.loadUltimasFechasPago(tenantId, cobranzaIds);



    const saldoCuentaPorClienteId = await this.loadSaldosCuenta(tenantId, clienteIdsTodos);



    const clienteIdsNeeded = [...new Set([...clienteIds, ...clienteIdsLegacy])];

    const clientes = clienteIdsNeeded.length

      ? await this.clienteRepo.find({

          where: clienteIdsNeeded.map((id) => ({ id, tenantId })),

          select: { id: true, nombre: true, telefono: true },

        })

      : [];

    const clienteMap = new Map(clientes.map((c) => [c.id, c]));



    const comprobanteIds = [...new Set(rows.map((r) => r.comprobanteId))];

    const comprobantes = comprobanteIds.length

      ? await this.comprobanteRepo.find({

          where: comprobanteIds.map((id) => ({ id, tenantId })),

          select: { id: true, numero: true, tipo: true, pdfUrl: true, total: true },

        })

      : [];

    const compMap = new Map(comprobantes.map((c) => [c.id, c]));



    const items: CampanaItem[] = [];



    for (const r of rows) {

      const cl = clienteMap.get(r.clienteId);

      const comp = compMap.get(r.comprobanteId);

      if (!cl || !comp) continue;



      const ultimaFechaPagoYmd = ultimaFechaPagoPorCobranzaId.get(r.id) ?? null;

      const condicionCobro = normalizarCuentaCobroParaResolver(

        condicionCobroPorClienteId.get(cl.id),

      );

      let vencimientoReferencia = new Date(r.vencimientoAt);

      if (ultimaFechaPagoYmd && condicionCobro) {

        vencimientoReferencia = resolverVencimientoCobranza({

          fechaEmisionYmd: ultimaFechaPagoYmd,

          fechaExplicitaYmd: null,

          cuenta: condicionCobro,

        });

      }

      const snooze = r.recordatorioSnoozeUntil ? new Date(r.recordatorioSnoozeUntil) : null;

      const clientePeriodicidadDiaria = periodicidadDiariaPorClienteId.get(cl.id) === true;

      const { mostrar, estado } = debeMostrarEnCampanaCobranza({

        saldoPendiente: Number(r.saldoPendiente),

        vencimientoAt: vencimientoReferencia,

        recordatorioSnoozeUntil: snooze,

        clientePeriodicidadDiaria,

        anticipacionDias: anticipacionPorClienteId.get(cl.id),

      });

      if (!mostrar || !estado) continue;



      const e164 = telefonoArgentinoAE164(cl.telefono);

      const numeroLabel = formatearNumeroComprobante(pv, comp.numero);

      const tipoLabel = formatearTipoComprobante(comp.tipo);

      const saldo = Number(r.saldoPendiente);

      const vencIso = vencimientoReferencia.toISOString();

      const vencStr = formatDateAr(vencIso);



      let mensajeUrl: string | null = null;

      if (e164) {

        mensajeUrl = construirUrlWhatsAppCobranza({

          telefonoE164: e164,

          clienteNombre: cl.nombre,

          tipoFacturaLabel: tipoLabel,

          numeroComprobante: numeroLabel,

          saldoPendiente: saldo,

          monedaLabel: '$',

          vencimientoLabel: vencStr,

          estado,

          pdfUrl: comp.pdfUrl,

        });

      }



      items.push({

        id: r.id,

        clienteId: cl.id,

        estado,

        clienteNombre: cl.nombre,

        telefonoRaw: cl.telefono,

        telefonoE164: e164,

        puedeWhatsApp: Boolean(e164),

        mensajeUrl,

        numeroComprobanteLabel: numeroLabel,

        tipoComprobanteLabel: tipoLabel,

        saldoPendiente: saldo,

        vencimientoAt: vencIso,

        vencimientoLabel: vencStr,

        pdfUrl: comp.pdfUrl,

      });

    }



    const saldoRegistradoPorClienteId = new Map<string, number>();

    for (const it of items) {

      const prev = saldoRegistradoPorClienteId.get(it.clienteId) ?? 0;

      saldoRegistradoPorClienteId.set(it.clienteId, prev + it.saldoPendiente);

    }

    const saldoLegacyDisponiblePorClienteId = new Map<string, number>();

    for (const cid of clienteIdsTodos) {

      const saldoCuenta = saldoCuentaPorClienteId.get(cid) ?? 0;

      const saldoRegistrado = saldoRegistradoPorClienteId.get(cid) ?? 0;

      saldoLegacyDisponiblePorClienteId.set(cid, Math.max(0, saldoCuenta - saldoRegistrado));

    }



    type LegacyCandidato = {

      idBase: string;

      clienteId: string;

      clienteNombre: string;

      telefonoRaw: string | null;

      telefonoE164: string | null;

      numeroComprobanteLabel: string;

      tipoComprobanteLabel: string;

      deudaOriginal: number;

      vencimientoAt: string;

      pdfUrl: string | null;

    };



    const legacyCandidatos: LegacyCandidato[] = [];

    for (const t of ticketsLegacy) {

      if (!t.clienteId) continue;

      if (comprobanteIdsConCobranza.has(t.id)) continue;

      const cl = clienteMap.get(t.clienteId);

      if (!cl) continue;



      let saldo = montoPendienteCuentaCorrienteEmitir({

        metodoPago: t.metodoPago,

        metodoPagoDetalle: t.metodoPagoDetalle,

        totalComprobante: Number(t.total),

      });

      const mp = String(t.metodoPago ?? '')

        .trim()

        .toLowerCase();

      const ticketLegacySinMetodo = t.tipo === TipoComprobante.ticket && mp.length === 0;

      if (saldo <= 0.02 && ticketLegacySinMetodo) {

        saldo = Number(t.total);

      }

      if (saldo <= 0.02) continue;



      const vencimientoAt = `${t.fecha}T23:59:59.999-03:00`;

      legacyCandidatos.push({

        idBase: t.id,

        clienteId: t.clienteId,

        clienteNombre: cl.nombre,

        telefonoRaw: cl.telefono,

        telefonoE164: telefonoArgentinoAE164(cl.telefono),

        numeroComprobanteLabel: formatearNumeroComprobante(pv, t.numero),

        tipoComprobanteLabel: formatearTipoComprobante(t.tipo),

        deudaOriginal: saldo,

        vencimientoAt,

        pdfUrl: t.pdfUrl,

      });

    }



    const legacyPorCliente = new Map<

      string,

      {

        clienteNombre: string;

        telefonoRaw: string | null;

        telefonoE164: string | null;

        tipoComprobanteLabel: string;

        pdfUrl: string | null;

        deudaOriginalTotal: number;

        minVencimientoAt: string;

        comprobantesCount: number;

      }

    >();



    for (const c of legacyCandidatos) {

      const prev = legacyPorCliente.get(c.clienteId);

      if (!prev) {

        legacyPorCliente.set(c.clienteId, {

          clienteNombre: c.clienteNombre,

          telefonoRaw: c.telefonoRaw,

          telefonoE164: c.telefonoE164,

          tipoComprobanteLabel: c.tipoComprobanteLabel,

          pdfUrl: c.pdfUrl,

          deudaOriginalTotal: c.deudaOriginal,

          minVencimientoAt: c.vencimientoAt,

          comprobantesCount: 1,

        });

        continue;

      }

      legacyPorCliente.set(c.clienteId, {

        ...prev,

        deudaOriginalTotal: prev.deudaOriginalTotal + c.deudaOriginal,

        minVencimientoAt:

          new Date(c.vencimientoAt).getTime() < new Date(prev.minVencimientoAt).getTime()

            ? c.vencimientoAt

            : prev.minVencimientoAt,

        comprobantesCount: prev.comprobantesCount + 1,

      });

    }



    for (const [clienteId, data] of legacyPorCliente) {

      const disponible = saldoLegacyDisponiblePorClienteId.get(clienteId) ?? 0;

      if (disponible <= 0.02 || data.deudaOriginalTotal <= 0.02) continue;

      const saldoAsignado = Math.min(data.deudaOriginalTotal, disponible);

      const condicion = normalizarCuentaCobroParaResolver(

        condicionCobroPorClienteId.get(clienteId),

      );

      const ultimaPagoYmd = ultimaFechaPagoPorClienteId.get(clienteId) ?? null;

      let vencimientoReferencia = new Date(data.minVencimientoAt);

      if (ultimaPagoYmd && condicion) {

        vencimientoReferencia = resolverVencimientoCobranza({

          fechaEmisionYmd: ultimaPagoYmd,

          fechaExplicitaYmd: null,

          cuenta: condicion,

        });

      }

      const { mostrar, estado } = debeMostrarEnCampanaCobranza({

        saldoPendiente: saldoAsignado,

        vencimientoAt: vencimientoReferencia,

        recordatorioSnoozeUntil: null,

        clientePeriodicidadDiaria: periodicidadDiariaPorClienteId.get(clienteId) === true,

        anticipacionDias: anticipacionPorClienteId.get(clienteId),

      });

      if (!mostrar || !estado) continue;



      const vencIso = vencimientoReferencia.toISOString();

      const vencStr = formatDateAr(vencIso);

      let mensajeUrl: string | null = null;

      if (data.telefonoE164) {

        mensajeUrl = construirUrlWhatsAppCobranza({

          telefonoE164: data.telefonoE164,

          clienteNombre: data.clienteNombre,

          tipoFacturaLabel: 'Cuenta corriente',

          numeroComprobante: `${data.comprobantesCount} comprobantes`,

          saldoPendiente: saldoAsignado,

          monedaLabel: '$',

          vencimientoLabel: vencStr,

          estado,

          pdfUrl: data.pdfUrl,

        });

      }

      items.push({

        id: `legacy-cliente-${clienteId}`,

        clienteId,

        estado,

        clienteNombre: data.clienteNombre,

        telefonoRaw: data.telefonoRaw,

        telefonoE164: data.telefonoE164,

        puedeWhatsApp: Boolean(data.telefonoE164),

        mensajeUrl,

        numeroComprobanteLabel: `${data.comprobantesCount} comprobantes`,

        tipoComprobanteLabel: 'Cuenta corriente',

        saldoPendiente: saldoAsignado,

        vencimientoAt: vencIso,

        vencimientoLabel: vencStr,

        pdfUrl: data.pdfUrl,

      });

    }



    const vencMs = (v: string) => {

      const t = new Date(v).getTime();

      return Number.isFinite(t) ? t : 0;

    };

    items.sort((a, b) => {

      if (a.estado === 'vencido' && b.estado === 'vencido') {

        return vencMs(a.vencimientoAt) - vencMs(b.vencimientoAt);

      }

      if (a.estado === 'vencido' && b.estado !== 'vencido') return -1;

      if (a.estado !== 'vencido' && b.estado === 'vencido') return 1;

      if (a.estado === 'recordatorio_dia_5' && b.estado !== 'recordatorio_dia_5') return -1;

      if (a.estado !== 'recordatorio_dia_5' && b.estado === 'recordatorio_dia_5') return 1;

      return vencMs(a.vencimientoAt) - vencMs(b.vencimientoAt);

    });



    const vencidosCount = items.filter((it) => it.estado === 'vencido').length;



    return { items, count: items.length, vencidosCount };

  }



  async registrarPago(

    cobranzaId: string,

    dto: RegistrarPagoCobranzaDto,

    userId: string,

  ) {

    await this.assertFacturadorSimple();

    const tenantId = this.tenantContext.getTenantId();



    const cob = await this.cobranzaRepo.findOne({ where: { id: cobranzaId, tenantId } });

    if (!cob) throw new NotFoundException('Cobranza no encontrada');



    const cuenta = await this.cuentaRepo.findOne({

      where: { tenantId, clienteId: cob.clienteId },

      select: { cobroMontoMinimo: true },

    });

    const minimo = cuenta ? Number(cuenta.cobroMontoMinimo) : 0;

    const saldoPend = Number(cob.saldoPendiente);

    const monto = dto.monto;

    if (minimo > 0 && monto < minimo) {

      const tol = 0.01;

      const esLiquidacion = monto + tol >= saldoPend;

      if (!esLiquidacion) {

        throw new BadRequestException(

          `El monto no puede ser menor al m├¡nimo acordado (${minimo}) salvo liquidar el saldo total (${saldoPend}).`,

        );

      }

    }



    const tipoPago = dto.tipo_pago?.trim() || 'efectivo';

    const emitirRecibo = dto.emitir_recibo !== false;



    let resultado: Record<string, unknown> | null = null;

    try {

      const rows = (await this.dataSource.query(

        `SELECT public.registrar_pago_cobranza($1::uuid, $2::uuid, $3::numeric, $4::public.tipo_pago, $5::text, $6::uuid) AS result`,

        [tenantId, cobranzaId, monto, tipoPago, dto.notas ?? null, userId],

      )) as Array<{ result?: Record<string, unknown> }>;

      resultado = rows[0]?.result ?? null;

    } catch (e) {

      const msg = e instanceof Error ? e.message : String(e);

      if (msg.includes('supera el saldo')) {

        throw new BadRequestException(msg);

      }

      throw e;

    }



    const cobranzaPagoId =

      typeof resultado?.cobranza_pago_id === 'string' ? resultado.cobranza_pago_id : null;



    let recibo: { id: string; pdf_url: string | null } | null = null;

    let recibo_error: string | null = null;



    if (emitirRecibo && cobranzaPagoId) {

      const rec = await this.cobranzaReciboService.emitirTrasPago(

        {

          clienteId: cob.clienteId,

          monto,

          cobranzaPagoId,

          comprobanteFacturaId: cob.comprobanteId,

          tipoPago,

          notasCobro: dto.notas ?? null,

        },

        userId,

      );

      if (rec.ok) {

        recibo = { id: rec.comprobanteId, pdf_url: rec.pdfUrl };

      } else {

        recibo_error = rec.error;

      }

    }



    return { resultado, recibo, recibo_error };

  }



  async snooze(cobranzaId: string) {

    await this.assertFacturadorSimple();

    const tenantId = this.tenantContext.getTenantId();

    const hasta = new Date(Date.now() + SNOOZE_HORAS * 60 * 60 * 1000);



    const result = await this.cobranzaRepo

      .createQueryBuilder()

      .update(CobranzaFactura)

      .set({ recordatorioSnoozeUntil: hasta })

      .where('id = :id', { id: cobranzaId })

      .andWhere('tenant_id = :tenantId', { tenantId })

      .andWhere('saldo_pendiente > 0')

      .returning(['id'])

      .execute();



    if (!result.affected) {

      throw new NotFoundException('Cobranza no encontrada o ya saldada');

    }



    return {

      ok: true,

      recordatorio_snooze_until: hasta.toISOString(),

      horas: SNOOZE_HORAS,

    };

  }



  async clearSnooze(cobranzaId: string) {

    await this.assertFacturadorSimple();

    const tenantId = this.tenantContext.getTenantId();



    const result = await this.cobranzaRepo

      .createQueryBuilder()

      .update(CobranzaFactura)

      .set({ recordatorioSnoozeUntil: null })

      .where('id = :id', { id: cobranzaId })

      .andWhere('tenant_id = :tenantId', { tenantId })

      .andWhere('saldo_pendiente > 0')

      .returning(['id'])

      .execute();



    if (!result.affected) {

      throw new NotFoundException('Cobranza no encontrada o ya saldada');

    }



    return { ok: true };

  }



  private async resolvePuntoDeVenta(tenantId: string): Promise<number> {

    const tenant = await this.tenantRepo.findOne({

      where: { id: tenantId },

      select: { puntoDeVenta: true },

    });

    return tenant?.puntoDeVenta ?? 1;

  }



  private async loadCondicionesCobro(tenantId: string, clienteIds: string[]) {

    const periodicidadDiariaPorClienteId = new Map<string, boolean>();

    const anticipacionPorClienteId = new Map<string, number>();

    const condicionCobroPorClienteId = new Map<string, CondicionCobroCuenta>();



    if (clienteIds.length === 0) {

      return { periodicidadDiariaPorClienteId, condicionCobroPorClienteId, anticipacionPorClienteId };

    }



    const cuentas = await this.cuentaRepo.find({

      where: { tenantId, clienteId: In(clienteIds) },

      select: {

        clienteId: true,

        cobroModalidad: true,

        cobroPeriodicidad: true,

        cobroDiasPlazo: true,

        cobroDiaVencimientoMes: true,

      },

    });



    for (const c of cuentas) {

      if (!c.clienteId) continue;

      condicionCobroPorClienteId.set(c.clienteId, {

        cobroModalidad: c.cobroModalidad,

        cobroPeriodicidad: c.cobroPeriodicidad,

        cobroDiasPlazo: c.cobroDiasPlazo,

        cobroDiaVencimientoMes: c.cobroDiaVencimientoMes,

      });

      anticipacionPorClienteId.set(

        c.clienteId,

        anticipacionRecordatorioSegunCondicion({

          cobroModalidad: c.cobroModalidad,

          cobroPeriodicidad: c.cobroPeriodicidad,

          cobroDiasPlazo: c.cobroDiasPlazo,

        }),

      );

      if (

        c.cobroModalidad === CobroModalidad.periodico &&

        c.cobroPeriodicidad === CobroPeriodicidad.diaria

      ) {

        periodicidadDiariaPorClienteId.set(c.clienteId, true);

      }

    }



    return { periodicidadDiariaPorClienteId, condicionCobroPorClienteId, anticipacionPorClienteId };

  }



  private async loadUltimasFechasPago(tenantId: string, cobranzaIds: string[]) {

    const ultimaFechaPagoPorCobranzaId = new Map<string, string>();

    const ultimaFechaPagoPorClienteId = new Map<string, string>();



    if (cobranzaIds.length === 0) {

      return { ultimaFechaPagoPorCobranzaId, ultimaFechaPagoPorClienteId };

    }



    const cobranzas = await this.cobranzaRepo.find({

      where: { tenantId, id: In(cobranzaIds) },

      select: { id: true, clienteId: true },

    });

    const clienteIdPorCobranzaId = new Map(cobranzas.map((c) => [c.id, c.clienteId]));



    const pagos = await this.cobranzaPagoRepo.find({

      where: { tenantId, cobranzaFacturaId: In(cobranzaIds) },

      order: { fecha: 'DESC' },

      select: { cobranzaFacturaId: true, fecha: true },

    });



    for (const p of pagos) {

      if (!ultimaFechaPagoPorCobranzaId.has(p.cobranzaFacturaId)) {

        ultimaFechaPagoPorCobranzaId.set(p.cobranzaFacturaId, p.fecha);

      }

      const clienteId = clienteIdPorCobranzaId.get(p.cobranzaFacturaId);

      if (clienteId && !ultimaFechaPagoPorClienteId.has(clienteId)) {

        ultimaFechaPagoPorClienteId.set(clienteId, p.fecha);

      }

    }



    return { ultimaFechaPagoPorCobranzaId, ultimaFechaPagoPorClienteId };

  }



  private async loadSaldosCuenta(tenantId: string, clienteIds: string[]) {

    const saldoCuentaPorClienteId = new Map<string, number>();

    if (clienteIds.length === 0) return saldoCuentaPorClienteId;



    const cuentas = await this.cuentaRepo.find({

      where: { tenantId, clienteId: In(clienteIds) },

      select: { clienteId: true, saldo: true },

    });

    for (const c of cuentas) {

      if (c.clienteId) {

        saldoCuentaPorClienteId.set(c.clienteId, Number(c.saldo ?? 0));

      }

    }

    return saldoCuentaPorClienteId;

  }



  private async assertFacturadorSimple() {

    const tenantId = this.tenantContext.getTenantId();

    const mod = await this.moduloRepo.findOne({ where: { tenantId } });

    if (!mod?.facturadorSimple) {

      throw new ForbiddenException('El m├│dulo facturador_simple no est├í habilitado.');

    }

  }

}
