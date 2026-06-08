import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { BranchPluService } from '../branches/branch-plu.service';
import { PluSucursal } from '../branches/entities/plu-sucursal.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { tenantPermiteBalanzaPorSucursal } from '../config/utils/pos-prefs.util';
import { ProductoPromocion } from '../promotions/entities/producto-promocion.entity';
import { UsersService } from '../users/users.service';
import {
  CloneBranchDto,
  PluFueraDeRangoQueryDto,
  PutGananciaTramosDto,
} from './dto/products-extended.dto';
import { ProductoGananciaTramo } from './entities/producto-ganancia-tramo.entity';
import { Producto } from './entities/producto.entity';
import { validarTramos } from './utils/ganancia-tramos.util';

const CHUNK_RPC = 40;
const MAX_PRODUCTO_IDS_POR_REQUEST = 300;

type CloneRpcResult = {
  total_creados?: number;
  creados?: unknown;
  omitidos?: unknown;
};

@Injectable()
export class ProductsExtendedService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Producto) private readonly productoRepo: Repository<Producto>,
    @InjectRepository(ProductoGananciaTramo)
    private readonly tramoRepo: Repository<ProductoGananciaTramo>,
    @InjectRepository(ProductoPromocion)
    private readonly productoPromocionRepo: Repository<ProductoPromocion>,
    @InjectRepository(PluSucursal) private readonly pluSucursalRepo: Repository<PluSucursal>,
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    private readonly tenantContext: TenantContext,
    private readonly usersService: UsersService,
    private readonly branchPluService: BranchPluService,
  ) {}

  async getGananciaTramos(productoId: string, user: AccessTokenPayload) {
    await this.assertStock();
    await this.assertProductOperable(productoId, user);
    const tenantId = this.tenantContext.getTenantId();

    const rows = await this.tramoRepo.find({
      where: { tenantId, productoId },
      order: { orden: 'ASC', cantidadDesde: 'ASC' },
    });

    return {
      producto_id: productoId,
      tramos: rows.map((r) => ({
        id: r.id,
        cantidad_desde: Number(r.cantidadDesde),
        ganancia_pct: Number(r.gananciaPct),
        orden: r.orden,
      })),
    };
  }

  async putGananciaTramos(productoId: string, dto: PutGananciaTramosDto, user: AccessTokenPayload) {
    await this.assertStock();
    if (resolveAppRole(user) === 'visor') {
      throw new ForbiddenException('Los usuarios visor no pueden editar tramos de ganancia.');
    }
    await this.assertProductOperable(productoId, user);
    const tenantId = this.tenantContext.getTenantId();

    const val = validarTramos(dto.tramos ?? []);
    if (!val.ok) throw new BadRequestException(val.error);

    await this.tramoRepo.delete({ tenantId, productoId });

    if (val.tramos.length === 0) {
      return { producto_id: productoId, tramos: [] };
    }

    const rows = val.tramos.map((t, idx) =>
      this.tramoRepo.create({
        tenantId,
        productoId,
        cantidadDesde: String(t.cantidad_desde),
        gananciaPct: String(t.ganancia_pct),
        orden: idx,
      }),
    );
    const saved = await this.tramoRepo.save(rows);

    return {
      producto_id: productoId,
      tramos: saved.map((r) => ({
        id: r.id,
        cantidad_desde: Number(r.cantidadDesde),
        ganancia_pct: Number(r.gananciaPct),
        orden: r.orden,
      })),
    };
  }

  async listPromocionesProducto(productoId: string) {
    await this.assertStock();
    const tenantId = this.tenantContext.getTenantId();

    const producto = await this.productoRepo.findOne({ where: { id: productoId, tenantId } });
    if (!producto) throw new NotFoundException('Producto no encontrado');

    const links = await this.productoPromocionRepo.find({
      where: { productoId },
      relations: ['promocion'],
    });

    const promociones = links
      .map((link) => link.promocion)
      .filter((p): p is NonNullable<typeof p> => p != null)
      .map((p) => ({
        id: p.id,
        nombre: p.nombre,
        tipo: p.tipo,
        activa: p.activa,
        vigente_desde: p.vigenteDesde,
        vigente_hasta: p.vigenteHasta,
        dias_semana: p.diasSemana,
        cantidad_lleva: p.cantidadLleva,
        cantidad_paga: p.cantidadPaga,
        unidad_descuento: p.unidadDescuento,
        porcentaje: p.porcentaje != null ? Number(p.porcentaje) : null,
        cantidad_minima: p.cantidadMinima,
      }));

    return { promociones };
  }

  async countPluFueraDeRango(query: PluFueraDeRangoQueryDto) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const digitos = query.digitos;
    const sucursalId = query.sucursal_id?.trim() || null;

    if (!Number.isFinite(digitos) || digitos < 1 || digitos > 5) {
      throw new BadRequestException('Parámetro digitos inválido (usar 1 a 5).');
    }

    if (digitos >= 5) {
      return { count: 0, digitos, sucursal_id: sucursalId };
    }

    const thresholdStr = String(10 ** digitos).padStart(5, '0');
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const balanzaPorSucursal = tenantPermiteBalanzaPorSucursal(tenant?.posPrefs);

    if (!sucursalId || !balanzaPorSucursal) {
      const count = await this.productoRepo
        .createQueryBuilder('p')
        .where('p.tenant_id = :tenantId', { tenantId })
        .andWhere('p.activo = true')
        .andWhere('p.plu IS NOT NULL')
        .andWhere('p.plu >= :threshold', { threshold: thresholdStr })
        .getCount();

      return { count, digitos, sucursal_id: null };
    }

    const [productos, overrides] = await Promise.all([
      this.productoRepo.find({
        where: { tenantId, activo: true, plu: Not(IsNull()) },
        select: { id: true, plu: true },
      }),
      this.pluSucursalRepo.find({
        where: { tenantId, sucursalId },
        select: { productoId: true, plu: true },
      }),
    ]);

    const overrideByProducto = new Map(overrides.map((r) => [r.productoId, r.plu]));
    let count = 0;
    for (const p of productos) {
      const efectivo = this.branchPluService.resolveEffectivePlu(p.plu, overrideByProducto.get(p.id));
      if (efectivo && efectivo >= thresholdStr) count += 1;
    }

    return { count, digitos, sucursal_id: sucursalId };
  }

  async cloneBranch(dto: CloneBranchDto, user: AccessTokenPayload) {
    await this.assertStock();
    if (resolveAppRole(user) === 'visor') {
      throw new ForbiddenException('Los usuarios visor no pueden clonar productos.');
    }

    const tenantId = this.tenantContext.getTenantId();
    const appRole = resolveAppRole(user);
    const origen = dto.sucursal_origen_id.trim();
    const destIds = this.resolveDestinoIds(dto);

    if (!origen || destIds.length === 0) {
      throw new BadRequestException(
        'sucursal_origen_id y al menos un destino (sucursal_destino_id o sucursal_destino_ids) son obligatorios.',
      );
    }
    if (destIds.some((d) => d === origen)) {
      throw new BadRequestException('Origen y destino deben ser distintos.');
    }

    const productoIds = dto.producto_ids.map((id) => id.trim()).filter(Boolean);
    if (productoIds.length === 0) {
      throw new BadRequestException('Indicá al menos un producto_id en producto_ids.');
    }
    if (productoIds.length > MAX_PRODUCTO_IDS_POR_REQUEST) {
      throw new BadRequestException({
        message: `Máximo ${MAX_PRODUCTO_IDS_POR_REQUEST} productos por petición. El listado reintenta en lotes automáticos.`,
        code: 'BATCH_TOO_LARGE',
        max: MAX_PRODUCTO_IDS_POR_REQUEST,
      });
    }

    for (const sid of [origen, ...destIds]) {
      await this.usersService.assertCanOperateSucursal(user.sub, tenantId, sid, appRole);
    }

    if (destIds.length === 1) {
      const parts = await this.runCloneBatches(tenantId, origen, destIds[0]!, productoIds);
      return this.mergeCloneResults(parts);
    }

    const resultados: Array<
      CloneRpcResult & { sucursal_destino_id: string; error?: string }
    > = [];
    for (const dest of destIds) {
      try {
        const parts = await this.runCloneBatches(tenantId, origen, dest, productoIds);
        resultados.push({ sucursal_destino_id: dest, ...this.mergeCloneResults(parts) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error al clonar productos';
        resultados.push({ sucursal_destino_id: dest, error: msg });
      }
    }

    const conError = resultados.find((r) => r.error);
    if (conError) {
      throw new BadRequestException({ error: conError.error, resultados });
    }

    return { resultados };
  }

  private resolveDestinoIds(dto: CloneBranchDto): string[] {
    const fromArray = (dto.sucursal_destino_ids ?? [])
      .filter((x) => typeof x === 'string' && x.trim() !== '')
      .map((x) => x.trim());
    if (fromArray.length > 0) return [...new Set(fromArray)];
    const single = dto.sucursal_destino_id?.trim();
    return single ? [single] : [];
  }

  private async runCloneBatches(
    tenantId: string,
    origen: string,
    dest: string,
    productoIds: string[],
  ): Promise<CloneRpcResult[]> {
    const chunks: string[][] = [];
    for (let i = 0; i < productoIds.length; i += CHUNK_RPC) {
      chunks.push(productoIds.slice(i, i + CHUNK_RPC));
    }

    const parts: CloneRpcResult[] = [];
    for (const chunk of chunks) {
      const rows = (await this.dataSource.query(
        `SELECT public.clonar_productos_a_sucursal($1::uuid, $2::uuid, $3::uuid, $4::uuid[]) AS result`,
        [tenantId, origen, dest, chunk],
      )) as Array<{ result?: CloneRpcResult }>;
      parts.push(rows[0]?.result ?? {});
    }
    return parts;
  }

  private mergeCloneResults(parts: CloneRpcResult[]): CloneRpcResult {
    let total = 0;
    const creados: unknown[] = [];
    const omitidos: unknown[] = [];
    for (const p of parts) {
      total += p.total_creados ?? 0;
      if (Array.isArray(p.creados)) creados.push(...p.creados);
      if (Array.isArray(p.omitidos)) omitidos.push(...p.omitidos);
    }
    return { total_creados: total, creados, omitidos };
  }

  private async assertProductOperable(productoId: string, user: AccessTokenPayload) {
    const tenantId = this.tenantContext.getTenantId();
    const producto = await this.productoRepo.findOne({
      where: { id: productoId, tenantId },
      select: { id: true, sucursalId: true },
    });
    if (!producto?.sucursalId) {
      throw new NotFoundException('Producto no encontrado');
    }

    const operableIds = await this.usersService.listOperableSucursalIds(
      user.sub,
      tenantId,
      resolveAppRole(user),
    );
    if (operableIds.length === 0) {
      throw new ForbiddenException('No hay sucursales operativas.');
    }
    if (!operableIds.includes(producto.sucursalId)) {
      throw new ForbiddenException('No tenés permisos para ver este producto.');
    }
  }

  private async assertStock(): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const modulos = await this.moduloRepo.findOne({ where: { tenantId } });
    if (!modulos?.stock) {
      throw new ForbiddenException('Módulo stock no habilitado');
    }
  }

  private async assertFacturadorPos(): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const modulos = await this.moduloRepo.findOne({ where: { tenantId } });
    if (!modulos?.facturadorPos) {
      throw new ForbiddenException('Módulo facturador_pos no habilitado');
    }
  }
}
