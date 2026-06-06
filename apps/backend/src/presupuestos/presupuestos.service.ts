import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Cliente } from '../catalog/entities/cliente.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { TipoComprobante } from '../facturacion/enums/tipo-comprobante.enum';
import { FacturacionService } from '../facturacion/facturacion.service';
import { PedidoItem } from '../pedidos/entities/pedido-item.entity';
import { Pedido } from '../pedidos/entities/pedido.entity';
import { EstadoPedido } from '../pedidos/enums/estado-pedido.enum';
import { PedidoWorkflowService } from '../pedidos/pedido-workflow.service';
import { ConvertirAFacturaDto, ConvertirATicketDto } from './dto/convertir-presupuesto.dto';
import { ListPresupuestosQueryDto } from './dto/list-presupuestos-query.dto';
import {
  asegurarNumeroOrdenOrigen,
  ConflictOrdenError,
  validarOrdenSinFacturaFiscal,
  validarOrdenSinTicketEmitido,
} from './utils/numero-orden.util';
import { resolverTipoFacturaVentaSolicitado } from './utils/tipo-factura-venta.util';
import { hoyEnArgentina } from '../facturacion/utils/fecha-argentina';

const TIPOS_FISCALES = [
  TipoComprobante.factura_a,
  TipoComprobante.factura_b,
  TipoComprobante.factura_c,
] as const;

type PresupuestoConversiones = {
  ticket_id: string | null;
  ticket_numero: number | null;
  factura_id: string | null;
  factura_tipo: string | null;
  factura_numero: number | null;
  pedido_id: string | null;
};

@Injectable()
export class PresupuestosService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Comprobante) private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(ComprobanteItem) private readonly comprobanteItemRepo: Repository<ComprobanteItem>,
    @InjectRepository(Cliente) private readonly clienteRepo: Repository<Cliente>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    @InjectRepository(Pedido) private readonly pedidoRepo: Repository<Pedido>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
    private readonly facturacionService: FacturacionService,
    private readonly pedidoWorkflowService: PedidoWorkflowService,
  ) {}

  async list(query: ListPresupuestosQueryDto) {
    await this.assertPresupuestos();
    const tenantId = this.tenantContext.getTenantId();
    if (query.sucursal_id) {
      this.sucursalContext.setActiveSucursalId(query.sucursal_id);
    }
    const sucursalId = await this.sucursalContext.resolveSucursalId();

    const pagina = query.pagina ?? 1;
    const porPagina = query.por_pagina ?? 25;
    const offset = (pagina - 1) * porPagina;

    const qb = this.comprobanteRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.tipo = :tipo', { tipo: TipoComprobante.presupuesto })
      .orderBy('c.fecha', 'DESC')
      .addOrderBy('c.numero', 'DESC')
      .skip(offset)
      .take(porPagina);

    if (sucursalId) {
      qb.andWhere('c.sucursal_id = :sucursalId', { sucursalId });
    }

    const [filas, total] = await qb.getManyAndCount();
    const numerosOrden = [
      ...new Set(
        filas
          .map((p) => p.numeroOrden)
          .filter((n): n is number => typeof n === 'number' && Number.isFinite(n)),
      ),
    ];
    const conversionesMap = await this.conversionesPorNumeroOrden(tenantId, numerosOrden);

    const clienteIds = [...new Set(filas.map((f) => f.clienteId).filter((id): id is string => !!id))];
    const clientes =
      clienteIds.length > 0
        ? await this.clienteRepo.find({
            where: { tenantId, id: In(clienteIds) },
            select: { id: true, nombre: true, razonSocial: true, condicionIva: true },
          })
        : [];
    const clienteMap = new Map(clientes.map((c) => [c.id, c]));

    const tenant = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: { condicionIva: true },
    });

    const presupuestos = filas.map((p) => {
      const orden = p.numeroOrden;
      const conversiones =
        typeof orden === 'number' && Number.isFinite(orden)
          ? (conversionesMap.get(orden) ?? emptyConversiones())
          : emptyConversiones();
      const cl = p.clienteId ? clienteMap.get(p.clienteId) : null;
      return {
        id: p.id,
        tipo: p.tipo,
        numero: p.numero,
        numero_orden: p.numeroOrden,
        fecha: p.fecha,
        subtotal: Number(p.subtotal),
        iva_monto: Number(p.ivaMonto),
        total: Number(p.total),
        estado: p.estado,
        pdf_url: p.pdfUrl,
        created_at: p.createdAt.toISOString(),
        cliente: cl
          ? {
              nombre: cl.nombre,
              razon_social: cl.razonSocial,
              condicion_iva: cl.condicionIva,
            }
          : null,
        conversiones,
      };
    });

    return {
      presupuestos,
      sucursal_id: sucursalId,
      total,
      pagina,
      por_pagina: porPagina,
      tenant_condicion_iva: tenant?.condicionIva ?? null,
    };
  }

  async getById(id: string) {
    await this.assertPresupuestosOrFacturacion();
    const tenantId = this.tenantContext.getTenantId();
    const detail = await this.facturacionService.getById(id);
    if (detail.data.tipo !== TipoComprobante.presupuesto) {
      throw new NotFoundException('Presupuesto no encontrado');
    }
    return detail;
  }

  async convertirAPedido(id: string, sucursalIdParam: string | undefined, userId: string) {
    await this.assertPresupuestos();
    await this.assertPedidos();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.resolveSucursalRequired(sucursalIdParam);

    const presupuesto = await this.loadPresupuesto(tenantId, id, sucursalId);
    this.assertNoAnulado(presupuesto);

    const items = await this.comprobanteItemRepo.find({ where: { comprobanteId: presupuesto.id } });
    if (items.length === 0) {
      throw new BadRequestException('El presupuesto no tiene ├¡tems');
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        await validarOrdenSinFacturaFiscal(manager, {
          tenantId,
          numeroOrden: presupuesto.numeroOrden,
        });

        const numeroOrden = await asegurarNumeroOrdenOrigen(manager, {
          tenantId,
          origen: 'comprobante',
          origenId: presupuesto.id,
          numeroOrdenActual: presupuesto.numeroOrden,
        });

        const fechaPedido = hoyEnArgentina();
        const filasItems = items.map((i) => ({
          productoId: i.productoId,
          cantidad: Number(i.cantidad),
          precioUnitario: Number(i.precioUnitario),
          subtotal: Number(i.subtotal),
        }));
        const totalPedido = roundMoney(filasItems.reduce((acc, it) => acc + it.subtotal, 0));
        const workflowBorradorId = await this.pedidoWorkflowService.resolveEstadoIdBySlug('borrador');

        const pedido = manager.create(Pedido, {
          tenantId,
          sucursalId,
          clienteId: presupuesto.clienteId,
          estado: EstadoPedido.borrador,
          workflowEstadoId: workflowBorradorId,
          fecha: fechaPedido,
          total: totalPedido.toFixed(2),
          notas: `Generado desde presupuesto #${presupuesto.numero ?? presupuesto.numeroOrden ?? ''}`,
          usuarioId: userId,
          numeroOrden,
        });
        const saved = await manager.save(Pedido, pedido);

        const itemEntities = filasItems.map((row) =>
          manager.create(PedidoItem, {
            pedidoId: saved.id,
            productoId: row.productoId,
            cantidad: row.cantidad.toFixed(3),
            precioUnitario: row.precioUnitario.toFixed(2),
            subtotal: row.subtotal.toFixed(2),
          }),
        );
        await manager.save(PedidoItem, itemEntities);

        return {
          presupuesto_id: presupuesto.id,
          pedido_id: saved.id,
          sucursal_id: sucursalId,
        };
      });
    } catch (e) {
      if (e instanceof ConflictOrdenError) {
        throw new ConflictException(e.message);
      }
      throw e;
    }
  }

  async convertirAFactura(id: string, dto: ConvertirAFacturaDto, userId: string) {
    await this.assertPresupuestos();
    await this.assertFacturadorSimple();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.resolveSucursalRequired(dto.sucursal_id);

    const presupuesto = await this.loadPresupuesto(tenantId, id);
    this.assertNoAnulado(presupuesto);
    if (!presupuesto.clienteId) {
      throw new BadRequestException('El presupuesto debe tener un cliente para facturar');
    }

    const items = await this.comprobanteItemRepo.find({ where: { comprobanteId: presupuesto.id } });
    if (items.length === 0) {
      throw new BadRequestException('El presupuesto no tiene ├¡tems');
    }

    const [tenant, cliente] = await Promise.all([
      this.tenantRepo.findOne({ where: { id: tenantId }, select: { condicionIva: true } }),
      this.clienteRepo.findOne({
        where: { id: presupuesto.clienteId, tenantId },
        select: { condicionIva: true },
      }),
    ]);
    if (!tenant) throw new NotFoundException('Tenant no encontrado');
    if (!cliente) throw new NotFoundException('Cliente no encontrado');

    const tipo = resolverTipoFacturaVentaSolicitado(dto.tipo, tenant.condicionIva, cliente.condicionIva);

    let numeroOrden: number;
    try {
      numeroOrden = await this.dataSource.transaction(async (manager) => {
        await validarOrdenSinFacturaFiscal(manager, {
          tenantId,
          numeroOrden: presupuesto.numeroOrden,
        });
        return asegurarNumeroOrdenOrigen(manager, {
          tenantId,
          origen: 'comprobante',
          origenId: presupuesto.id,
          numeroOrdenActual: presupuesto.numeroOrden,
        });
      });
    } catch (e) {
      if (e instanceof ConflictOrdenError) throw new ConflictException(e.message);
      throw e;
    }

    const emit = await this.facturacionService.emitir(
      {
        tipo,
        sucursalId,
        clienteId: presupuesto.clienteId,
        notas: `Convertido desde presupuesto #${presupuesto.numero ?? presupuesto.numeroOrden ?? ''}`,
        numeroOrdenExplicito: numeroOrden,
        items: items.map((i) => ({
          productoId: i.productoId,
          cantidad: Number(i.cantidad),
          precioUnitario: Number(i.precioUnitario),
        })),
      },
      userId,
    );

    return {
      presupuesto_id: presupuesto.id,
      sucursal_id: sucursalId,
      comprobante_id: emit.data.id,
      pdf_url: emit.data.pdf?.pdfUrl ?? null,
      comprobante: emit.data,
    };
  }

  async convertirATicket(id: string, dto: ConvertirATicketDto, userId: string) {
    await this.assertPresupuestos();
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.resolveSucursalRequired(dto.sucursal_id);
    const metodoPago = parseMetodoPago(dto.metodo_pago);

    const presupuesto = await this.loadPresupuesto(tenantId, id);
    this.assertNoAnulado(presupuesto);
    if (metodoPago === 'cuenta_corriente' && !presupuesto.clienteId) {
      throw new BadRequestException(
        'Cuenta corriente requiere un cliente en el presupuesto (no alcanza consumidor final sin cuenta).',
      );
    }

    const items = await this.comprobanteItemRepo.find({ where: { comprobanteId: presupuesto.id } });
    if (items.length === 0) {
      throw new BadRequestException('El presupuesto no tiene ├¡tems');
    }

    let numeroOrden: number;
    try {
      numeroOrden = await this.dataSource.transaction(async (manager) => {
        await validarOrdenSinFacturaFiscal(manager, {
          tenantId,
          numeroOrden: presupuesto.numeroOrden,
        });
        await validarOrdenSinTicketEmitido(manager, {
          tenantId,
          numeroOrden: presupuesto.numeroOrden,
        });
        const orden = await asegurarNumeroOrdenOrigen(manager, {
          tenantId,
          origen: 'comprobante',
          origenId: presupuesto.id,
          numeroOrdenActual: presupuesto.numeroOrden,
        });
        await validarOrdenSinTicketEmitido(manager, { tenantId, numeroOrden: orden });
        return orden;
      });
    } catch (e) {
      if (e instanceof ConflictOrdenError) throw new ConflictException(e.message);
      throw e;
    }

    const emit = await this.facturacionService.emitir(
      {
        tipo: TipoComprobante.ticket,
        sucursalId,
        clienteId: presupuesto.clienteId ?? undefined,
        metodoPago,
        notas: `Venta en ticket (no fiscal) desde presupuesto #${presupuesto.numero ?? presupuesto.numeroOrden ?? ''}`,
        numeroOrdenExplicito: numeroOrden,
        items: items.map((i) => ({
          productoId: i.productoId,
          cantidad: Number(i.cantidad),
          precioUnitario: Number(i.precioUnitario),
        })),
      },
      userId,
    );

    return {
      presupuesto_id: presupuesto.id,
      sucursal_id: sucursalId,
      comprobante_id: emit.data.id,
      pdf_url: emit.data.pdf?.pdfUrl ?? null,
      comprobante: emit.data,
    };
  }

  private async conversionesPorNumeroOrden(
    tenantId: string,
    numerosOrden: number[],
  ): Promise<Map<number, PresupuestoConversiones>> {
    const map = new Map<number, PresupuestoConversiones>();
    if (!numerosOrden.length) return map;

    for (const n of numerosOrden) {
      map.set(n, emptyConversiones());
    }

    const [comps, peds] = await Promise.all([
      this.comprobanteRepo.find({
        where: {
          tenantId,
          numeroOrden: In(numerosOrden),
          tipo: In([...TIPOS_FISCALES, TipoComprobante.ticket]),
          estado: EstadoComprobante.emitido,
        },
        select: { id: true, tipo: true, numero: true, numeroOrden: true },
      }),
      this.pedidoRepo.find({
        where: { tenantId, numeroOrden: In(numerosOrden) },
        select: { id: true, numeroOrden: true },
      }),
    ]);

    for (const row of comps) {
      const orden = row.numeroOrden;
      if (orden == null) continue;
      const slot = map.get(orden);
      if (!slot) continue;
      if (row.tipo === TipoComprobante.ticket && !slot.ticket_id) {
        slot.ticket_id = row.id;
        slot.ticket_numero = row.numero;
      }
      if ((TIPOS_FISCALES as readonly string[]).includes(row.tipo) && !slot.factura_id) {
        slot.factura_id = row.id;
        slot.factura_tipo = row.tipo;
        slot.factura_numero = row.numero;
      }
    }

    for (const row of peds) {
      const orden = row.numeroOrden;
      if (orden == null) continue;
      const slot = map.get(orden);
      if (!slot || slot.pedido_id) continue;
      slot.pedido_id = row.id;
    }

    return map;
  }

  private async loadPresupuesto(tenantId: string, id: string, sucursalId?: string) {
    const where: { id: string; tenantId: string; tipo: TipoComprobante; sucursalId?: string } = {
      id,
      tenantId,
      tipo: TipoComprobante.presupuesto,
    };
    if (sucursalId) where.sucursalId = sucursalId;

    const presupuesto = await this.comprobanteRepo.findOne({ where });
    if (!presupuesto) throw new NotFoundException('Presupuesto no encontrado');
    return presupuesto;
  }

  private assertNoAnulado(p: Comprobante) {
    if (p.estado === EstadoComprobante.anulado) {
      throw new BadRequestException('El presupuesto est├í anulado');
    }
  }

  private async resolveSucursalRequired(sucursalIdParam?: string): Promise<string> {
    if (sucursalIdParam?.trim()) {
      this.sucursalContext.setActiveSucursalId(sucursalIdParam.trim());
    }
    return this.sucursalContext.requireSucursalId();
  }

  private async assertPresupuestos() {
    const tenantId = this.tenantContext.getTenantId();
    const mod = await this.moduloRepo.findOne({ where: { tenantId } });
    if (!mod?.presupuestos) {
      throw new ForbiddenException('El m├│dulo presupuestos no est├í habilitado.');
    }
  }

  private async assertPresupuestosOrFacturacion() {
    const tenantId = this.tenantContext.getTenantId();
    const mod = await this.moduloRepo.findOne({ where: { tenantId } });
    if (!mod?.presupuestos && !mod?.facturadorSimple) {
      throw new ForbiddenException('Presupuestos o facturador_simple requerido.');
    }
  }

  private async assertPedidos() {
    const tenantId = this.tenantContext.getTenantId();
    const mod = await this.moduloRepo.findOne({ where: { tenantId } });
    if (!mod?.pedidos) {
      throw new ForbiddenException('El m├│dulo pedidos no est├í habilitado.');
    }
  }

  private async assertFacturadorSimple() {
    const tenantId = this.tenantContext.getTenantId();
    const mod = await this.moduloRepo.findOne({ where: { tenantId } });
    if (!mod?.facturadorSimple) {
      throw new ForbiddenException('El m├│dulo facturador_simple no est├í habilitado.');
    }
  }

  private async assertFacturadorPos() {
    const tenantId = this.tenantContext.getTenantId();
    const mod = await this.moduloRepo.findOne({ where: { tenantId } });
    if (!mod?.facturadorPos) {
      throw new ForbiddenException('El m├│dulo facturador_pos no est├í habilitado.');
    }
  }
}

function emptyConversiones(): PresupuestoConversiones {
  return {
    ticket_id: null,
    ticket_numero: null,
    factura_id: null,
    factura_tipo: null,
    factura_numero: null,
    pedido_id: null,
  };
}

function roundMoney(n: number): number {
  return Number(n.toFixed(2));
}

const METODOS = ['efectivo', 'debito', 'credito', 'transferencia', 'cuenta_corriente'] as const;

function parseMetodoPago(raw: unknown): string {
  if (typeof raw === 'string' && (METODOS as readonly string[]).includes(raw)) {
    return raw;
  }
  return 'efectivo';
}
