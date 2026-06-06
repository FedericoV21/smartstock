import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { TenantContext } from '../auth/tenant-context.service';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { BranchPricingService } from '../branches/branch-pricing.service';
import { PrecioSucursal } from '../branches/entities/precio-sucursal.entity';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Cliente } from '../catalog/entities/cliente.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { TipoComprobante } from '../facturacion/enums/tipo-comprobante.enum';
import { hoyEnArgentina } from '../facturacion/utils/fecha-argentina';
import { ProductoVarianteStockSucursal } from '../products/entities/producto-variante-stock-sucursal.entity';
import { ProductoVariante } from '../products/entities/producto-variante.entity';
import { Producto } from '../products/entities/producto.entity';
import { UsersService } from '../users/users.service';
import { CrearBorradorPosDto } from './dto/pos.dto';
import { PosEnrichmentService } from './pos-enrichment.service';
import {
  determinarTipoComprobantePos,
  normalizarCondicionIva,
} from './utils/determinar-tipo-factura.util';

@Injectable()
export class PosBorradorService {
  constructor(
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(ComprobanteItem)
    private readonly itemRepo: Repository<ComprobanteItem>,
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    @InjectRepository(ProductoVariante)
    private readonly varianteRepo: Repository<ProductoVariante>,
    @InjectRepository(ProductoVarianteStockSucursal)
    private readonly varianteStockRepo: Repository<ProductoVarianteStockSucursal>,
    @InjectRepository(PrecioSucursal)
    private readonly precioRepo: Repository<PrecioSucursal>,
    @InjectRepository(Cliente)
    private readonly clienteRepo: Repository<Cliente>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(ModuloConfig)
    private readonly moduloRepo: Repository<ModuloConfig>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
    private readonly usersService: UsersService,
    private readonly branchPricingService: BranchPricingService,
    private readonly enrichment: PosEnrichmentService,
  ) {}

  async crear(user: AccessTokenPayload, dto: CrearBorradorPosDto) {
    await this.assertFacturadorPos();
    const role = resolveAppRole(user);
    if (role === 'visor') {
      throw new ForbiddenException('Los usuarios visor no pueden crear borradores.');
    }

    if (!dto.items?.length) {
      throw new BadRequestException('La venta no tiene ├¡tems');
    }

    const tenantId = this.tenantContext.getTenantId();
    const userId = user.sub;
    const sucursalId = await this.resolveSucursal(user, dto.sucursal_id);

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new BadRequestException('Tenant no encontrado');

    let receptor = normalizarCondicionIva(tenant.condicionIva ?? 'consumidor_final');
    if (dto.cliente_id) {
      const cl = await this.clienteRepo.findOne({
        where: { id: dto.cliente_id, tenantId },
        select: ['id', 'condicionIva'],
      });
      if (!cl) throw new NotFoundException('Cliente no encontrado');
      receptor = normalizarCondicionIva(cl.condicionIva);
    }

    const emisor = normalizarCondicionIva(tenant.condicionIva ?? 'consumidor_final');
    const quiereTicket = dto.tipo_comprobante_pos !== 'factura';
    const tipo = determinarTipoComprobantePos(emisor, receptor, quiereTicket) as TipoComprobante;

    const productoIds = [...new Set(dto.items.map((i) => i.producto_id))];
    const productos = await this.productoRepo.find({
      where: { tenantId, id: In(productoIds), activo: true },
    });
    if (productos.length !== productoIds.length) {
      throw new NotFoundException('Algunos productos no fueron encontrados');
    }

    const precioRows = await this.precioRepo.find({
      where: { tenantId, sucursalId, productoId: In(productoIds) },
    });
    const precioMap = new Map(precioRows.map((r) => [r.productoId, r]));
    const stockMap = await this.enrichment.loadStockMap(tenantId, sucursalId, productoIds);

    const varianteIds = [
      ...new Set(dto.items.map((i) => i.producto_variante_id).filter(Boolean) as string[]),
    ];
    const variantes =
      varianteIds.length > 0
        ? await this.varianteRepo.find({
            where: { tenantId, activo: true, id: In(varianteIds) },
          })
        : [];
    const varianteMap = new Map(variantes.map((v) => [v.id, v]));
    const stockVarMap = await this.enrichment.loadVarianteStockMap(
      tenantId,
      sucursalId,
      varianteIds,
    );

    const exigirStock = dto.stock_bloqueante !== false;
    if (exigirStock) {
      await this.validarStock(dto, productos, precioMap, stockMap, varianteMap, stockVarMap, sucursalId);
    }

    const ivaPct = dto.iva_porcentaje ?? Number(tenant.ivaPorcentajeDefault ?? 21);
    let subtotal = 0;
    const lineas: Array<{
      productoId: string;
      cantidad: number;
      precioUnitario: number;
      precioCosto: number;
      subtotal: number;
    }> = [];

    for (const item of dto.items) {
      const prod = productos.find((p) => p.id === item.producto_id)!;
      const ov = precioMap.get(prod.id);
      const eff = this.branchPricingService.mergeEffective(prod, ov ?? null, sucursalId);
      const precioUnitario = item.precio_unitario;
      const lineSub = Math.round(precioUnitario * item.cantidad * 100) / 100;
      subtotal += lineSub;
      lineas.push({
        productoId: prod.id,
        cantidad: item.cantidad,
        precioUnitario,
        precioCosto: eff.precioCosto,
        subtotal: lineSub,
      });
    }

    subtotal = Math.round(subtotal * 100) / 100;
    const ivaMonto = Math.round(subtotal * (ivaPct / 100) * 100) / 100;
    const total = Math.round((subtotal + ivaMonto) * 100) / 100;
    const fecha = hoyEnArgentina();

    const saved = await this.dataSource.transaction(async (manager) => {
      const ordenRows = (await manager.query(
        `SELECT COALESCE(MAX(numero_orden), 0) + 1 AS n FROM comprobante WHERE tenant_id = $1`,
        [tenantId],
      )) as Array<{ n?: number | string }>;
      const numeroOrden = Number(ordenRows[0]?.n ?? 1);

      const comprobante = manager.create(Comprobante, {
        tenantId,
        tipo,
        numero: null,
        numeroOrden,
        fecha,
        clienteId: dto.cliente_id ?? null,
        sucursalId,
        tipoOperacion: 'venta',
        subtotal: subtotal.toFixed(2),
        ivaMonto: ivaMonto.toFixed(2),
        ivaPorcentaje: ivaPct.toFixed(2),
        total: total.toFixed(2),
        estado: EstadoComprobante.borrador,
        metodoPago: null,
        cajaId: dto.caja_id ?? null,
        notas: dto.notas ?? null,
        usuarioId: userId,
      });
      const comp = await manager.save(Comprobante, comprobante);

      await manager.save(
        ComprobanteItem,
        lineas.map((l) =>
          manager.create(ComprobanteItem, {
            comprobanteId: comp.id,
            productoId: l.productoId,
            cantidad: l.cantidad.toFixed(3),
            precioUnitario: l.precioUnitario.toFixed(2),
            precioCosto: l.precioCosto.toFixed(6),
            subtotal: l.subtotal.toFixed(2),
          }),
        ),
      );

      return comp;
    });

    return {
      comprobante: {
        id: saved.id,
        numero: saved.numero,
        numero_orden: saved.numeroOrden,
        total: Number(saved.total),
      },
    };
  }

  async eliminar(user: AccessTokenPayload, id: string, sucursalIdParam?: string) {
    await this.assertFacturadorPos();
    const role = resolveAppRole(user);
    if (role === 'visor') {
      throw new ForbiddenException('Los usuarios visor no pueden eliminar borradores.');
    }

    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.resolveSucursal(user, sucursalIdParam);

    const comp = await this.comprobanteRepo.findOne({
      where: { id, tenantId, sucursalId },
    });
    if (!comp) throw new NotFoundException('Comprobante no encontrado');

    if (comp.estado !== EstadoComprobante.borrador) {
      if (comp.estado === ('pendiente_qr' as EstadoComprobante)) {
        throw new ConflictException(
          'Hay un cobro QR en curso. Cancelalo antes de eliminar el borrador.',
        );
      }
      throw new BadRequestException('Solo se puede eliminar un borrador sin emitir');
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(ComprobanteItem, { comprobanteId: id });
      await manager.delete(Comprobante, { id, tenantId });
    });

    return { ok: true };
  }

  private async validarStock(
    dto: CrearBorradorPosDto,
    productos: Producto[],
    precioMap: Map<string, PrecioSucursal>,
    stockMap: Map<string, { stock_actual: number }>,
    varianteMap: Map<string, ProductoVariante>,
    stockVarMap: Map<string, { stock_actual: number }>,
    sucursalId: string,
  ) {
    const cantidadPorTarget = new Map<
      string,
      { producto_id: string; variante_id: string | null; cantidad: number; nombre: string }
    >();

    for (const item of dto.items) {
      const prod = productos.find((p) => p.id === item.producto_id)!;
      if (prod.usaVariantes && !item.producto_variante_id) {
        throw new BadRequestException(
          `El producto "${prod.nombre}" usa variantes. Seleccion├í una variante.`,
        );
      }
      if (item.producto_variante_id) {
        const v = varianteMap.get(item.producto_variante_id);
        if (!v || v.productoId !== item.producto_id) {
          throw new BadRequestException('Variante inv├ílida para uno de los productos.');
        }
      }
      const varianteId = item.producto_variante_id ?? null;
      const key = varianteId ? `${item.producto_id}:${varianteId}` : item.producto_id;
      const cur = cantidadPorTarget.get(key) ?? {
        producto_id: item.producto_id,
        variante_id: varianteId,
        cantidad: 0,
        nombre: prod.nombre,
      };
      cur.cantidad += item.cantidad;
      cantidadPorTarget.set(key, cur);
    }

    for (const target of cantidadPorTarget.values()) {
      const prod = productos.find((p) => p.id === target.producto_id)!;
      const st = stockMap.get(prod.id);
      const disponible = target.variante_id
        ? (stockVarMap.get(target.variante_id)?.stock_actual ?? 0)
        : (st?.stock_actual ?? Number(prod.stockActual));
      if (disponible < target.cantidad) {
        throw new BadRequestException(
          `Stock insuficiente para "${target.nombre}". Disponible: ${disponible}, solicitado: ${target.cantidad}`,
        );
      }
    }
  }

  private async assertFacturadorPos(): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const mod = await this.moduloRepo.findOne({ where: { tenantId } });
    if (!mod?.facturadorPos) {
      throw new ForbiddenException("El m├│dulo 'facturador_pos' no est├í habilitado para tu plan.");
    }
  }

  private async resolveSucursal(user: AccessTokenPayload, sucursalIdParam?: string): Promise<string> {
    const tenantId = this.tenantContext.getTenantId();
    if (sucursalIdParam?.trim()) {
      await this.usersService.assertCanOperateSucursal(
        user.sub,
        tenantId,
        sucursalIdParam.trim(),
        resolveAppRole(user),
      );
      return sucursalIdParam.trim();
    }
    return this.sucursalContext.requireSucursalId();
  }
}
