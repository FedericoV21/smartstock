import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, QueryFailedError, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { TenantContext } from '../auth/tenant-context.service';
import { Producto } from '../products/entities/producto.entity';
import { normalizarPlu5 } from '../products/utils/normalizar-plu';
import { UnidadMedida } from '../products/enums/unidad-medida.enum';
import { UsersService } from '../users/users.service';
import { UpsertBranchPluDto } from './dto/upsert-branch-plu.dto';
import { PluSucursal } from './entities/plu-sucursal.entity';
import { Sucursal } from './entities/sucursal.entity';
import { SucursalContext } from './sucursal-context.service';

@Injectable()
export class BranchPluService {
  constructor(
    @InjectRepository(PluSucursal)
    private readonly pluRepo: Repository<PluSucursal>,
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

    const rows = await this.pluRepo.find({
      where: { tenantId, productoId },
      order: { updatedAt: 'DESC' },
    });

    return {
      data: rows.map((r) => ({
        sucursalId: r.sucursalId,
        plu: r.plu,
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }

  async getEffective(productoId: string, sucursalId?: string) {
    const tenantId = this.tenantContext.getTenantId();
    const producto = await this.findProductoOrThrow(productoId, tenantId);
    const depotId = await this.resolveDepotId(productoId, sucursalId);

    const override = await this.pluRepo.findOne({
      where: { tenantId, productoId, sucursalId: depotId },
    });

    return {
      data: {
        productoId,
        sucursalId: depotId,
        plu: this.resolveEffectivePlu(producto.plu, override?.plu ?? null),
        hasOverride: !!override,
        catalogPlu: producto.plu,
      },
    };
  }

  async upsert(productoId: string, dto: UpsertBranchPluDto, user: AccessTokenPayload) {
    const tenantId = this.tenantContext.getTenantId();
    const producto = await this.findProductoOrThrow(productoId, tenantId);
    await this.assertOperableDepot(user, tenantId, producto, dto.sucursalId);
    this.assertProductUsesPlu(producto);

    if (dto.plu === undefined) {
      throw new BadRequestException('plu es obligatorio (null para heredar del producto).');
    }

    const pluNormalizado =
      dto.plu === null || dto.plu === ''
        ? null
        : normalizarPlu5(dto.plu);

    if (dto.plu != null && dto.plu !== '' && !pluNormalizado) {
      throw new BadRequestException('PLU inv├ílido.');
    }

    if (pluNormalizado === null) {
      await this.pluRepo.delete({
        tenantId,
        productoId,
        sucursalId: dto.sucursalId,
      });
      return { data: { ok: true, deleted: true } };
    }

    const disponible = await this.isPluAvailable(
      tenantId,
      dto.sucursalId,
      pluNormalizado,
      productoId,
    );
    if (!disponible) {
      throw new ConflictException('Ya existe otro producto con ese PLU en esta sucursal.');
    }

    let row = await this.pluRepo.findOne({
      where: { tenantId, productoId, sucursalId: dto.sucursalId },
    });
    if (!row) {
      row = this.pluRepo.create({
        tenantId,
        productoId,
        sucursalId: dto.sucursalId,
        plu: pluNormalizado,
      });
    } else {
      row.plu = pluNormalizado;
    }

    try {
      const saved = await this.pluRepo.save(row);
      return {
        data: {
          sucursalId: saved.sucursalId,
          plu: saved.plu,
        },
      };
    } catch (err) {
      this.rethrowPluConflict(err);
      throw err;
    }
  }

  resolveEffectivePlu(
    productoPlu: string | null | undefined,
    overridePlu: string | null | undefined,
  ): string | null {
    if (overridePlu != null && String(overridePlu).trim() !== '') {
      return normalizarPlu5(overridePlu);
    }
    if (productoPlu != null && String(productoPlu).trim() !== '') {
      return normalizarPlu5(productoPlu);
    }
    return null;
  }

  async isPluAvailable(
    tenantId: string,
    sucursalId: string,
    plu: string,
    excludeProductoId?: string,
  ): Promise<boolean> {
    const pluNorm = normalizarPlu5(plu);
    if (!pluNorm) return true;

    const overrideConflict = await this.pluRepo.findOne({
      where: {
        tenantId,
        sucursalId,
        plu: pluNorm,
        ...(excludeProductoId ? { productoId: Not(excludeProductoId) } : {}),
      },
    });
    if (overrideConflict) return false;

    const globalMatches = await this.productoRepo.find({
      where: {
        tenantId,
        activo: true,
        plu: pluNorm,
        ...(excludeProductoId ? { id: Not(excludeProductoId) } : {}),
      },
      select: ['id'],
      take: 20,
    });
    if (globalMatches.length === 0) return true;

    const ids = globalMatches.map((p) => p.id);
    const overridesForThose = await this.pluRepo.find({
      where: { tenantId, sucursalId, productoId: In(ids) },
      select: ['productoId'],
    });
    const withOverride = new Set(overridesForThose.map((r) => r.productoId));
    return !globalMatches.some((p) => !withOverride.has(p.id));
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

  private assertProductUsesPlu(producto: Producto) {
    const usaPlu =
      producto.esPesable === true ||
      (producto.unidad === UnidadMedida.unidad && !!(producto.plu ?? '').trim());
    if (!usaPlu) {
      throw new BadRequestException('Este producto no usa PLU de balanza.');
    }
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

    await this.usersService.assertCanOperateSucursal(
      user.sub,
      tenantId,
      sucursalId,
      appRole,
    );
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

  private rethrowPluConflict(err: unknown): void {
    if (err instanceof QueryFailedError) {
      const code = (err.driverError as { code?: string })?.code;
      if (code === '23505') {
        throw new ConflictException(
          'Ya existe otro producto con ese PLU en esta sucursal.',
        );
      }
    }
  }
}
