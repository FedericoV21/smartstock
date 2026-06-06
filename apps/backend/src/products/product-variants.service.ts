import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { TenantContext } from '../auth/tenant-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { UsersService } from '../users/users.service';
import { CreateProductoVarianteDto } from './dto/create-producto-variante.dto';
import { UpdateProductoVarianteDto } from './dto/update-producto-variante.dto';
import { UpsertVariantBranchStockDto } from './dto/upsert-variant-branch-stock.dto';
import { ProductoVarianteStockSucursal } from './entities/producto-variante-stock-sucursal.entity';
import { ProductoVariante } from './entities/producto-variante.entity';
import { Producto } from './entities/producto.entity';
import { etiquetaVariante, normalizarAtributosVariante } from './utils/variante-label';

@Injectable()
export class ProductVariantsService {
  constructor(
    @InjectRepository(ProductoVariante)
    private readonly varianteRepo: Repository<ProductoVariante>,
    @InjectRepository(ProductoVarianteStockSucursal)
    private readonly stockRepo: Repository<ProductoVarianteStockSucursal>,
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    private readonly tenantContext: TenantContext,
    private readonly usersService: UsersService,
  ) {}

  async listForProduct(productoId: string, user: AccessTokenPayload) {
    const tenantId = this.tenantContext.getTenantId();
    const { producto, operableIds } = await this.assertProductOperable(
      productoId,
      tenantId,
      user,
    );

    const variantes = await this.varianteRepo.find({
      where: { tenantId, productoId },
      order: { orden: 'ASC', createdAt: 'ASC' },
    });

    const varianteIds = variantes.map((v) => v.id);
    const stockRows =
      varianteIds.length === 0
        ? []
        : (
            await this.stockRepo
              .createQueryBuilder('ss')
              .where('ss.tenant_id = :tenantId', { tenantId })
              .andWhere('ss.variante_id IN (:...varianteIds)', { varianteIds })
              .andWhere('ss.sucursal_id IN (:...operableIds)', { operableIds })
              .getMany()
          );

    const stockPorVariante = new Map<
      string,
      Awaited<ReturnType<typeof this.serializeStockRow>>[]
    >();
    for (const row of stockRows) {
      const arr = stockPorVariante.get(row.varianteId) ?? [];
      arr.push(await this.serializeStockRow(row));
      stockPorVariante.set(row.varianteId, arr);
    }

    return {
      data: {
        productoId,
        usaVariantes: producto.usaVariantes,
        variantes: variantes.map((v) => ({
          ...this.serializeVariante(v),
          branchStock: stockPorVariante.get(v.id) ?? [],
        })),
      },
    };
  }

  async create(productoId: string, dto: CreateProductoVarianteDto, user: AccessTokenPayload) {
    const tenantId = this.tenantContext.getTenantId();
    const { operableIds } = await this.assertProductOperable(productoId, tenantId, user);

    const atributos = normalizarAtributosVariante(dto.atributos);
    const etiqueta = dto.etiqueta?.trim() || null;
    const codigo = dto.codigo?.trim() || null;
    const codigoBarras = dto.codigoBarras?.trim() || null;
    const orden = dto.orden ?? 0;

    if (
      Object.keys(atributos).length === 0 &&
      !codigo &&
      !codigoBarras &&
      !etiqueta
    ) {
      throw new BadRequestException(
        'La variante necesita al menos un atributo, etiqueta, c├│digo o c├│digo de barras.',
      );
    }

    if (codigoBarras) {
      await this.assertBarcodeNotUsedByProduct(tenantId, codigoBarras);
    }

    let variante: ProductoVariante;
    try {
      variante = await this.varianteRepo.save(
        this.varianteRepo.create({
          tenantId,
          productoId,
          codigo,
          codigoBarras,
          atributos,
          etiqueta,
          orden,
          activo: dto.activo !== false,
        }),
      );
    } catch (err) {
      this.rethrowUniqueVariante(err);
      throw err;
    }

    const bySucursal = new Map((dto.branchStock ?? []).map((s) => [s.sucursalId, s]));
    const stockRows = operableIds.map((sucursalId) => {
      const s = bySucursal.get(sucursalId);
      return this.stockRepo.create({
        tenantId,
        productoId,
        varianteId: variante.id,
        sucursalId,
        stockActual: String(s?.stockActual ?? 0),
        stockMinimo: String(s?.stockMinimo ?? 0),
        ubicacion: s?.ubicacion?.trim() || null,
      });
    });

    if (stockRows.length > 0) {
      try {
        await this.stockRepo.save(stockRows);
      } catch (err) {
        throw new BadRequestException(
          `Variante creada pero no se pudo inicializar stock: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await this.productoRepo.update(
      { id: productoId, tenantId },
      { usaVariantes: true },
    );

    return { data: this.serializeVariante(variante) };
  }

  async update(
    productoId: string,
    varianteId: string,
    dto: UpdateProductoVarianteDto,
    user: AccessTokenPayload,
  ) {
    const tenantId = this.tenantContext.getTenantId();
    await this.assertProductOperable(productoId, tenantId, user);
    const variante = await this.findVarianteOrThrow(varianteId, productoId, tenantId);

    if (dto.atributos !== undefined) {
      variante.atributos = normalizarAtributosVariante(dto.atributos);
    }
    if (dto.etiqueta !== undefined) {
      variante.etiqueta = dto.etiqueta?.trim() || null;
    }
    if (dto.codigo !== undefined) {
      variante.codigo = dto.codigo?.trim() || null;
    }
    if (dto.codigoBarras !== undefined) {
      const bar = dto.codigoBarras?.trim() || null;
      if (bar) {
        await this.assertBarcodeNotUsedByProduct(tenantId, bar);
      }
      variante.codigoBarras = bar;
    }
    if (dto.orden !== undefined) {
      variante.orden = dto.orden;
    }
    if (dto.activo !== undefined) {
      variante.activo = dto.activo;
    }

    if (
      dto.atributos === undefined &&
      dto.etiqueta === undefined &&
      dto.codigo === undefined &&
      dto.codigoBarras === undefined &&
      dto.orden === undefined &&
      dto.activo === undefined
    ) {
      throw new BadRequestException('Sin cambios.');
    }

    try {
      const saved = await this.varianteRepo.save(variante);
      return { data: this.serializeVariante(saved) };
    } catch (err) {
      this.rethrowUniqueVariante(err);
      throw err;
    }
  }

  async softDelete(productoId: string, varianteId: string, user: AccessTokenPayload) {
    const tenantId = this.tenantContext.getTenantId();
    await this.assertProductOperable(productoId, tenantId, user);
    const variante = await this.findVarianteOrThrow(varianteId, productoId, tenantId);
    variante.activo = false;
    await this.varianteRepo.save(variante);
    return { data: { ok: true } };
  }

  async upsertBranchStock(
    productoId: string,
    varianteId: string,
    dto: UpsertVariantBranchStockDto,
    user: AccessTokenPayload,
  ) {
    const tenantId = this.tenantContext.getTenantId();
    const { operableIds } = await this.assertProductOperable(productoId, tenantId, user);
    if (!operableIds.includes(dto.sucursalId)) {
      throw new ForbiddenException('No ten├®s permisos para esa sucursal.');
    }
    await this.findVarianteOrThrow(varianteId, productoId, tenantId);

    let row = await this.stockRepo.findOne({
      where: { tenantId, productoId, varianteId, sucursalId: dto.sucursalId },
    });

    if (!row) {
      row = this.stockRepo.create({
        tenantId,
        productoId,
        varianteId,
        sucursalId: dto.sucursalId,
        stockActual: '0',
        stockMinimo: '0',
        ubicacion: null,
      });
    }

    if (dto.stockActual !== undefined) {
      row.stockActual = String(dto.stockActual);
    }
    if (dto.stockMinimo !== undefined) {
      row.stockMinimo = String(dto.stockMinimo);
    }
    if (dto.ubicacion !== undefined) {
      row.ubicacion = dto.ubicacion?.trim() || null;
    }

    const saved = await this.stockRepo.save(row);
    return { data: await this.serializeStockRow(saved) };
  }

  private async assertProductOperable(
    productoId: string,
    tenantId: string,
    user: AccessTokenPayload,
  ) {
    const producto = await this.productoRepo.findOne({
      where: { id: productoId, tenantId },
    });
    if (!producto?.sucursalId) {
      throw new NotFoundException('Producto no encontrado.');
    }

    const appRole = resolveAppRole(user);
    const operableIds = await this.usersService.listOperableSucursalIds(
      user.sub,
      tenantId,
      appRole,
    );

    if (!operableIds.includes(producto.sucursalId)) {
      throw new ForbiddenException('No ten├®s permisos para este producto.');
    }

    return { producto, operableIds };
  }

  private async findVarianteOrThrow(
    varianteId: string,
    productoId: string,
    tenantId: string,
  ) {
    const variante = await this.varianteRepo.findOne({
      where: { id: varianteId, productoId, tenantId },
    });
    if (!variante) {
      throw new NotFoundException('Variante no encontrada.');
    }
    return variante;
  }

  private async assertBarcodeNotUsedByProduct(tenantId: string, codigoBarras: string) {
    const producto = await this.productoRepo.findOne({
      where: { tenantId, codigoBarras, activo: true },
      select: ['id', 'nombre'],
    });
    if (producto) {
      throw new ConflictException(
        `Ese c├│digo de barras ya pertenece al producto "${producto.nombre}".`,
      );
    }
  }

  private rethrowUniqueVariante(err: unknown) {
    if (err instanceof QueryFailedError && (err as QueryFailedError & { code?: string }).code === '23505') {
      throw new ConflictException('Ya existe una variante activa con esos datos.');
    }
  }

  private serializeVariante(v: ProductoVariante) {
    return {
      id: v.id,
      productoId: v.productoId,
      codigo: v.codigo,
      codigoBarras: v.codigoBarras,
      atributos: v.atributos,
      etiqueta: etiquetaVariante(v.atributos, v.etiqueta),
      activo: v.activo,
      orden: v.orden,
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
    };
  }

  private async serializeStockRow(row: ProductoVarianteStockSucursal) {
    const sucursal = await this.sucursalRepo.findOne({
      where: { id: row.sucursalId, tenantId: row.tenantId },
      select: ['id', 'nombre', 'codigo'],
    });
    return {
      sucursalId: row.sucursalId,
      stockActual: Number(row.stockActual),
      stockMinimo: Number(row.stockMinimo),
      ubicacion: row.ubicacion,
      sucursal: sucursal
        ? { id: sucursal.id, nombre: sucursal.nombre, codigo: sucursal.codigo }
        : null,
    };
  }
}
