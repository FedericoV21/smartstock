import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { Producto } from '../products/entities/producto.entity';
import { ListLinkableProductsQueryDto } from './dto/list-linkable-products-query.dto';
import { effectiveBusinessPrefs } from './utils/effective-business-prefs.util';
import { normalizarTextoBusqueda } from './utils/normalize-busqueda.util';

const RESULT_LIMIT = 20;

@Injectable()
export class ImportLinkableProductsService {
  constructor(
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Proveedor)
    private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
  ) {}

  async list(query: ListLinkableProductsQueryDto) {
    const tenantId = this.tenantContext.getTenantId();
    const raw = (query.q ?? '').trim().slice(0, 80);
    const safe = raw.replace(/[,()%_\\'"]/g, ' ').replace(/\s+/g, ' ').trim();
    const textoBuscable = safe ? normalizarTextoBusqueda(safe) : '';

    if (!textoBuscable && raw.length < 2) {
      return { data: { productos: [], alcance: 'vacio' } };
    }

    const proveedorId =
      query.proveedorId && /^[0-9a-f-]{36}$/i.test(query.proveedorId) ? query.proveedorId : null;
    const sinProveedor = query.sinProveedor === '1';

    const sucursalId = await this.sucursalContext.resolveSucursalId();
    const [tenant, sucursal] = await Promise.all([
      this.tenantRepo.findOne({ where: { id: tenantId }, select: { businessPrefs: true } }),
      sucursalId
        ? this.sucursalRepo.findOne({
            where: { id: sucursalId, tenantId },
            select: { businessPrefs: true },
          })
        : Promise.resolve(null),
    ]);
    const businessPrefs = effectiveBusinessPrefs(
      tenant?.businessPrefs ?? null,
      sucursal?.businessPrefs ?? null,
    );
    const unificar = businessPrefs.unificarProductosEntreProveedores === true;

    let alcance: 'todos_los_proveedores' | 'proveedor' | 'sin_proveedor' | 'vacio' = 'vacio';
    if (unificar) alcance = 'todos_los_proveedores';
    else if (proveedorId) alcance = 'proveedor';
    else if (sinProveedor) alcance = 'sin_proveedor';
    else if (!textoBuscable) {
      return {
        data: {
          productos: [],
          alcance: 'vacio',
          unificarProductosEntreProveedores: unificar,
        },
      };
    }

    if (!unificar && !proveedorId && !sinProveedor) {
      return {
        data: {
          productos: [],
          alcance: 'vacio',
          unificarProductosEntreProveedores: unificar,
        },
      };
    }

    const qb = this.productoRepo
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.activo = true');

    if (textoBuscable) {
      qb.andWhere(
        `(LOWER(p.codigo) LIKE :q OR LOWER(p.nombre) LIKE :q)`,
        { q: `%${textoBuscable}%` },
      );
    }

    if (!unificar) {
      if (proveedorId) qb.andWhere('p.proveedor_id = :proveedorId', { proveedorId });
      else if (sinProveedor) qb.andWhere('p.proveedor_id IS NULL');
    }

    const rows = await qb.orderBy('p.nombre', 'ASC').take(RESULT_LIMIT).getMany();
    const proveedorIds = [...new Set(rows.map((r) => r.proveedorId).filter((id): id is string => Boolean(id)))];
    const proveedores = proveedorIds.length
      ? await this.proveedorRepo.find({
          where: proveedorIds.map((id) => ({ id, tenantId })),
          select: { id: true, nombre: true },
        })
      : [];
    const provById = new Map(proveedores.map((p) => [p.id, p.nombre]));

    const productos = this.ordenarProductos(
      rows.map((row) => ({
        id: row.id,
        codigo: row.codigo,
        nombre: row.nombre,
        ivaPorcentaje: row.ivaPorcentaje != null ? Number(row.ivaPorcentaje) : null,
        unidad: row.unidad,
        unidadCompra: null,
        contenidoUnidadCompra: null,
        proveedorId: row.proveedorId,
        proveedorNombre: row.proveedorId ? (provById.get(row.proveedorId) ?? null) : null,
        stockActual: Number(row.stockActual),
        precioCosto: Number(row.precioCosto),
        precioVenta: Number(row.precioVenta),
      })),
      raw,
    ).slice(0, RESULT_LIMIT);

    return {
      data: {
        productos,
        alcance,
        unificarProductosEntreProveedores: unificar,
      },
    };
  }

  private ordenarProductos<T extends { codigo: string; nombre: string }>(
    productos: T[],
    qRaw: string,
  ): T[] {
    const q = qRaw.trim().toLowerCase();
    return [...productos].sort((a, b) => {
      const aExact = q && a.codigo.trim().toLowerCase() === q ? 1 : 0;
      const bExact = q && b.codigo.trim().toLowerCase() === q ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      return a.nombre.localeCompare(b.nombre, 'es');
    });
  }
}
