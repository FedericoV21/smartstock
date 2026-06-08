import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Cliente } from '../catalog/entities/cliente.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { CobranzaFactura } from '../cobranza/entities/cobranza-factura.entity';
import { CobranzaPago } from '../cobranza/entities/cobranza-pago.entity';
import { ClienteCuentaCorrienteService } from '../cuenta-corriente/cliente-cuenta-corriente.service';
import { ExtractoQueryDto } from '../cuenta-corriente/dto/extracto-query.dto';
import { Pago } from '../cuenta-corriente/entities/pago.entity';
import { ProveedorCuentaCorrienteService } from '../cuenta-corriente/proveedor-cuenta-corriente.service';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import {
  ExtractoClienteReportQueryDto,
  ExtractoProveedorReportQueryDto,
  RecibosQueryDto,
} from './dto/report-period-query.dto';
import { resolverPeriodoReporteConLabel } from './utils/periodo-reporte.util';
import {
  armarResumenRecibos,
  etiquetaTipoPago,
  recibosACsv,
  type ReciboReportItem,
} from './utils/recibos-report.util';
import { round2 } from './utils/report-comprobante-rules.util';

@Injectable()
export class ReportsExtendedService {
  constructor(
    @InjectRepository(Comprobante) private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(CobranzaPago) private readonly cobranzaPagoRepo: Repository<CobranzaPago>,
    @InjectRepository(Pago) private readonly pagoRepo: Repository<Pago>,
    @InjectRepository(Cliente) private readonly clienteRepo: Repository<Cliente>,
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
    private readonly clienteCcService: ClienteCuentaCorrienteService,
    private readonly proveedorCcService: ProveedorCuentaCorrienteService,
  ) {}

  async getRecibos(query: RecibosQueryDto) {
    await this.assertFacturadorSimple();
    const sucursalId = await this.sucursalContext.resolveSucursalId();
    const tenantId = this.tenantContext.getTenantId();
    const { desde, hasta, periodo: periodoKey } = resolverPeriodoReporteConLabel(this.queryRecord(query), {
      defaultKey: 'mes',
    });
    const clienteFiltro = query.cliente_id?.trim() || null;

    const recibosQb = this.comprobanteRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere("c.tipo = 'recibo'")
      .andWhere('c.estado = :estado', { estado: EstadoComprobante.emitido })
      .andWhere('c.fecha >= :desde', { desde })
      .andWhere('c.fecha <= :hasta', { hasta })
      .orderBy('c.fecha', 'DESC')
      .addOrderBy('c.numero', 'DESC');
    if (sucursalId) recibosQb.andWhere('c.sucursal_id = :sucursalId', { sucursalId });
    if (clienteFiltro) recibosQb.andWhere('c.cliente_id = :clienteFiltro', { clienteFiltro });

    const recibos = await recibosQb.getMany();
    const clienteIds = [...new Set(recibos.map((r) => r.clienteId).filter(Boolean))] as string[];
    const clienteMap = new Map<string, string>();
    if (clienteIds.length > 0) {
      const rows = await this.clienteRepo
        .createQueryBuilder('cl')
        .where('cl.tenant_id = :tenantId', { tenantId })
        .andWhere('cl.id IN (:...ids)', { ids: clienteIds })
        .getMany();
      for (const cl of rows) {
        clienteMap.set(cl.id, cl.nombre);
      }
    }

    const desdeItems: ReciboReportItem[] = recibos.map((r) => ({
      id: r.id,
      fecha: r.fecha,
      numero: r.numero,
      total: round2(Number(r.total)),
      metodo_pago: r.metodoPago || 'Sin especificar',
      cliente_nombre: (r.clienteId && clienteMap.get(r.clienteId)) || 'Sin cliente',
      origen: 'recibo',
    }));

    const cobranzaQb = this.cobranzaPagoRepo
      .createQueryBuilder('cp')
      .innerJoin(CobranzaFactura, 'cf', 'cf.id = cp.cobranza_factura_id AND cf.tenant_id = cp.tenant_id')
      .innerJoin(Comprobante, 'comp', 'comp.id = cf.comprobante_id AND comp.tenant_id = cp.tenant_id')
      .leftJoin(Cliente, 'cli', 'cli.id = cf.cliente_id AND cli.tenant_id = cp.tenant_id')
      .select([
        'cp.id AS id',
        'cp.fecha AS fecha',
        'cp.monto AS monto',
        'cp.tipo_pago AS tipo_pago',
        'cli.nombre AS cliente_nombre',
      ])
      .where('cp.tenant_id = :tenantId', { tenantId })
      .andWhere('cp.recibo_comprobante_id IS NULL')
      .andWhere('cp.fecha >= :desde', { desde })
      .andWhere('cp.fecha <= :hasta', { hasta })
      .orderBy('cp.fecha', 'DESC');
    if (sucursalId) cobranzaQb.andWhere('comp.sucursal_id = :sucursalId', { sucursalId });
    if (clienteFiltro) cobranzaQb.andWhere('cf.cliente_id = :clienteFiltro', { clienteFiltro });

    const cobranzaRows = await cobranzaQb.getRawMany<{
      id: string;
      fecha: string;
      monto: string;
      tipo_pago: string;
      cliente_nombre: string | null;
    }>();

    const desdePagos: ReciboReportItem[] = cobranzaRows.map((r) => ({
      id: `pago-${r.id}`,
      fecha: r.fecha,
      numero: null,
      total: round2(Number(r.monto)),
      metodo_pago: etiquetaTipoPago(r.tipo_pago),
      cliente_nombre: r.cliente_nombre ?? 'Sin cliente',
      sin_comprobante_recibo: true,
      origen: 'cobranza_sin_recibo',
    }));

    let desdePagosCc: ReciboReportItem[] = [];
    if (!sucursalId) {
      const pagoQb = this.pagoRepo
        .createQueryBuilder('p')
        .leftJoin(Cliente, 'cli', 'cli.id = p.cliente_id AND cli.tenant_id = p.tenant_id')
        .select([
          'p.id AS id',
          'p.fecha AS fecha',
          'p.monto AS monto',
          'p.tipo_pago AS tipo_pago',
          'p.referencia AS referencia',
          'cli.nombre AS cliente_nombre',
        ])
        .where('p.tenant_id = :tenantId', { tenantId })
        .andWhere('p.comprobante_id IS NULL')
        .andWhere('p.fecha >= :desde', { desde })
        .andWhere('p.fecha <= :hasta', { hasta })
        .orderBy('p.fecha', 'DESC');
      if (clienteFiltro) pagoQb.andWhere('p.cliente_id = :clienteFiltro', { clienteFiltro });

      const ccRows = await pagoQb.getRawMany<{
        id: string;
        fecha: string;
        monto: string;
        tipo_pago: string;
        referencia: string | null;
        cliente_nombre: string | null;
      }>();

      desdePagosCc = ccRows.map((r) => {
        const base = etiquetaTipoPago(r.tipo_pago);
        const ref = r.referencia?.trim();
        const metodo = ref ? `${base} · Ref. ${ref.slice(0, 40)}` : base;
        return {
          id: `cc-${r.id}`,
          fecha: r.fecha,
          numero: null,
          total: round2(Number(r.monto)),
          metodo_pago: metodo,
          cliente_nombre: r.cliente_nombre ?? 'Sin cliente',
          sin_comprobante_recibo: true,
          origen: 'cuenta_corriente' as const,
        };
      });
    }

    const items = [...desdeItems, ...desdePagos, ...desdePagosCc].sort((a, b) => {
      const d = String(b.fecha).localeCompare(String(a.fecha));
      if (d !== 0) return d;
      return (b.numero ?? 0) - (a.numero ?? 0);
    });

    if ((query.export ?? '').toLowerCase() === 'csv') {
      return {
        csv: recibosACsv(items),
        filename: `reporte-recibos-${desde}-${hasta}.csv`,
      };
    }

    return {
      sucursal_id: sucursalId,
      periodo: { key: periodoKey, desde, hasta },
      filtros: { cliente_id: clienteFiltro },
      resumen: armarResumenRecibos(items),
      items,
    };
  }

  async getExtractoCuentaCorriente(query: ExtractoClienteReportQueryDto) {
    const clienteId = query.cliente_id?.trim();
    if (!clienteId) {
      throw new BadRequestException('Indicá cliente_id.');
    }
    const ccQuery: ExtractoQueryDto = {
      periodo: query.periodo,
      desde: query.desde,
      hasta: query.hasta,
      sucursal_id: query.sucursalId,
      export: query.export,
    };
    const result = await this.clienteCcService.getExtracto(clienteId, ccQuery);
    if ('csv' in result) return result;
    return result.data;
  }

  async getExtractoCuentaCorrienteProveedor(query: ExtractoProveedorReportQueryDto) {
    const proveedorId = query.proveedor_id?.trim();
    if (!proveedorId) {
      throw new BadRequestException('Indicá proveedor_id.');
    }
    const ccQuery: ExtractoQueryDto = {
      periodo: query.periodo,
      desde: query.desde,
      hasta: query.hasta,
      export: query.export,
    };
    const result = await this.proveedorCcService.getExtracto(proveedorId, ccQuery);
    if ('csv' in result) return result;
    return result.data;
  }

  private queryRecord(query: RecibosQueryDto): Record<string, string | undefined> {
    return {
      periodo: query.periodo,
      desde: query.desde,
      hasta: query.hasta,
      sucursal_id: query.sucursalId,
    };
  }

  private async assertFacturadorSimple(): Promise<void> {
    const modulos = await this.moduloRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId() },
    });
    if (!modulos?.facturadorSimple) {
      throw new ForbiddenException('Los reportes no están habilitados para tu plan.');
    }
  }
}
