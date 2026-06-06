import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { TenantContext } from '../auth/tenant-context.service';
import {
  calcularPrecioVenta,
  IVA_DEFAULT_PCT,
} from '../products/utils/calcular-precio-venta';
import { Producto } from '../products/entities/producto.entity';
import { UsersService } from '../users/users.service';
import { UpsertBranchPricingDto } from './dto/upsert-branch-pricing.dto';
import { PrecioSucursal } from './entities/precio-sucursal.entity';
import { Sucursal } from './entities/sucursal.entity';
import { SucursalContext } from './sucursal-context.service';

export type BranchPricingEffective = {
  productoId: string;
  sucursalId: string;
  precioCosto: number;
  precioVenta: number;
  porcentajeGanancia: number | null;
  hasOverride: boolean;
  branchPricingMarginApplied?: boolean;
  branchPricingManual?: boolean;
};

@Injectable()
export class BranchPricingService {
  constructor(
    @InjectRepository(PrecioSucursal)
    private readonly precioRepo: Repository<PrecioSucursal>,
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
    private readonly usersService: UsersService,
  ) {}

  async listForProduct(productoId: string) {
    const tenantId = this.tenantContext.getTenantId();
    await this.assertProducto(productoId, tenantId);

    const rows = await this.precioRepo.find({
      where: { tenantId, productoId },
      order: { updatedAt: 'DESC' },
    });

    return { data: rows.map((r) => this.serialize(r)) };
  }

  async getEffective(productoId: string, sucursalId?: string) {
    const tenantId = this.tenantContext.getTenantId();
    const producto = await this.findProductoOrThrow(productoId, tenantId);
    const depotId = await this.resolveDepotId(productoId, sucursalId);
    return { data: await this.buildEffective(producto, depotId) };
  }

  async upsert(productoId: string, dto: UpsertBranchPricingDto, user: AccessTokenPayload) {
    const tenantId = this.tenantContext.getTenantId();
    const producto = await this.findProductoOrThrow(productoId, tenantId);
    await this.assertOperableDepot(user, tenantId, producto, dto.sucursalId);

    if (dto.precioCosto === undefined || dto.precioVenta === undefined) {
      throw new BadRequestException(
        'precioCosto y precioVenta son obligatorios (null para heredar del producto).',
      );
    }

    let precioCosto = dto.precioCosto;
    let precioVenta = dto.precioVenta;
    const porcentajeGanancia =
      dto.porcentajeGanancia === undefined ? null : dto.porcentajeGanancia;

    if (porcentajeGanancia !== null) {
      const sucursal = await this.sucursalRepo.findOne({
        where: { id: dto.sucursalId, tenantId },
      });
      const posPrefs = (sucursal?.posPrefs ?? {}) as Record<string, unknown>;
      const costoBase =
        precioCosto != null ? precioCosto : Number(producto.precioCosto ?? 0);
      precioVenta = calcularPrecioVenta(costoBase, porcentajeGanancia, null, IVA_DEFAULT_PCT, {
        redondearPreciosCentenas: posPrefs.pvpRedondeoCentenasArriba === true,
        redondearMenores100ADecenas: posPrefs.pvpRedondeoMenores100ADecenas === true,
      });
    }

    if (precioCosto === null && precioVenta === null && porcentajeGanancia === null) {
      await this.precioRepo.delete({
        tenantId,
        productoId,
        sucursalId: dto.sucursalId,
      });
      return { data: { ok: true, deleted: true } };
    }

    let row = await this.precioRepo.findOne({
      where: { tenantId, productoId, sucursalId: dto.sucursalId },
    });

    if (!row) {
      row = this.precioRepo.create({
        tenantId,
        productoId,
        sucursalId: dto.sucursalId,
      });
    }

    row.precioCosto = precioCosto != null ? String(precioCosto) : null;
    row.precioVenta = precioVenta != null ? String(precioVenta) : null;
    row.porcentajeGanancia =
      porcentajeGanancia != null ? String(porcentajeGanancia) : null;

    const saved = await this.precioRepo.save(row);
    return { data: this.serialize(saved) };
  }

  mergeEffective(
    producto: Pick<Producto, 'id' | 'precioCosto' | 'precioVenta'>,
    override: PrecioSucursal | null,
    sucursalId: string,
  ): BranchPricingEffective {
    if (!override) {
      return {
        productoId: producto.id,
        sucursalId,
        precioCosto: Number(producto.precioCosto),
        precioVenta: Number(producto.precioVenta),
        porcentajeGanancia: null,
        hasOverride: false,
      };
    }

    const precioCosto =
      override.precioCosto != null
        ? Number(override.precioCosto)
        : Number(producto.precioCosto);
    const precioVenta =
      override.precioVenta != null
        ? Number(override.precioVenta)
        : Number(producto.precioVenta);
    const tieneGanancia = override.porcentajeGanancia != null;
    const porcentajeGanancia = tieneGanancia
      ? Number(override.porcentajeGanancia)
      : null;
    const manual = !tieneGanancia && override.precioVenta != null;

    return {
      productoId: producto.id,
      sucursalId,
      precioCosto,
      precioVenta,
      porcentajeGanancia,
      hasOverride: true,
      ...(tieneGanancia ? { branchPricingMarginApplied: true } : {}),
      ...(manual ? { branchPricingManual: true } : {}),
    };
  }

  private async resolveDepotId(productoId: string, sucursalId?: string): Promise<string> {
    if (sucursalId) {
      await this.assertSucursal(this.tenantContext.getTenantId(), sucursalId);
      return sucursalId;
    }
    const fromCtx = await this.sucursalContext.resolveSucursalId();
    if (fromCtx) {
      return fromCtx;
    }
    const tenantId = this.tenantContext.getTenantId();
    const producto = await this.productoRepo.findOne({
      where: { id: productoId, tenantId },
      select: ['id', 'sucursalId'],
    });
    if (producto?.sucursalId) {
      return producto.sucursalId;
    }
    throw new BadRequestException(
      'Indic├í sucursalId (query/header X-Sucursal-Id) o eleg├¡ sucursal activa.',
    );
  }

  private async buildEffective(producto: Producto, sucursalId: string) {
    const tenantId = this.tenantContext.getTenantId();
    const override = await this.precioRepo.findOne({
      where: { tenantId, productoId: producto.id, sucursalId },
    });
    return this.mergeEffective(producto, override, sucursalId);
  }

  private async assertOperableDepot(
    user: AccessTokenPayload,
    tenantId: string,
    producto: Producto,
    sucursalId: string,
  ) {
    const appRole = resolveAppRole(user);
    const operable = await this.usersService.listOperableSucursalIds(
      user.sub,
      tenantId,
      appRole,
    );

    if (producto.sucursalId && !operable.includes(producto.sucursalId)) {
      throw new ForbiddenException('No ten├®s permisos para ver este producto.');
    }
    if (!operable.includes(sucursalId)) {
      throw new ForbiddenException('No ten├®s permisos para ese dep├│sito.');
    }

    try {
      await this.usersService.assertCanOperateSucursal(
        user.sub,
        tenantId,
        sucursalId,
        appRole,
      );
    } catch {
      throw new ForbiddenException('No ten├®s permisos para ese dep├│sito.');
    }
  }

  private async findProductoOrThrow(productoId: string, tenantId: string) {
    const producto = await this.productoRepo.findOne({
      where: { id: productoId, tenantId, activo: true },
    });
    if (!producto?.sucursalId) {
      throw new NotFoundException('Producto no encontrado');
    }
    return producto;
  }

  private async assertProducto(productoId: string, tenantId: string) {
    const ok = await this.productoRepo.exist({
      where: { id: productoId, tenantId, activo: true },
    });
    if (!ok) {
      throw new NotFoundException('Producto no encontrado');
    }
  }

  private async assertSucursal(tenantId: string, sucursalId: string) {
    const ok = await this.sucursalRepo.exist({
      where: { id: sucursalId, tenantId, activa: true },
    });
    if (!ok) {
      throw new NotFoundException('Sucursal no encontrada o inactiva.');
    }
  }

  private serialize(row: PrecioSucursal) {
    return {
      id: row.id,
      productoId: row.productoId,
      sucursalId: row.sucursalId,
      precioCosto: row.precioCosto != null ? Number(row.precioCosto) : null,
      precioVenta: row.precioVenta != null ? Number(row.precioVenta) : null,
      porcentajeGanancia:
        row.porcentajeGanancia != null ? Number(row.porcentajeGanancia) : null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
