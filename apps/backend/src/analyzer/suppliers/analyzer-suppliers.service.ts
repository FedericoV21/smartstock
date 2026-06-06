import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { TenantContext } from '../../auth/tenant-context.service';
import { Proveedor } from '../../catalog/entities/proveedor.entity';
import { ModuloConfig } from '../../config/entities/modulo-config.entity';
import { Producto } from '../../products/entities/producto.entity';
import { ProductoProveedor } from '../../products/entities/producto-proveedor.entity';
import { ListaPrecios } from '../price-lists/entities/lista-precios.entity';
import { EstadoListaPrecios } from '../price-lists/enums/estado-lista-precios.enum';
import {
  calcularScoresProveedores,
  regresionLineal,
  type RelacionProductoProveedor,
} from './utils/comparar-proveedores.util';

const ESTADOS_LISTA_ANALIZADOS = [
  EstadoListaPrecios.Analizada,
  EstadoListaPrecios.Aplicada,
];

export type PerfilProveedorResponse = {
  proveedor_id: string;
  proveedor_nombre: string;
  total_listas: number;
  total_productos: number;
  historial: {
    fecha: string;
    variacion_promedio_pct: number | null;
    total_items: number;
  }[];
  tendencia_pct: number | null;
  prediccion_proxima_pct: number | null;
  productos: {
    producto_id: string;
    producto_nombre: string;
    precio_costo: number;
  }[];
};

@Injectable()
export class AnalyzerSuppliersService {
  constructor(
    @InjectRepository(ProductoProveedor)
    private readonly productoProveedorRepo: Repository<ProductoProveedor>,
    @InjectRepository(Producto) private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Proveedor) private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(ListaPrecios) private readonly listaRepo: Repository<ListaPrecios>,
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
  ) {}

  async comparar(productoId?: string, categoriaId?: string) {
    await this.assertAnalizador();
    const tenantId = this.tenantContext.getTenantId();

    let relaciones = await this.loadRelaciones(tenantId, productoId, categoriaId);
    if (relaciones.length === 0) {
      relaciones = await this.loadRelacionesFromProducto(tenantId, productoId, categoriaId);
    }

    const proveedorIds = [...new Set(relaciones.map((r) => r.proveedorId))];
    if (proveedorIds.length === 0) {
      return { proveedores: [] };
    }

    const [proveedores, listas] = await Promise.all([
      this.proveedorRepo.find({
        where: proveedorIds.map((id) => ({ id, tenantId })),
        select: { id: true, nombre: true },
      }),
      this.listaRepo.find({
        where: {
          tenantId,
          proveedorId: In(proveedorIds),
          estado: In(ESTADOS_LISTA_ANALIZADOS),
        },
        select: { proveedorId: true, variacionPromedioPct: true },
        order: { createdAt: 'DESC' },
      }),
    ]);

    const nombres = new Map(proveedores.map((p) => [p.id, p.nombre]));
    const scores = calcularScoresProveedores(
      relaciones,
      nombres,
      listas.map((l) => ({
        proveedorId: l.proveedorId,
        variacionPromedioPct:
          l.variacionPromedioPct != null ? Number(l.variacionPromedioPct) : null,
      })),
    );

    return { proveedores: scores };
  }

  async perfil(proveedorId: string): Promise<PerfilProveedorResponse> {
    await this.assertAnalizador();
    const tenantId = this.tenantContext.getTenantId();

    const proveedor = await this.proveedorRepo.findOne({
      where: { id: proveedorId, tenantId },
      select: { id: true, nombre: true },
    });
    if (!proveedor) throw new NotFoundException('Proveedor no encontrado');

    const listas = await this.listaRepo.find({
      where: {
        tenantId,
        proveedorId,
        estado: In(ESTADOS_LISTA_ANALIZADOS),
      },
      select: {
        createdAt: true,
        variacionPromedioPct: true,
        totalItems: true,
      },
      order: { createdAt: 'ASC' },
    });

    const historial = listas.map((l) => ({
      fecha: l.createdAt.toISOString().slice(0, 10),
      variacion_promedio_pct:
        l.variacionPromedioPct != null ? Number(l.variacionPromedioPct) : null,
      total_items: l.totalItems,
    }));

    const variaciones = historial
      .map((h) => h.variacion_promedio_pct)
      .filter((v): v is number => v != null);

    let tendencia: number | null = null;
    let prediccion: number | null = null;
    if (variaciones.length >= 2) {
      const reg = regresionLineal(variaciones);
      tendencia = reg.pendiente;
      prediccion = reg.prediccion;
    }

    const [relaciones, productosPrincipal] = await Promise.all([
      this.productoProveedorRepo.find({
        where: { tenantId, proveedorId },
        take: 50,
        select: { productoId: true, precioCosto: true },
      }),
      this.productoRepo.find({
        where: { tenantId, proveedorId, activo: true },
        take: 50,
        select: { id: true, nombre: true, precioCosto: true },
      }),
    ]);

    const productoIds = [
      ...new Set([
        ...relaciones.map((r) => r.productoId),
        ...productosPrincipal.map((p) => p.id),
      ]),
    ].slice(0, 50);

    const productosDb =
      productoIds.length > 0
        ? await this.productoRepo.find({
            where: productoIds.map((id) => ({ id, tenantId })),
            select: { id: true, nombre: true, precioCosto: true },
          })
        : [];

    const precioPorProducto = new Map<string, number>();
    for (const p of productosPrincipal) {
      precioPorProducto.set(p.id, Number(p.precioCosto));
    }
    for (const r of relaciones) {
      if (!precioPorProducto.has(r.productoId)) {
        precioPorProducto.set(r.productoId, Number(r.precioCosto));
      }
    }

    const productos = productosDb.map((p) => ({
      producto_id: p.id,
      producto_nombre: p.nombre,
      precio_costo: precioPorProducto.get(p.id) ?? Number(p.precioCosto),
    }));

    return {
      proveedor_id: proveedor.id,
      proveedor_nombre: proveedor.nombre,
      total_listas: historial.length,
      total_productos: productos.length,
      historial,
      tendencia_pct: tendencia,
      prediccion_proxima_pct: prediccion,
      productos,
    };
  }

  private async loadRelaciones(
    tenantId: string,
    productoId?: string,
    categoriaId?: string,
  ): Promise<RelacionProductoProveedor[]> {
    const qb = this.productoProveedorRepo
      .createQueryBuilder('pp')
      .select(['pp.proveedor_id', 'pp.producto_id', 'pp.precio_costo'])
      .where('pp.tenant_id = :tenantId', { tenantId });

    if (productoId?.trim()) {
      qb.andWhere('pp.producto_id = :productoId', { productoId: productoId.trim() });
    }

    if (categoriaId?.trim() && !productoId?.trim()) {
      qb.innerJoin(Producto, 'p', 'p.id = pp.producto_id')
        .andWhere('p.categoria_id = :categoriaId', { categoriaId: categoriaId.trim() })
        .andWhere('p.activo = true');
    }

    const rows = await qb.getRawMany<{
      pp_proveedor_id: string;
      pp_producto_id: string;
      pp_precio_costo: string;
    }>();

    return rows.map((r) => ({
      proveedorId: r.pp_proveedor_id,
      productoId: r.pp_producto_id,
      precioCosto: Number(r.pp_precio_costo),
    }));
  }

  private async loadRelacionesFromProducto(
    tenantId: string,
    productoId?: string,
    categoriaId?: string,
  ): Promise<RelacionProductoProveedor[]> {
    const qb = this.productoRepo
      .createQueryBuilder('p')
      .select(['p.id', 'p.proveedor_id', 'p.precio_costo'])
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.activo = true')
      .andWhere('p.proveedor_id IS NOT NULL');

    if (productoId?.trim()) {
      qb.andWhere('p.id = :productoId', { productoId: productoId.trim() });
    }
    if (categoriaId?.trim() && !productoId?.trim()) {
      qb.andWhere('p.categoria_id = :categoriaId', { categoriaId: categoriaId.trim() });
    }

    const productos = await qb.getMany();
    return productos.map((p) => ({
      proveedorId: p.proveedorId!,
      productoId: p.id,
      precioCosto: Number(p.precioCosto),
    }));
  }

  private async assertAnalizador() {
    const mod = await this.moduloRepo.findOne({
      where: { tenantId: this.tenantContext.getTenantId() },
    });
    if (!mod?.analizadorRentabilidad) {
      throw new ForbiddenException(
        'El m├│dulo analizador_rentabilidad no est├í habilitado para tu plan.',
      );
    }
  }
}
