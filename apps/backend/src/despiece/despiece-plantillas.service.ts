import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { PrecioSucursal } from '../branches/entities/precio-sucursal.entity';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { OrigenPrecio } from '../pricing/enums/origen-precio.enum';
import { PrecioHistorial } from '../pricing/entities/precio-historial.entity';
import { Producto } from '../products/entities/producto.entity';
import { DespieceBaseService } from './despiece-base.service';
import { DespieceCorte } from './entities/despiece-corte.entity';
import { DespiecePlantilla } from './entities/despiece-plantilla.entity';
import {
  calcularDesdePlantilla,
  costoCatalogoDesdePrecioVentaDespiece,
  parsePlantillaPayload,
  prepararCambiosCatalogoDespiece,
  type DespieceCortePayload,
  type DespiecePlantillaPayload,
  type PlantillaConRelaciones,
  validarConflictosPluCatalogo,
  validarPlantillaPayload,
  validarProductosCorteElegibles,
} from './utils/despiece-api.util';
import { upsertPrecioSucursalDespiece } from './utils/despiece-catalogo.util';
import { IVA_DESPIECE } from './utils/constantes';
import { forzarIvaDespiece } from './utils/despiece-iva.util';
import { serializePlantilla } from './utils/despiece-serialize.util';
import type { DespieceEstrategia } from './utils/tipos';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function plantillaValuesFromPayload(tenantId: string, payload: DespiecePlantillaPayload) {
  return {
    tenantId,
    nombre: payload.nombre,
    productoPadreId: payload.producto_padre_id,
    pesoTotalKg: payload.peso_total_kg.toFixed(3),
    unidadBaseTipo: payload.unidad_base_tipo,
    unidadBaseNombre: payload.unidad_base_tipo === 'unidad' ? payload.unidad_base_nombre : null,
    unidadBaseCantidad:
      payload.unidad_base_tipo === 'unidad' ? payload.unidad_base_cantidad.toFixed(3) : '1',
    unidadContenedorNombre:
      payload.unidad_base_tipo === 'unidad' ? payload.unidad_contenedor_nombre : null,
    unidadContenedorCantidad:
      payload.unidad_base_tipo === 'unidad' && payload.unidad_contenedor_cantidad != null
        ? payload.unidad_contenedor_cantidad.toFixed(3)
        : null,
    rentabilidadObjetivoPct:
      payload.rentabilidad_objetivo_pct == null
        ? null
        : payload.rentabilidad_objetivo_pct.toFixed(2),
    activo: payload.activo ?? true,
    notas: payload.notas ?? null,
  };
}

@Injectable()
export class DespiecePlantillasService {
  constructor(
    @InjectRepository(DespiecePlantilla)
    private readonly plantillaRepo: Repository<DespiecePlantilla>,
    @InjectRepository(DespieceCorte) private readonly corteRepo: Repository<DespieceCorte>,
    @InjectRepository(Producto) private readonly productoRepo: Repository<Producto>,
    @InjectRepository(PrecioSucursal) private readonly precioRepo: Repository<PrecioSucursal>,
    @InjectRepository(PrecioHistorial) private readonly historialRepo: Repository<PrecioHistorial>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Sucursal) private readonly sucursalRepo: Repository<Sucursal>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly base: DespieceBaseService,
  ) {}

  private async validarProductosCorte(cortes: DespieceCortePayload[]): Promise<void> {
    const ids = [...new Set(cortes.map((c) => c.producto_hijo_id).filter(Boolean))];
    if (ids.length === 0) return;

    const productos = await this.productoRepo.find({
      where: { tenantId: this.base.getTenantId(), id: In(ids) },
      select: ['id', 'nombre', 'activo', 'esPesable', 'unidad'],
    });

    const msg = validarProductosCorteElegibles(
      cortes,
      productos.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        activo: p.activo,
        es_pesable: p.esPesable,
        unidad: p.unidad,
      })),
    );
    if (msg) throw new BadRequestException(msg);
  }

  private async loadPlantillaCompleta(id: string): Promise<{
    plantilla: DespiecePlantilla;
    padre: Producto | null;
    cortes: Array<{ corte: DespieceCorte; productoHijo: Producto | null }>;
  } | null> {
    const tenantId = this.base.getTenantId();
    const plantilla = await this.plantillaRepo.findOne({ where: { id, tenantId } });
    if (!plantilla) return null;

    const cortes = await this.corteRepo.find({
      where: { plantillaId: id, tenantId },
      order: { orden: 'ASC' },
    });
    const hijoIds = cortes.map((c) => c.productoHijoId);
    const padre = plantilla.productoPadreId
      ? await this.productoRepo.findOne({ where: { id: plantilla.productoPadreId, tenantId } })
      : null;
    const hijos =
      hijoIds.length > 0
        ? await this.productoRepo.find({ where: { tenantId, id: In(hijoIds) } })
        : [];
    const hijosMap = new Map(hijos.map((h) => [h.id, h]));

    return {
      plantilla,
      padre: padre ?? null,
      cortes: cortes.map((corte) => ({
        corte,
        productoHijo: hijosMap.get(corte.productoHijoId) ?? null,
      })),
    };
  }

  private toPlantillaConRelaciones(
    loaded: NonNullable<Awaited<ReturnType<typeof this.loadPlantillaCompleta>>>,
  ): PlantillaConRelaciones {
    const { plantilla, padre, cortes } = loaded;
    const serialized = serializePlantilla(plantilla, padre, cortes);
    return serialized as unknown as PlantillaConRelaciones;
  }

  async list(query: { activo?: string; q?: string }, user: AccessTokenPayload) {
    await this.base.assertModuloDespiece();
    await this.base.assertPermisoVer(user);

    const tenantId = this.base.getTenantId();
    const qb = this.plantillaRepo
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .orderBy('p.updated_at', 'DESC');

    if (query.activo === 'true') qb.andWhere('p.activo = true');
    if (query.activo === 'false') qb.andWhere('p.activo = false');
    if (query.q?.trim()) qb.andWhere('p.nombre ILIKE :q', { q: `%${query.q.trim()}%` });

    const plantillas = await qb.getMany();
    const result = [];
    for (const p of plantillas) {
      const loaded = await this.loadPlantillaCompleta(p.id);
      if (loaded) result.push(serializePlantilla(loaded.plantilla, loaded.padre, loaded.cortes));
    }
    return { plantillas: result };
  }

  async create(body: unknown, user: AccessTokenPayload) {
    await this.base.assertModuloDespiece();
    await this.base.assertPermisoEditar(user);

    const payload = parsePlantillaPayload(body);
    const validation = validarPlantillaPayload(payload);
    if (validation) throw new BadRequestException(validation);

    const cortes = payload.cortes ?? [];
    await this.validarProductosCorte(cortes);

    const tenantId = this.base.getTenantId();
    if (payload.producto_padre_id) {
      const padre = await this.productoRepo.findOne({
        where: { id: payload.producto_padre_id, tenantId },
      });
      if (!padre) throw new NotFoundException('Producto padre no encontrado.');
    }

    const plantilla = this.plantillaRepo.create(plantillaValuesFromPayload(tenantId, payload));
    let saved: DespiecePlantilla;
    try {
      saved = await this.plantillaRepo.save(plantilla);
    } catch {
      throw new BadRequestException('No se pudo crear la plantilla.');
    }

    if (cortes.length > 0) {
      try {
        await this.corteRepo.save(
          cortes.map((corte, index) =>
            this.corteRepo.create({
              tenantId,
              plantillaId: saved.id,
              productoHijoId: corte.producto_hijo_id,
              kgRendimiento: corte.kg_rendimiento.toFixed(3),
              factorAjustePct: String(corte.factor_ajuste_pct ?? 0),
              precioAnclado:
                corte.precio_anclado == null ? null : corte.precio_anclado.toFixed(2),
              nombreEnPlantilla: corte.nombre_en_plantilla ?? null,
              pluSugerido: corte.plu_sugerido ?? null,
              pesoPromedioUnidadKg:
                corte.peso_promedio_unidad_kg == null
                  ? null
                  : corte.peso_promedio_unidad_kg.toFixed(3),
              orden: corte.orden ?? index,
            }),
          ),
        );
      } catch {
        await this.plantillaRepo.delete({ id: saved.id, tenantId });
        throw new BadRequestException('No se pudieron guardar los cortes.');
      }
    }

    if (payload.producto_padre_id) {
      await this.productoRepo.update(
        { id: payload.producto_padre_id, tenantId },
        { esDespiecePadre: true },
      );
    }

    await forzarIvaDespiece(
      this.productoRepo,
      this.precioRepo,
      this.tenantRepo,
      this.sucursalRepo,
      tenantId,
      [payload.producto_padre_id, ...cortes.map((c) => c.producto_hijo_id)],
    );

    const loaded = await this.loadPlantillaCompleta(saved.id);
    return { plantilla: loaded ? serializePlantilla(loaded.plantilla, loaded.padre, loaded.cortes) : saved };
  }

  async getById(id: string, user: AccessTokenPayload) {
    await this.base.assertModuloDespiece();
    await this.base.assertPermisoVer(user);

    const loaded = await this.loadPlantillaCompleta(id);
    if (!loaded) throw new NotFoundException('Plantilla no encontrada.');
    return { plantilla: serializePlantilla(loaded.plantilla, loaded.padre, loaded.cortes) };
  }

  async update(id: string, body: unknown, user: AccessTokenPayload) {
    await this.base.assertModuloDespiece();
    await this.base.assertPermisoEditar(user);

    const payload = parsePlantillaPayload(body);
    const validation = validarPlantillaPayload(payload);
    if (validation) throw new BadRequestException(validation);

    const cortes = payload.cortes ?? [];
    await this.validarProductosCorte(cortes);

    const tenantId = this.base.getTenantId();
    const actual = await this.plantillaRepo.findOne({ where: { id, tenantId } });
    if (!actual) throw new NotFoundException('Plantilla no encontrada.');

    if (payload.producto_padre_id) {
      const padre = await this.productoRepo.findOne({
        where: { id: payload.producto_padre_id, tenantId },
      });
      if (!padre) throw new NotFoundException('Producto padre no encontrado.');
    }

    Object.assign(actual, plantillaValuesFromPayload(tenantId, payload));
    try {
      await this.plantillaRepo.save(actual);
    } catch {
      throw new BadRequestException('No se pudo actualizar la plantilla.');
    }

    await this.corteRepo.delete({ plantillaId: id, tenantId });
    if (cortes.length > 0) {
      await this.corteRepo.save(
        cortes.map((corte, index) =>
          this.corteRepo.create({
            tenantId,
            plantillaId: id,
            productoHijoId: corte.producto_hijo_id,
            kgRendimiento: corte.kg_rendimiento.toFixed(3),
            factorAjustePct: String(corte.factor_ajuste_pct ?? 0),
            precioAnclado: corte.precio_anclado == null ? null : corte.precio_anclado.toFixed(2),
            nombreEnPlantilla: corte.nombre_en_plantilla ?? null,
            pluSugerido: corte.plu_sugerido ?? null,
            pesoPromedioUnidadKg:
              corte.peso_promedio_unidad_kg == null
                ? null
                : corte.peso_promedio_unidad_kg.toFixed(3),
            orden: corte.orden ?? index,
          }),
        ),
      );
    }

    if (payload.producto_padre_id) {
      await this.productoRepo.update(
        { id: payload.producto_padre_id, tenantId },
        { esDespiecePadre: true },
      );
    }

    await forzarIvaDespiece(
      this.productoRepo,
      this.precioRepo,
      this.tenantRepo,
      this.sucursalRepo,
      tenantId,
      [payload.producto_padre_id, ...cortes.map((c) => c.producto_hijo_id)],
    );

    const viejoPadre = actual.productoPadreId;
    const nuevoPadre = payload.producto_padre_id;
    if (viejoPadre && viejoPadre !== nuevoPadre) {
      const count = await this.plantillaRepo.count({
        where: { tenantId, productoPadreId: viejoPadre },
      });
      if (count === 0) {
        await this.productoRepo.update(
          { id: viejoPadre, tenantId },
          { esDespiecePadre: false },
        );
      }
    }

    const loaded = await this.loadPlantillaCompleta(id);
    return { plantilla: loaded ? serializePlantilla(loaded.plantilla, loaded.padre, loaded.cortes) : actual };
  }

  async softDelete(id: string, user: AccessTokenPayload) {
    await this.base.assertModuloDespiece();
    await this.base.assertPermisoEditar(user);

    const tenantId = this.base.getTenantId();
    const actual = await this.plantillaRepo.findOne({ where: { id, tenantId } });
    if (!actual) throw new NotFoundException('Plantilla no encontrada.');

    actual.activo = false;
    await this.plantillaRepo.save(actual);

    if (actual.productoPadreId) {
      const count = await this.plantillaRepo.count({
        where: { tenantId, productoPadreId: actual.productoPadreId, activo: true },
      });
      if (count === 0) {
        await this.productoRepo.update(
          { id: actual.productoPadreId, tenantId },
          { esDespiecePadre: false },
        );
      }
    }

    return { success: true };
  }

  async aplicar(id: string, body: unknown, user: AccessTokenPayload) {
    await this.base.assertModuloDespiece();
    await this.base.assertPermisoAplicarPrecios(user);

    const sucursalId = await this.base.resolveSucursalId(
      typeof (body as Record<string, unknown>)?.sucursal_id === 'string'
        ? String((body as Record<string, unknown>).sucursal_id)
        : null,
    );

    const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    const estrategia = String(b.estrategia ?? 'fija') as DespieceEstrategia;
    if (!['variable', 'fija', 'anclada'].includes(estrategia)) {
      throw new BadRequestException('Estrategia inválida.');
    }

    const costoKgBody = Number(b.costo_kg);
    const usarCostoBody = Number.isFinite(costoKgBody) && costoKgBody > 0;
    const soloCortes = Array.isArray(b.solo_cortes)
      ? new Set(b.solo_cortes.map((x) => String(x)))
      : null;

    const loaded = await this.loadPlantillaCompleta(id);
    if (!loaded) throw new NotFoundException('Plantilla no encontrada.');

    const plantilla = this.toPlantillaConRelaciones(loaded);
    const costoDesdePadre = Number(plantilla.producto_padre?.precio_costo ?? 0);
    const costoKgCalculo = usarCostoBody ? costoKgBody : costoDesdePadre;
    const rentabilidadCatalogoPct = Number(plantilla.rentabilidad_objetivo_pct ?? 0);

    if (!(costoKgCalculo > 0)) {
      throw new BadRequestException(
        'Hace falta un costo por kg mayor a 0 (producto padre en catálogo o campo costo_kg al aplicar).',
      );
    }

    let resultado;
    try {
      resultado = calcularDesdePlantilla(plantilla, costoKgCalculo);
    } catch (calcError) {
      throw new BadRequestException(
        calcError instanceof Error ? calcError.message : 'No se pudo calcular la plantilla.',
      );
    }

    const cortesResultado = resultado.cortes.filter(
      (corte) => !soloCortes || soloCortes.has(String(corte.id)),
    );
    const productIds = cortesResultado.map((corte) => String(corte.id));
    if (productIds.length === 0) return { diff: [], resultado };

    const tenantId = this.base.getTenantId();
    const productos = await this.productoRepo.find({
      where: { tenantId, id: In(productIds) },
    });
    const productosPorId = new Map(productos.map((p) => [p.id, p]));

    const diff = cortesResultado
      .map((corte) => {
        const producto = productosPorId.get(String(corte.id));
        if (!producto) return null;
        const precioNuevoRaw =
          estrategia === 'variable'
            ? corte.variable.precioKg
            : estrategia === 'fija'
              ? corte.fija.precioKg
              : corte.anclada.precioKg;
        if (precioNuevoRaw == null) return null;
        const precioNuevo = round2(precioNuevoRaw);
        return {
          producto_id: producto.id,
          nombre: producto.nombre,
          precio_costo: Number(producto.precioCosto),
          precio_costo_nuevo: costoCatalogoDesdePrecioVentaDespiece(
            precioNuevo,
            rentabilidadCatalogoPct,
          ),
          precio_anterior: Number(producto.precioVenta),
          precio_nuevo: precioNuevo,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter(
        (row) =>
          row.precio_anterior !== row.precio_nuevo ||
          row.precio_costo !== row.precio_costo_nuevo,
      );

    for (const row of diff) {
      const margenAnterior =
        row.precio_costo > 0
          ? ((row.precio_anterior - row.precio_costo) / row.precio_costo) * 100
          : 0;
      const margenNuevo =
        row.precio_costo_nuevo > 0
          ? ((row.precio_nuevo - row.precio_costo_nuevo) / row.precio_costo_nuevo) * 100
          : 0;

      await this.productoRepo.update(
        { id: row.producto_id, tenantId },
        {
          precioCosto: row.precio_costo_nuevo.toFixed(2),
          precioVenta: row.precio_nuevo.toFixed(2),
          ivaPorcentaje: IVA_DESPIECE.toFixed(2),
        },
      );

      await upsertPrecioSucursalDespiece(this.precioRepo, {
        tenantId,
        productoId: row.producto_id,
        sucursalId,
        precioCosto: row.precio_costo_nuevo,
        precioVenta: row.precio_nuevo,
      });

      await this.historialRepo.save(
        this.historialRepo.create({
          tenantId,
          productoId: row.producto_id,
          precioCostoAnterior: row.precio_costo.toFixed(6),
          precioCostoNuevo: row.precio_costo_nuevo.toFixed(6),
          precioVentaAnterior: row.precio_anterior.toFixed(6),
          precioVentaNuevo: row.precio_nuevo.toFixed(6),
          margenAnterior: margenAnterior.toFixed(6),
          margenNuevo: margenNuevo.toFixed(6),
          origen: OrigenPrecio.despiece,
          createdAt: new Date(),
        }),
      );
    }

    return { diff, resultado };
  }

  async sincronizarCatalogo(id: string, body: unknown, user: AccessTokenPayload) {
    await this.base.assertModuloDespiece();
    await this.base.assertPermisoAplicarPrecios(user);

    const sucursalId = await this.base.resolveSucursalId(
      typeof (body as Record<string, unknown>)?.sucursal_id === 'string'
        ? String((body as Record<string, unknown>).sucursal_id)
        : null,
    );

    const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    const raw = Array.isArray(b.cambios) ? b.cambios : [];
    const solicitudes = raw
      .map((item) => {
        const row = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
        return {
          producto_id: typeof row.producto_id === 'string' ? row.producto_id.trim() : '',
          aplicar_nombre: row.aplicar_nombre === true,
          aplicar_precio: row.aplicar_precio === true,
          aplicar_plu: row.aplicar_plu === true,
          precio_nuevo:
            row.precio_nuevo == null || row.precio_nuevo === '' ? null : Number(row.precio_nuevo),
        };
      })
      .filter((row) => row.producto_id);

    if (solicitudes.length === 0) {
      throw new BadRequestException('Selecciona al menos un cambio para aplicar.');
    }

    const loaded = await this.loadPlantillaCompleta(id);
    if (!loaded) throw new NotFoundException('Plantilla no encontrada.');

    const plantillaSync = this.toPlantillaConRelaciones(loaded);
    const preparado = prepararCambiosCatalogoDespiece(
      (plantillaSync.cortes ?? []).map((c) => ({
        producto_hijo_id: c.producto_hijo_id,
        nombre_en_plantilla: c.nombre_en_plantilla,
        precio_anclado: c.precio_anclado,
        plu_sugerido: c.plu_sugerido,
        producto_hijo: c.producto_hijo
          ? {
              ...c.producto_hijo,
              plu: c.producto_hijo.plu ?? null,
              activo: c.producto_hijo.activo ?? true,
              es_pesable: c.producto_hijo.es_pesable ?? true,
              unidad: c.producto_hijo.unidad ?? 'kg',
            }
          : null,
      })),
      solicitudes,
      Number(plantillaSync.rentabilidad_objetivo_pct ?? 0),
    );
    if (preparado.error) throw new BadRequestException(preparado.error);
    if (preparado.cambios.length === 0) return { cambios: [] };

    const tenantId = this.base.getTenantId();
    const plusDestino = [
      ...new Set(preparado.cambios.map((c) => c.plu_nuevo).filter((plu): plu is string => Boolean(plu))),
    ];
    if (plusDestino.length > 0) {
      const productosConPlu = await this.productoRepo.find({
        where: { tenantId, activo: true, plu: In(plusDestino) },
        select: ['id', 'nombre', 'plu'],
      });
      const conflicto = validarConflictosPluCatalogo(preparado.cambios, productosConPlu);
      if (conflicto) throw new ConflictException(conflicto);
    }

    const cambiosAplicados: typeof preparado.cambios = [];
    for (const cambio of preparado.cambios) {
      const update: Partial<Producto> = {};
      if (cambio.nombre_nuevo !== undefined) update.nombre = cambio.nombre_nuevo;
      if (cambio.precio_nuevo !== undefined) {
        update.precioCosto = (cambio.precio_costo_nuevo ?? cambio.precio_costo).toFixed(2);
        update.precioVenta = cambio.precio_nuevo.toFixed(2);
        update.ivaPorcentaje = IVA_DESPIECE.toFixed(2);
      }
      if (cambio.plu_nuevo !== undefined) {
        update.plu = cambio.plu_nuevo;
        update.codigoBarras = null;
        update.esPesable = true;
      }

      await this.productoRepo.update(
        { id: cambio.producto_id, tenantId, activo: true },
        update,
      );

      if (cambio.precio_nuevo !== undefined) {
        await upsertPrecioSucursalDespiece(this.precioRepo, {
          tenantId,
          productoId: cambio.producto_id,
          sucursalId,
          precioCosto: cambio.precio_costo_nuevo ?? cambio.precio_costo,
          precioVenta: cambio.precio_nuevo,
        });

        const margenAnterior =
          cambio.precio_costo > 0
            ? ((cambio.precio_anterior - cambio.precio_costo) / cambio.precio_costo) * 100
            : 0;
        const margenNuevo =
          (cambio.precio_costo_nuevo ?? cambio.precio_costo) > 0
            ? ((cambio.precio_nuevo - (cambio.precio_costo_nuevo ?? cambio.precio_costo)) /
                (cambio.precio_costo_nuevo ?? cambio.precio_costo)) *
              100
            : 0;

        await this.historialRepo.save(
          this.historialRepo.create({
            tenantId,
            productoId: cambio.producto_id,
            precioCostoAnterior: cambio.precio_costo.toFixed(6),
            precioCostoNuevo: (cambio.precio_costo_nuevo ?? cambio.precio_costo).toFixed(6),
            precioVentaAnterior: cambio.precio_anterior.toFixed(6),
            precioVentaNuevo: cambio.precio_nuevo.toFixed(6),
            margenAnterior: round2(margenAnterior).toFixed(6),
            margenNuevo: round2(margenNuevo).toFixed(6),
            origen: OrigenPrecio.despiece,
            createdAt: new Date(),
          }),
        );
      }

      cambiosAplicados.push(cambio);
    }

    return { cambios: cambiosAplicados };
  }
}
