import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { TenantContext } from '../auth/tenant-context.service';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { hoyEnArgentina } from '../facturacion/utils/fecha-argentina';
import { Producto } from '../products/entities/producto.entity';
import { PromocionComboItem } from '../promotions/entities/promocion-combo-item.entity';
import { PromocionSucursal } from '../promotions/entities/promocion-sucursal.entity';
import { Promocion } from '../promotions/entities/promocion.entity';
import { PromocionTipo } from '../promotions/enums/promocion-tipo.enum';
import { filaPromocionAMotor } from '../promotions/utils/promocion-motor';
import { promocionVigenteParaYmd } from '../promotions/utils/promocion-vigencia';
import { UsersService } from '../users/users.service';
import {
  CrearBorradorPosDto,
  PosBuscarPromocionesQueryDto,
  PosBuscarProductosQueryDto,
  PosCatalogoBusquedaQueryDto,
  PosProductosPorIdsDto,
  PosSeleccionProductoDto,
} from './dto/pos.dto';
import { PosEnrichmentService } from './pos-enrichment.service';
import { PosBorradorService } from './pos-borrador.service';
import {
  normalizarTextoBusqueda,
  rankScoreBusquedaProducto,
  sanitizarQueryBusqueda,
} from './utils/normalize-busqueda.util';
import { mapCatalogoBusquedaItem, serializePosProducto } from './utils/pos-serialize.util';

const MAX_RESULTS = 40;
const FETCH_CAP = 140;
const DEFAULT_CATALOGO_LIMIT = 750;
const MAX_CATALOGO_LIMIT = 1000;

@Injectable()
export class PosService {
  constructor(
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Proveedor)
    private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(Promocion)
    private readonly promocionRepo: Repository<Promocion>,
    @InjectRepository(PromocionSucursal)
    private readonly promocionSucursalRepo: Repository<PromocionSucursal>,
    @InjectRepository(PromocionComboItem)
    private readonly comboItemRepo: Repository<PromocionComboItem>,
    @InjectRepository(ModuloConfig)
    private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
    private readonly usersService: UsersService,
    private readonly enrichment: PosEnrichmentService,
    private readonly borradorService: PosBorradorService,
  ) {}

  async assertFacturadorPos(): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const mod = await this.moduloRepo.findOne({ where: { tenantId } });
    if (!mod?.facturadorPos) {
      throw new ForbiddenException("El m├│dulo 'facturador_pos' no est├í habilitado para tu plan.");
    }
  }

  async buscarProductos(user: AccessTokenPayload, query: PosBuscarProductosQueryDto) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.requireSucursal(user, query.sucursal_id);
    await this.assertOperableSucursales(user, tenantId);

    const raw = query.q?.trim() ?? '';
    const proveedorId = query.proveedor_id?.trim() ?? '';

    if (!raw && !proveedorId) {
      return { productos: [] };
    }

    let rows: Producto[];
    if (!raw && proveedorId) {
      rows = await this.productoRepo.find({
        where: { tenantId, activo: true, proveedorId },
        order: { nombre: 'ASC' },
        take: FETCH_CAP,
      });
    } else {
      const q = sanitizarQueryBusqueda(raw);
      if (!q) return { productos: [] };
      const qNorm = normalizarTextoBusqueda(q);
      const digitsQ = q.replace(/\D/g, '');

      const qb = this.productoRepo
        .createQueryBuilder('p')
        .where('p.tenant_id = :tenantId', { tenantId })
        .andWhere('p.activo = true');

      if (proveedorId) {
        qb.andWhere('p.proveedor_id = :proveedorId', { proveedorId });
      }

      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('p.nombre ILIKE :like', { like: `%${qNorm}%` })
            .orWhere('p.codigo ILIKE :prefix', { prefix: `${qNorm}%` })
            .orWhere('p.nombre ILIKE :prefix', { prefix: `${qNorm}%` });
          if (digitsQ.length >= 6) {
            sub.orWhere('p.codigo_barras = :digits', { digits: digitsQ });
          }
          if (digitsQ) {
            sub.orWhere('p.plu = :digits', { digits: digitsQ });
          }
        }),
      );

      rows = await qb.take(FETCH_CAP).getMany();
      rows.sort((a, b) => {
        const ra = rankScoreBusquedaProducto(a, q, qNorm);
        const rb = rankScoreBusquedaProducto(b, q, qNorm);
        if (ra !== rb) return ra - rb;
        return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
      });
    }

    const stockMap = await this.enrichment.loadStockMap(
      tenantId,
      sucursalId,
      rows.map((r) => r.id),
    );
    const enriched = await this.enrichment.enrichProductos(tenantId, sucursalId, rows, stockMap);
    const limited = enriched.slice(0, MAX_RESULTS);
    const productos = await this.enrichment.attachVariantes(tenantId, sucursalId, limited);
    return { productos };
  }

  async catalogoBusqueda(user: AccessTokenPayload, query: PosCatalogoBusquedaQueryDto) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.requireSucursal(user, query.sucursal_id);
    await this.assertOperableSucursales(user, tenantId);

    const offset = Math.max(0, query.offset ?? 0);
    const limit = Math.max(1, Math.min(query.limit ?? DEFAULT_CATALOGO_LIMIT, MAX_CATALOGO_LIMIT));

    const rows = await this.productoRepo.find({
      where: { tenantId, activo: true },
      order: { nombre: 'ASC' },
      skip: offset,
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const enriched = await this.enrichment.enrichProductos(tenantId, sucursalId, pageRows);
    const expanded = await this.enrichment.expandCatalogoConVariantes(
      tenantId,
      sucursalId,
      enriched,
    );
    const productos = expanded.map(mapCatalogoBusquedaItem);
    const nextOffset = hasMore ? offset + pageRows.length : null;

    return {
      productos,
      limit,
      offset,
      next_offset: nextOffset,
      has_more: hasMore,
      snapshot_at: new Date().toISOString(),
      cache_ttl_ms: 10 * 60 * 1000,
    };
  }

  async productosPorIds(user: AccessTokenPayload, dto: PosProductosPorIdsDto) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.requireSucursal(user, dto.sucursal_id);

    const selecciones = this.parseSelecciones(dto);
    const ids = selecciones.length
      ? [...new Set(selecciones.map((s) => s.producto_id))]
      : [...new Set((dto.producto_ids ?? []).map((id) => id.trim()).filter(Boolean))];

    if (ids.length === 0) return { productos: [] };
    if (ids.length > 200 || selecciones.length > 200) {
      throw new BadRequestException('M├íximo 200 productos por solicitud');
    }

    const rows = await this.productoRepo.find({
      where: { tenantId, id: In(ids) },
    });
    const enriched = await this.enrichment.enrichProductos(tenantId, sucursalId, rows);

    if (selecciones.length === 0) {
      return { productos: enriched };
    }

    const varianteIds = [
      ...new Set(
        selecciones.map((s) => s.producto_variante_id).filter((id): id is string => Boolean(id)),
      ),
    ];
    const variantesMap = await this.enrichment.resolveVariantesByIds(tenantId, varianteIds);
    const stockVarMap = await this.enrichment.loadVarianteStockMap(
      tenantId,
      sucursalId,
      varianteIds,
    );
    const porProducto = new Map(enriched.map((p) => [p.id, p]));

    const productos = selecciones
      .map((sel) => {
        const producto = porProducto.get(sel.producto_id);
        if (!producto) return null;
        if (!sel.producto_variante_id) return producto;
        const variante = variantesMap.get(sel.producto_variante_id);
        if (!variante || variante.productoId !== sel.producto_id) return null;
        const stock = stockVarMap.get(variante.id);
        return serializePosProducto(
          rows.find((r) => r.id === sel.producto_id)!,
          {
            precioCosto: producto.precio_costo,
            precioVenta: producto.precio_venta,
            porcentajeGanancia: producto.porcentaje_ganancia,
            stockActual: stock?.stock_actual ?? 0,
            stockMinimo: stock?.stock_minimo ?? producto.stock_minimo,
            categoria: producto.categoria,
            proveedor: producto.proveedor,
            productoVarianteId: variante.id,
            nombreOverride: `${producto.nombre} - ${variante.etiqueta}`,
            codigoOverride: variante.codigo || producto.codigo,
            codigoBarrasOverride: variante.codigoBarras ?? producto.codigo_barras,
            variante: {
              id: variante.id,
              codigo: variante.codigo,
              codigo_barras: variante.codigoBarras,
              atributos: variante.atributos,
              etiqueta: variante.etiqueta,
            },
          },
        );
      })
      .filter((p): p is NonNullable<typeof p> => Boolean(p));

    return { productos };
  }

  async buscarPromociones(user: AccessTokenPayload, query: PosBuscarPromocionesQueryDto) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.requireSucursal(user, query.sucursal_id);

    const raw = query.q?.trim() ?? '';
    const q = sanitizarQueryBusqueda(raw);
    if (q.length < 2) return { promociones: [] };

    const accessRows = await this.promocionSucursalRepo.find({
      where: { tenantId, sucursalId },
      select: ['promocionId'],
    });
    const promoIds = [...new Set(accessRows.map((r) => r.promocionId))];
    if (promoIds.length === 0) return { promociones: [] };

    const promoRows = await this.promocionRepo
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.id IN (:...promoIds)', { promoIds })
      .andWhere('p.tipo = :tipo', { tipo: PromocionTipo.combo_precio_fijo })
      .andWhere('p.activa = true')
      .andWhere('p.nombre ILIKE :q', { q: `%${q}%` })
      .orderBy('p.nombre', 'ASC')
      .take(40)
      .getMany();

    if (promoRows.length === 0) return { promociones: [] };

    const ids = promoRows.map((r) => r.id);
    const comboRows = await this.comboItemRepo.find({
      where: { tenantId, promocionId: In(ids) },
    });
    const comboPorPromo = new Map<string, { producto_id: string; cantidad: number }[]>();
    for (const r of comboRows) {
      const arr = comboPorPromo.get(r.promocionId) ?? [];
      arr.push({ producto_id: r.productoId, cantidad: Number(r.cantidad) });
      comboPorPromo.set(r.promocionId, arr);
    }

    const fecha = hoyEnArgentina();
    const promociones: Array<{
      id: string;
      nombre: string;
      precio_combo: number;
      combo_items: { producto_id: string; cantidad: number }[];
    }> = [];

    for (const pr of promoRows) {
      const combo = comboPorPromo.get(pr.id) ?? [];
      const motor = filaPromocionAMotor({
        ...pr,
        promocion_combo_item: combo.length ? combo.map((c) => ({
          producto_id: c.producto_id,
          cantidad: c.cantidad,
        })) : null,
      });
      if (!promocionVigenteParaYmd(motor, fecha)) continue;
      if (!motor.combo_items?.length || motor.precio_combo == null) continue;
      promociones.push({
        id: motor.id,
        nombre: motor.nombre,
        precio_combo: Number(motor.precio_combo),
        combo_items: motor.combo_items,
      });
      if (promociones.length >= 20) break;
    }

    return { promociones };
  }

  async listProveedores(user: AccessTokenPayload) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    await this.requireSucursal(user, undefined);
    await this.assertOperableSucursales(user, tenantId);

    const rows = await this.proveedorRepo.find({
      where: { tenantId, activo: true },
      order: { nombre: 'ASC' },
      select: ['id', 'nombre'],
    });
    return { proveedores: rows.map((p) => ({ id: p.id, nombre: p.nombre })) };
  }

  crearBorrador(user: AccessTokenPayload, dto: CrearBorradorPosDto) {
    return this.borradorService.crear(user, dto);
  }

  eliminarBorrador(user: AccessTokenPayload, id: string, sucursalIdParam?: string) {
    return this.borradorService.eliminar(user, id, sucursalIdParam);
  }

  private parseSelecciones(dto: PosProductosPorIdsDto): PosSeleccionProductoDto[] {
    if (!dto.selecciones?.length) return [];
    const out: PosSeleccionProductoDto[] = [];
    const seen = new Set<string>();
    for (const item of dto.selecciones) {
      const key = `${item.producto_id}:${item.producto_variante_id ?? 'base'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  private async requireSucursal(user: AccessTokenPayload, sucursalIdParam?: string): Promise<string> {
    const tenantId = this.tenantContext.getTenantId();
    if (sucursalIdParam?.trim()) {
      await this.usersService.assertCanOperateSucursal(
        user.sub,
        tenantId,
        sucursalIdParam.trim(),
        resolveAppRole(user),
      );
      this.sucursalContext.setActiveSucursalId(sucursalIdParam.trim());
      return sucursalIdParam.trim();
    }
    const id = await this.sucursalContext.requireSucursalId();
    return id;
  }

  private async assertOperableSucursales(user: AccessTokenPayload, tenantId: string) {
    const role = resolveAppRole(user);
    const ids = await this.usersService.listOperableSucursalIds(user.sub, tenantId, role);
    if (ids.length === 0) {
      throw new ForbiddenException('No ten├®s sucursales asignadas para operar el POS.');
    }
  }
}
