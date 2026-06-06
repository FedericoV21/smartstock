import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { BranchStockService } from '../branches/branch-stock.service';
import { REGISTRAR_MOVIMIENTO_SQL } from '../inventory/sql/registrar-movimiento.sql';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { TipoComprobante } from '../facturacion/enums/tipo-comprobante.enum';
import { Producto } from '../products/entities/producto.entity';
import { ChangePedidoEstadoDto } from './dto/change-pedido-estado.dto';
import { CreatePedidoDto } from './dto/create-pedido.dto';
import { FacturarPedidoDto } from './dto/facturar-pedido.dto';
import { ListPedidosQueryDto } from './dto/list-pedidos-query.dto';
import { PedidoItem } from './entities/pedido-item.entity';
import { Pedido } from './entities/pedido.entity';
import { PedidoWorkflowEstado } from './entities/pedido-workflow-estado.entity';
import { EstadoPedido } from './enums/estado-pedido.enum';
import { PedidoWorkflowService } from './pedido-workflow.service';

@Injectable()
export class PedidosService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Pedido) private readonly pedidoRepo: Repository<Pedido>,
    @InjectRepository(PedidoItem) private readonly pedidoItemRepo: Repository<PedidoItem>,
    @InjectRepository(Producto) private readonly productoRepo: Repository<Producto>,
    private readonly tenantContext: TenantContext,
    private readonly branchStockService: BranchStockService,
    private readonly pedidoWorkflowService: PedidoWorkflowService,
  ) {}

  async create(dto: CreatePedidoDto, userId: string) {
    const tenantId = this.tenantContext.getTenantId();
    const productIds = [...new Set(dto.items.map((it) => it.productoId))];
    const products = await this.productoRepo.find({
      where: { tenantId, activo: true, id: In(productIds) },
      select: { id: true, codigo: true, nombre: true, precioVenta: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));
    const missing = productIds.filter((id) => !productMap.has(id));
    if (missing.length > 0) throw new BadRequestException(`Productos inv├ílidos: ${missing.join(', ')}`);

    const items = dto.items.map((it) => {
      const p = productMap.get(it.productoId)!;
      const precioUnitario = it.precioUnitario ?? Number(p.precioVenta);
      const subtotal = roundMoney(precioUnitario * it.cantidad);
      return {
        productoId: it.productoId,
        cantidad: it.cantidad,
        precioUnitario,
        subtotal,
      };
    });

    const total = roundMoney(items.reduce((acc, it) => acc + it.subtotal, 0));
    const workflowBorradorId = await this.pedidoWorkflowService.resolveEstadoIdBySlug('borrador');

    return this.dataSource.transaction(async (manager) => {
      const pedido = manager.create(Pedido, {
        tenantId,
        clienteId: dto.clienteId ?? null,
        estado: EstadoPedido.borrador,
        workflowEstadoId: workflowBorradorId,
        fecha: (dto.fecha ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
        total: total.toFixed(2),
        notas: dto.notas ?? null,
        comprobanteId: null,
        usuarioId: userId,
      });
      const saved = await manager.save(Pedido, pedido);

      const itemEntities = items.map((it) =>
        manager.create(PedidoItem, {
          pedidoId: saved.id,
          productoId: it.productoId,
          cantidad: it.cantidad.toFixed(3),
          precioUnitario: it.precioUnitario.toFixed(2),
          subtotal: it.subtotal.toFixed(2),
        }),
      );
      await manager.save(PedidoItem, itemEntities);

      return {
        data: {
          id: saved.id,
          estado: saved.estado,
          fecha: saved.fecha,
          total,
          items: items.map((it) => ({
            ...it,
            productoCodigo: productMap.get(it.productoId)?.codigo ?? null,
            productoNombre: productMap.get(it.productoId)?.nombre ?? null,
          })),
        },
      };
    });
  }

  async list(query: ListPedidosQueryDto) {
    const tenantId = this.tenantContext.getTenantId();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = { tenantId, ...(query.estado ? { estado: query.estado } : {}) };
    const [rows, total] = await this.pedidoRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      data: rows.map((p) => this.serializePedido(p)),
      meta: { total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async getById(id: string) {
    const tenantId = this.tenantContext.getTenantId();
    const pedido = await this.pedidoRepo.findOne({ where: { id, tenantId } });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    const items = await this.pedidoItemRepo.find({ where: { pedidoId: pedido.id } });
    const productIds = [...new Set(items.map((it) => it.productoId))];
    const products =
      productIds.length > 0
        ? await this.productoRepo.find({
            where: { tenantId, id: In(productIds) },
            select: { id: true, codigo: true, nombre: true },
          })
        : [];
    const productMap = new Map(products.map((p) => [p.id, p]));

    return {
      data: {
        ...this.serializePedido(pedido),
        items: items.map((it) => ({
          id: it.id,
          productoId: it.productoId,
          productoCodigo: productMap.get(it.productoId)?.codigo ?? null,
          productoNombre: productMap.get(it.productoId)?.nombre ?? null,
          cantidad: Number(it.cantidad),
          precioUnitario: Number(it.precioUnitario),
          subtotal: Number(it.subtotal),
        })),
      },
    };
  }

  async getDisponibilidad(id: string) {
    const tenantId = this.tenantContext.getTenantId();
    const pedido = await this.pedidoRepo.findOne({ where: { id, tenantId } });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    const items = await this.pedidoItemRepo.find({ where: { pedidoId: id } });

    const disponibilidad = await Promise.all(
      items.map(async (it) => {
        const row = await this.getProductAvailability(tenantId, it.productoId);
        return {
          productoId: it.productoId,
          pedidoCantidad: Number(it.cantidad),
          stockActual: row.stockActual,
          stockComprometido: row.stockComprometido,
          stockDisponible: row.stockDisponible,
          alcanza: row.stockDisponible >= Number(it.cantidad),
        };
      }),
    );

    return { data: { pedidoId: id, estado: pedido.estado, disponibilidad } };
  }

  async changeEstado(id: string, dto: ChangePedidoEstadoDto, userId: string) {
    await this.pedidoWorkflowService.assertPedidosModuleEnabled();

    const tenantId = this.tenantContext.getTenantId();
    const pedido = await this.pedidoRepo.findOne({ where: { id, tenantId } });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    const workflowDestino = await this.resolveWorkflowDestino(dto, pedido.estado);
    if (!workflowDestino.activo) {
      throw new BadRequestException('Estado workflow inactivo.');
    }

    const workflowActual = await this.resolveWorkflowActual(pedido);
    if (!workflowActual) {
      throw new BadRequestException(
        'El workflow base del tenant no est├í inicializado (faltan estados default).',
      );
    }

    if (workflowDestino.id !== workflowActual.id) {
      const allowed = await this.pedidoWorkflowService.hasTransition(
        workflowActual.id,
        workflowDestino.id,
      );
      if (!allowed) {
        throw new BadRequestException(
          `Transici├│n no permitida: '${workflowActual.slug}' ÔåÆ '${workflowDestino.slug}'`,
        );
      }
    }

    const faseNueva = workflowDestino.fase;
    const estadoActual = pedido.estado;
    if (faseNueva !== estadoActual) {
      const transicionesFase = TRANSITIONS[estadoActual] ?? [];
      if (!transicionesFase.includes(faseNueva)) {
        throw new BadRequestException(`No se puede pasar de '${estadoActual}' a '${faseNueva}'`);
      }
    }

    const cambioDeFase = faseNueva !== estadoActual;
    const exigirStock = dto.stockBloqueante !== false;
    const items = await this.pedidoItemRepo.find({ where: { pedidoId: pedido.id } });

    if (cambioDeFase && faseNueva === EstadoPedido.confirmado && exigirStock) {
      for (const item of items) {
        const stock = await this.getProductAvailability(tenantId, item.productoId);
        if (stock.stockDisponible < Number(item.cantidad)) {
          throw new BadRequestException(
            `Stock insuficiente para producto ${item.productoId}. Disponible: ${stock.stockDisponible}, pedido: ${Number(item.cantidad)}`,
          );
        }
      }
    }

    const patch: Partial<Pedido> = {
      workflowEstadoId: workflowDestino.id,
    };
    if (dto.notas !== undefined) {
      patch.notas =
        typeof dto.notas === 'string' && dto.notas.trim() ? dto.notas.trim() : null;
    }
    if (cambioDeFase) {
      patch.estado = faseNueva;
    }

    if (cambioDeFase && faseNueva === EstadoPedido.entregado) {
      const sucursalId = await this.branchStockService.resolveDepotId(items[0]?.productoId);
      await this.dataSource.transaction(async (manager) => {
        for (const item of items) {
          await manager.query(REGISTRAR_MOVIMIENTO_SQL, [
            tenantId,
            item.productoId,
            sucursalId,
            'salida',
            Number(item.cantidad),
            `Entrega pedido #${pedido.id.slice(0, 8)}`,
            'pedido',
            pedido.id,
            userId,
          ]);
        }
        await manager.update(Pedido, { id: pedido.id, tenantId }, patch);
      });
    } else {
      await this.pedidoRepo.update({ id: pedido.id, tenantId }, patch);
    }

    return this.getById(id);
  }

  private async resolveWorkflowDestino(
    dto: ChangePedidoEstadoDto,
    estadoActual: EstadoPedido,
  ): Promise<PedidoWorkflowEstado> {
    const workflowEstadoId = dto.workflowEstadoId?.trim() ?? '';
    const workflowSlug = dto.workflowSlug?.trim() ?? '';
    const estadoLegacy = dto.estado;

    if (!workflowEstadoId && !workflowSlug && !estadoLegacy) {
      throw new BadRequestException(
        'Falta workflow_estado_id o workflow_slug (o estado legacy).',
      );
    }

    let destino: PedidoWorkflowEstado | null = null;
    if (workflowEstadoId) {
      destino = await this.pedidoWorkflowService.findEstadoById(workflowEstadoId);
    } else {
      const slug = workflowSlug || String(estadoLegacy ?? estadoActual);
      destino = await this.pedidoWorkflowService.findEstadoBySlug(slug);
    }

    if (!destino) throw new NotFoundException('Estado workflow no encontrado.');
    return destino;
  }

  private async resolveWorkflowActual(pedido: Pedido): Promise<PedidoWorkflowEstado | null> {
    if (pedido.workflowEstadoId) {
      const byId = await this.pedidoWorkflowService.findEstadoById(pedido.workflowEstadoId);
      if (byId) return byId;
    }
    return this.pedidoWorkflowService.findEstadoBySlug(String(pedido.estado));
  }

  async facturar(id: string, dto: FacturarPedidoDto, userId: string) {
    const tenantId = this.tenantContext.getTenantId();
    const pedido = await this.pedidoRepo.findOne({ where: { id, tenantId } });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    if (pedido.estado !== EstadoPedido.entregado) {
      throw new BadRequestException('Solo pedidos entregados pueden facturarse');
    }
    if (pedido.comprobanteId) {
      throw new ConflictException('El pedido ya tiene comprobante');
    }

    const tipo = dto.tipo ?? TipoComprobante.factura_c;
    const ivaPorcentaje = dto.ivaPorcentaje ?? (tipo === TipoComprobante.factura_a ? 21 : 0);
    const items = await this.pedidoItemRepo.find({ where: { pedidoId: pedido.id } });
    if (items.length === 0) throw new BadRequestException('Pedido sin items');
    const productIds = [...new Set(items.map((it) => it.productoId))];
    const products = await this.productoRepo.find({
      where: { tenantId, id: In(productIds) },
      select: { id: true, precioCosto: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    const subtotal = roundMoney(items.reduce((acc, it) => acc + Number(it.subtotal), 0));
    const ivaMonto = roundMoney(subtotal * (ivaPorcentaje / 100));
    const total = roundMoney(subtotal + ivaMonto);
    const sucursalId = await this.branchStockService.resolveDepotId(items[0]?.productoId);
    if (!sucursalId) throw new BadRequestException('No se pudo resolver sucursal para numeraci├│n');

    return this.dataSource.transaction(async (manager) => {
      const numeroRows = (await manager.query(
        `SELECT public.siguiente_numero_comprobante($1::uuid, $2::uuid, $3::tipo_comprobante) AS numero`,
        [tenantId, sucursalId, tipo],
      )) as Array<{ numero?: number | string }>;
      const numeroValue = Number(numeroRows[0]?.numero);
      if (!Number.isFinite(numeroValue)) throw new BadRequestException('No se pudo generar n├║mero');

      const comp = manager.create(Comprobante, {
        tenantId,
        tipo,
        numero: numeroValue,
        fecha: new Date().toISOString().slice(0, 10),
        clienteId: pedido.clienteId,
        sucursalId,
        subtotal: subtotal.toFixed(2),
        ivaMonto: ivaMonto.toFixed(2),
        ivaPorcentaje: ivaPorcentaje.toFixed(2),
        total: total.toFixed(2),
        estado: EstadoComprobante.emitido,
        usuarioId: userId,
        notas: `Generado desde pedido ${pedido.id}`,
      });
      const savedComp = await manager.save(Comprobante, comp);

      const compItems = items.map((it) =>
        manager.create(ComprobanteItem, {
          comprobanteId: savedComp.id,
          productoId: it.productoId,
          cantidad: it.cantidad,
          precioUnitario: it.precioUnitario,
          precioCosto: (Number(productMap.get(it.productoId)?.precioCosto ?? 0)).toFixed(6),
          subtotal: it.subtotal,
        }),
      );
      await manager.save(ComprobanteItem, compItems);
      await manager.update(Pedido, { id: pedido.id, tenantId }, { comprobanteId: savedComp.id });

      return { data: { pedidoId: pedido.id, comprobanteId: savedComp.id, tipo, numero: savedComp.numero } };
    });
  }

  private async getProductAvailability(tenantId: string, productoId: string): Promise<{
    stockActual: number;
    stockComprometido: number;
    stockDisponible: number;
  }> {
    const rows = (await this.dataSource.query(
      `SELECT
         p.stock_actual::numeric AS stock_actual,
         COALESCE(v.comprometido, 0)::numeric AS stock_comprometido
       FROM public.producto p
       LEFT JOIN public.v_stock_comprometido v
         ON v.producto_id = p.id
        AND v.tenant_id = p.tenant_id
       WHERE p.tenant_id = $1::uuid
         AND p.id = $2::uuid
         AND p.activo = true`,
      [tenantId, productoId],
    )) as Array<{ stock_actual: number | string; stock_comprometido: number | string }>;
    const row = rows[0];
    if (!row) throw new BadRequestException(`Producto no disponible para tenant: ${productoId}`);
    const stockActual = Number(row.stock_actual);
    const stockComprometido = Number(row.stock_comprometido);
    return {
      stockActual,
      stockComprometido,
      stockDisponible: stockActual - stockComprometido,
    };
  }

  private serializePedido(p: Pedido) {
    return {
      id: p.id,
      tenantId: p.tenantId,
      clienteId: p.clienteId,
      estado: p.estado,
      workflowEstadoId: p.workflowEstadoId,
      fecha: p.fecha,
      total: Number(p.total),
      notas: p.notas,
      comprobanteId: p.comprobanteId,
      usuarioId: p.usuarioId,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}

const TRANSITIONS: Record<EstadoPedido, EstadoPedido[]> = {
  [EstadoPedido.borrador]: [EstadoPedido.confirmado, EstadoPedido.cancelado],
  [EstadoPedido.confirmado]: [EstadoPedido.entregado, EstadoPedido.cancelado],
  [EstadoPedido.entregado]: [],
  [EstadoPedido.cancelado]: [],
};

function roundMoney(n: number): number {
  return Number(n.toFixed(2));
}
