import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Producto } from '../products/entities/producto.entity';
import { ListPromocionesQueryDto } from './dto/list-promociones-query.dto';
import { ProductoPromocion } from './entities/producto-promocion.entity';
import { PromocionComboItem } from './entities/promocion-combo-item.entity';
import { PromocionSucursal } from './entities/promocion-sucursal.entity';
import { Promocion } from './entities/promocion.entity';
import { PromocionTipo } from './enums/promocion-tipo.enum';
import type { ConflictoPromoProducto, PromocionMotor, PromocionPayload } from './types/promocion-motor.types';
import {
  promocionEntityFromPayload,
  validarCuerpoPromocion,
} from './utils/promocion-body.validation';
import { promoProductoKey, promoVarianteKey } from './utils/promocion-keys';
import { filaPromocionAMotor, promoVisibleEnSucursal } from './utils/promocion-motor';
import { promocionVigenteParaYmd } from './utils/promocion-vigencia';
import { hoyEnArgentina } from '../facturacion/utils/fecha-argentina';

@Injectable()
export class PromotionsService {
  constructor(
    @InjectRepository(Promocion)
    private readonly promocionRepo: Repository<Promocion>,
    @InjectRepository(ProductoPromocion)
    private readonly productoPromocionRepo: Repository<ProductoPromocion>,
    @InjectRepository(PromocionComboItem)
    private readonly comboItemRepo: Repository<PromocionComboItem>,
    @InjectRepository(PromocionSucursal)
    private readonly promocionSucursalRepo: Repository<PromocionSucursal>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
  ) {}

  async list(query: ListPromocionesQueryDto) {
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = query.sucursalId ?? (await this.sucursalContext.requireSucursalId());

    const accessRows = await this.promocionSucursalRepo.find({
      where: { tenantId, sucursalId },
      select: ['promocionId'],
    });
    const accessPromoIds = [...new Set(accessRows.map((r) => r.promocionId))];

    const qb = this.promocionRepo
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .orderBy('p.updated_at', 'DESC');

    if (accessPromoIds.length > 0) {
      qb.andWhere('(p.sucursal_id = :sucursalId OR p.id IN (:...accessPromoIds))', {
        sucursalId,
        accessPromoIds,
      });
    } else {
      qb.andWhere('p.sucursal_id = :sucursalId', { sucursalId });
    }

    if (query.activa === 'true') qb.andWhere('p.activa = true');
    else if (query.activa === 'false') qb.andWhere('p.activa = false');
    if (query.tipo) qb.andWhere('p.tipo = :tipo', { tipo: query.tipo });

    const rows = await qb.getMany();
    const promoIds = rows.map((r) => r.id);

    const [links, accessAll, sucursales] = await Promise.all([
      promoIds.length
        ? this.productoPromocionRepo.find({ where: { promocionId: In(promoIds), tenantId } })
        : Promise.resolve([]),
      promoIds.length
        ? this.promocionSucursalRepo.find({ where: { promocionId: In(promoIds), tenantId } })
        : Promise.resolve([]),
      this.sucursalRepo.find({ where: { tenantId, activa: true } }),
    ]);

    const sucursalMap = new Map(sucursales.map((s) => [s.id, s]));
    const countByPromo = new Map<string, number>();
    for (const l of links) {
      countByPromo.set(l.promocionId, (countByPromo.get(l.promocionId) ?? 0) + 1);
    }
    const accessByPromo = new Map<string, string[]>();
    for (const a of accessAll) {
      const arr = accessByPromo.get(a.promocionId) ?? [];
      arr.push(a.sucursalId);
      accessByPromo.set(a.promocionId, arr);
    }

    return {
      data: {
        sucursalId,
        promociones: rows.map((p) => {
          const sucursalIds = accessByPromo.get(p.id) ?? [p.sucursalId];
          return {
            ...this.serializePromocion(p),
            productosCount: countByPromo.get(p.id) ?? 0,
            sucursales: sucursalIds
              .map((id) => sucursalMap.get(id))
              .filter(Boolean)
              .map((s) => ({
                id: s!.id,
                codigo: s!.codigo,
                nombre: s!.nombre,
                activa: s!.activa,
              })),
            sucursalesCount: sucursalIds.length,
          };
        }),
      },
    };
  }

  async getById(id: string, sucursalId?: string) {
    const tenantId = this.tenantContext.getTenantId();
    const branchId = sucursalId ?? (await this.sucursalContext.requireSucursalId());

    const promo = await this.promocionRepo.findOne({ where: { id, tenantId } });
    if (!promo) throw new NotFoundException('Promoci├│n no encontrada');

    const accessIds = await this.getSucursalAccessIds(tenantId, id);
    if (!promoVisibleEnSucursal(promo.sucursalId, accessIds, branchId)) {
      throw new NotFoundException('Promoci├│n no encontrada');
    }

    const [links, comboRows, sucursales] = await Promise.all([
      this.productoPromocionRepo.find({ where: { promocionId: id, tenantId } }),
      this.comboItemRepo.find({ where: { promocionId: id, tenantId } }),
      this.sucursalRepo.find({ where: { tenantId, id: In(accessIds.length ? accessIds : [promo.sucursalId]) } }),
    ]);

    const productoIds = [...new Set([...links.map((l) => l.productoId), ...comboRows.map((c) => c.productoId)])];
    const productos =
      productoIds.length > 0
        ? await this.productoRepo.find({ where: { id: In(productoIds), tenantId } })
        : [];
    const productoMap = new Map(productos.map((p) => [p.id, p]));

    return {
      data: {
        ...this.serializePromocion(promo),
        sucursalIds: accessIds.length ? accessIds : [promo.sucursalId],
        sucursales: sucursales.map((s) => ({
          id: s.id,
          codigo: s.codigo,
          nombre: s.nombre,
          activa: s.activa,
        })),
        productoPromocion: links.map((l) => ({
          productoId: l.productoId,
          productoVarianteId: l.productoVarianteId,
          producto: productoMap.get(l.productoId)
            ? {
                id: l.productoId,
                codigo: productoMap.get(l.productoId)!.codigo,
                nombre: productoMap.get(l.productoId)!.nombre,
                precioVenta: Number(productoMap.get(l.productoId)!.precioVenta),
              }
            : null,
        })),
        promocionComboItem: comboRows.map((c) => ({
          productoId: c.productoId,
          productoVarianteId: c.productoVarianteId,
          cantidad: Number(c.cantidad),
          producto: productoMap.get(c.productoId)
            ? {
                id: c.productoId,
                codigo: productoMap.get(c.productoId)!.codigo,
                nombre: productoMap.get(c.productoId)!.nombre,
              }
            : null,
        })),
      },
    };
  }

  async create(body: unknown) {
    const parsed = validarCuerpoPromocion(body);
    if (!parsed.ok) throw new BadRequestException(parsed.error);

    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.sucursalContext.requireSucursalId();
    const sucursalesAcceso = await this.resolveSucursalIdsAcceso(
      tenantId,
      parsed.data.sucursal_ids,
      sucursalId,
    );

    const conflictos = await this.buscarConflictosProductos(
      tenantId,
      parsed.data.producto_targets,
      null,
      sucursalesAcceso,
      hoyEnArgentina(),
    );
    if (conflictos.length > 0 && !parsed.data.reemplazar) {
      throw new HttpException({ conflictos }, HttpStatus.CONFLICT);
    }

    return this.dataSource.transaction(async (manager) => {
      if (conflictos.length > 0) {
        await this.quitarVinculosConflicto(manager, conflictos);
      }

      const promo = manager.create(
        Promocion,
        promocionEntityFromPayload(tenantId, sucursalId, parsed.data),
      );
      const saved = await manager.save(Promocion, promo);

      await this.syncProductLinks(manager, tenantId, saved.id, parsed.data);
      await this.syncComboItems(manager, tenantId, saved.id, parsed.data);
      await this.syncSucursales(manager, tenantId, saved.id, sucursalesAcceso);

      return { data: this.serializePromocion(saved) };
    });
  }

  async update(id: string, body: unknown) {
    const parsed = validarCuerpoPromocion(body);
    if (!parsed.ok) throw new BadRequestException(parsed.error);

    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.sucursalContext.requireSucursalId();

    const existe = await this.promocionRepo.findOne({ where: { id, tenantId } });
    if (!existe) throw new NotFoundException('Promoci├│n no encontrada');

    const accessIds = await this.getSucursalAccessIds(tenantId, id);
    if (!promoVisibleEnSucursal(existe.sucursalId, accessIds, sucursalId)) {
      throw new NotFoundException('Promoci├│n no encontrada');
    }

    const sucursalesAcceso = await this.resolveSucursalIdsAcceso(
      tenantId,
      parsed.data.sucursal_ids,
      sucursalId,
    );

    const conflictos = await this.buscarConflictosProductos(
      tenantId,
      parsed.data.producto_targets,
      id,
      sucursalesAcceso,
      hoyEnArgentina(),
    );
    if (conflictos.length > 0 && !parsed.data.reemplazar) {
      throw new HttpException({ conflictos }, HttpStatus.CONFLICT);
    }

    return this.dataSource.transaction(async (manager) => {
      if (conflictos.length > 0) {
        await this.quitarVinculosConflicto(manager, conflictos);
      }

      const row = await manager.findOne(Promocion, { where: { id, tenantId } });
      if (!row) throw new NotFoundException('Promoci├│n no encontrada');
      Object.assign(
        row,
        promocionEntityFromPayload(tenantId, existe.sucursalId, parsed.data, existe.activa),
      );
      await manager.save(Promocion, row);
      await manager.delete(ProductoPromocion, { promocionId: id });
      await this.syncProductLinks(manager, tenantId, id, parsed.data);
      await this.syncComboItems(manager, tenantId, id, parsed.data);
      await this.syncSucursales(manager, tenantId, id, sucursalesAcceso);

      const saved = await manager.findOne(Promocion, { where: { id, tenantId } });
      return { data: this.serializePromocion(saved!) };
    });
  }

  async patchActiva(id: string, activa: boolean) {
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.sucursalContext.requireSucursalId();

    const existe = await this.promocionRepo.findOne({ where: { id, tenantId } });
    if (!existe) throw new NotFoundException('Promoci├│n no encontrada');

    const accessIds = await this.getSucursalAccessIds(tenantId, id);
    if (!promoVisibleEnSucursal(existe.sucursalId, accessIds, sucursalId)) {
      throw new NotFoundException('Promoci├│n no encontrada');
    }

    await this.promocionRepo.update({ id, tenantId }, { activa });
    const saved = await this.promocionRepo.findOne({ where: { id, tenantId } });
    return { data: this.serializePromocion(saved!) };
  }

  async deactivate(id: string) {
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.sucursalContext.requireSucursalId();

    const existe = await this.promocionRepo.findOne({ where: { id, tenantId } });
    if (!existe) throw new NotFoundException('Promoci├│n no encontrada');

    const accessIds = await this.getSucursalAccessIds(tenantId, id);
    if (!promoVisibleEnSucursal(existe.sucursalId, accessIds, sucursalId)) {
      throw new NotFoundException('Promoci├│n no encontrada');
    }

    await this.promocionRepo.update({ id, tenantId }, { activa: false });
    return { data: { ok: true } };
  }

  async buildActiveMap(productoIds: string[], sucursalId?: string) {
    const tenantId = this.tenantContext.getTenantId();
    const branchId = sucursalId ?? (await this.sucursalContext.resolveSucursalId());
    const fecha = hoyEnArgentina();
    const ids = [...new Set(productoIds.filter(Boolean))].slice(0, 400);

    if (ids.length === 0) {
      return { data: { fecha, mapa: {} as Record<string, PromocionMotor> } };
    }

    let promoIdsPorSucursal: string[] | null = null;
    if (branchId) {
      const accessRows = await this.promocionSucursalRepo.find({
        where: { tenantId, sucursalId: branchId },
        select: ['promocionId'],
      });
      promoIdsPorSucursal = [...new Set(accessRows.map((r) => r.promocionId))];
      if (promoIdsPorSucursal.length === 0) {
        return { data: { fecha, mapa: {} } };
      }
    }

    const linksQb = this.productoPromocionRepo
      .createQueryBuilder('pp')
      .innerJoinAndSelect('pp.promocion', 'p')
      .where('pp.tenant_id = :tenantId', { tenantId })
      .andWhere('pp.producto_id IN (:...ids)', { ids });

    if (promoIdsPorSucursal) {
      linksQb.andWhere('pp.promocion_id IN (:...promoIdsPorSucursal)', { promoIdsPorSucursal });
    }

    const links = await linksQb.getMany();
    const promoIds = [...new Set(links.map((l) => l.promocionId))];

    const comboRows =
      promoIds.length > 0
        ? await this.comboItemRepo.find({ where: { promocionId: In(promoIds), tenantId } })
        : [];
    const comboPorPromocion = new Map<string, PromocionComboItem[]>();
    for (const row of comboRows) {
      const arr = comboPorPromocion.get(row.promocionId) ?? [];
      arr.push(row);
      comboPorPromocion.set(row.promocionId, arr);
    }

    const candidatos: {
      productoId: string;
      productoVarianteId: string | null;
      motor: PromocionMotor;
      updated: string;
    }[] = [];

    for (const link of links) {
      const promo = (link as ProductoPromocion & { promocion?: Promocion }).promocion;
      if (!promo) continue;
      const combo = comboPorPromocion.get(promo.id) ?? [];
      const motor = filaPromocionAMotor({
        ...promo,
        promocion_combo_item: combo.map((c) => ({
          producto_id: c.productoId,
          producto_variante_id: c.productoVarianteId,
          cantidad: c.cantidad,
        })),
      });
      if (!promocionVigenteParaYmd(motor, fecha)) continue;
      candidatos.push({
        productoId: link.productoId,
        productoVarianteId: link.productoVarianteId,
        motor,
        updated: promo.updatedAt.toISOString(),
      });
    }

    candidatos.sort((a, b) => (a.updated < b.updated ? 1 : -1));
    const mapa: Record<string, PromocionMotor> = {};
    for (const c of candidatos) {
      const key = c.productoVarianteId
        ? promoVarianteKey(c.productoId, c.productoVarianteId)
        : promoProductoKey(c.productoId);
      if (!mapa[key]) mapa[key] = c.motor;
    }

    return { data: { fecha, mapa } };
  }

  private serializePromocion(p: Promocion) {
    return {
      id: p.id,
      tenantId: p.tenantId,
      sucursalId: p.sucursalId,
      nombre: p.nombre,
      tipo: p.tipo,
      cantidadLleva: p.cantidadLleva,
      cantidadPaga: p.cantidadPaga,
      unidadDescuento: p.unidadDescuento,
      porcentaje: p.porcentaje != null ? Number(p.porcentaje) : null,
      cantidadMinima: p.cantidadMinima,
      rangosVolumen: p.rangosVolumen,
      precioCombo: p.precioCombo != null ? Number(p.precioCombo) : null,
      vigenteDesde: p.vigenteDesde,
      vigenteHasta: p.vigenteHasta,
      diasSemana: p.diasSemana,
      activa: p.activa,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private async getSucursalAccessIds(tenantId: string, promocionId: string) {
    const rows = await this.promocionSucursalRepo.find({
      where: { tenantId, promocionId },
      select: ['sucursalId'],
    });
    return rows.map((r) => r.sucursalId);
  }

  private async resolveSucursalIdsAcceso(
    tenantId: string,
    requested: string[],
    fallbackSucursalId: string,
  ) {
    const ids = [
      ...new Set(
        (requested.length > 0 ? requested : [fallbackSucursalId])
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ];
    if (ids.length === 0) {
      throw new BadRequestException('Seleccion├í al menos una sucursal para la promoci├│n.');
    }

    const rows = await this.sucursalRepo.find({
      where: { tenantId, activa: true, id: In(ids) },
      select: ['id'],
    });
    if (rows.length !== ids.length) {
      throw new BadRequestException('Una o m├ís sucursales no existen o est├ín inactivas.');
    }
    return ids;
  }

  private async buscarConflictosProductos(
    tenantId: string,
    targets: PromocionPayload['producto_targets'],
    excluirPromocionId: string | null,
    sucursalIds: string[],
    fechaYmd: string,
  ): Promise<ConflictoPromoProducto[]> {
    const productoIds = [...new Set(targets.map((t) => t.producto_id).filter(Boolean))];
    if (productoIds.length === 0 || sucursalIds.length === 0) return [];

    const accessRows = await this.promocionSucursalRepo.find({
      where: { tenantId, sucursalId: In(sucursalIds) },
    });
    const sucursalSet = new Set(sucursalIds);
    const accessByPromo = new Map<string, Set<string>>();
    for (const row of accessRows) {
      const set = accessByPromo.get(row.promocionId) ?? new Set<string>();
      set.add(row.sucursalId);
      accessByPromo.set(row.promocionId, set);
    }
    const promoIds = [...accessByPromo.keys()];
    if (promoIds.length === 0) return [];

    const links = await this.productoPromocionRepo.find({
      where: { tenantId, productoId: In(productoIds), promocionId: In(promoIds) },
    });

    const promos = await this.promocionRepo.find({
      where: { tenantId, id: In(promoIds), activa: true },
    });
    const promoMap = new Map(promos.map((p) => [p.id, p]));

    const mapa = new Map<string, ConflictoPromoProducto>();
    for (const link of links) {
      const promo = promoMap.get(link.promocionId);
      if (!promo || promo.id === excluirPromocionId) continue;

      const rowVarianteId = link.productoVarianteId ?? null;
      const afecta = targets.some((target) => {
        if (target.producto_id !== link.productoId) return false;
        const targetVarianteId = target.producto_variante_id ?? null;
        return targetVarianteId == null || rowVarianteId == null || targetVarianteId === rowVarianteId;
      });
      if (!afecta) continue;

      const motor = filaPromocionAMotor(promo);
      if (!promocionVigenteParaYmd(motor, fechaYmd)) continue;

      const branchIds = [...(accessByPromo.get(promo.id) ?? new Set())].filter((sid) =>
        sucursalSet.has(sid),
      );
      const conflictKey = `${link.productoId}:${rowVarianteId ?? 'base'}:${promo.id}`;
      if (!mapa.has(conflictKey)) {
        mapa.set(conflictKey, {
          producto_id: link.productoId,
          producto_variante_id: rowVarianteId,
          sucursal_ids: branchIds,
          promocion_existente: { id: promo.id, nombre: promo.nombre },
        });
      }
    }
    return [...mapa.values()];
  }

  private async quitarVinculosConflicto(
    manager: typeof this.dataSource.manager,
    conflictos: ConflictoPromoProducto[],
  ) {
    for (const c of conflictos) {
      const qb = manager
        .createQueryBuilder()
        .delete()
        .from(ProductoPromocion)
        .where('producto_id = :productoId', { productoId: c.producto_id })
        .andWhere('promocion_id = :promocionId', { promocionId: c.promocion_existente.id });
      if (c.producto_variante_id) {
        qb.andWhere('producto_variante_id = :varianteId', { varianteId: c.producto_variante_id });
      } else {
        qb.andWhere('producto_variante_id IS NULL');
      }
      await qb.execute();
    }
  }

  private async syncProductLinks(
    manager: typeof this.dataSource.manager,
    tenantId: string,
    promocionId: string,
    data: PromocionPayload,
  ) {
    if (data.producto_targets.length === 0) return;
    const rows = data.producto_targets.map((t) =>
      manager.create(ProductoPromocion, {
        tenantId,
        promocionId,
        productoId: t.producto_id,
        productoVarianteId: t.producto_variante_id ?? null,
      }),
    );
    await manager.save(ProductoPromocion, rows);
  }

  private async syncComboItems(
    manager: typeof this.dataSource.manager,
    tenantId: string,
    promocionId: string,
    data: PromocionPayload,
  ) {
    await manager.delete(PromocionComboItem, { promocionId });
    if (data.tipo !== PromocionTipo.combo_precio_fijo || !data.combo_items?.length) return;
    const rows = data.combo_items.map((ci) =>
      manager.create(PromocionComboItem, {
        tenantId,
        promocionId,
        productoId: ci.producto_id,
        productoVarianteId: ci.producto_variante_id ?? null,
        cantidad: ci.cantidad.toFixed(6),
      }),
    );
    await manager.save(PromocionComboItem, rows);
  }

  private async syncSucursales(
    manager: typeof this.dataSource.manager,
    tenantId: string,
    promocionId: string,
    sucursalIds: string[],
  ) {
    await manager.delete(PromocionSucursal, { tenantId, promocionId });
    const ids = [...new Set(sucursalIds)];
    if (ids.length === 0) return;
    const rows = ids.map((sucursalId) =>
      manager.create(PromocionSucursal, { tenantId, promocionId, sucursalId }),
    );
    await manager.save(PromocionSucursal, rows);
  }
}
