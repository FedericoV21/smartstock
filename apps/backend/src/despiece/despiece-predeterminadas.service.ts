import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { PrecioSucursal } from '../branches/entities/precio-sucursal.entity';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { Producto } from '../products/entities/producto.entity';
import { UnidadMedida } from '../products/enums/unidad-medida.enum';
import { DespieceBaseService } from './despiece-base.service';
import { DespieceCorte } from './entities/despiece-corte.entity';
import { DespiecePlantilla } from './entities/despiece-plantilla.entity';
import { IVA_DESPIECE } from './utils/constantes';
import { forzarIvaDespiece } from './utils/despiece-iva.util';
import { PLANTILLAS_DESPIECE_PREDETERMINADAS } from './utils/predeterminadas';

type ProductoSeed = {
  codigo: string;
  nombre: string;
  precioCosto: number;
  precioVenta?: number;
  esPadre?: boolean;
};

@Injectable()
export class DespiecePredeterminadasService {
  constructor(
    @InjectRepository(Producto) private readonly productoRepo: Repository<Producto>,
    @InjectRepository(DespiecePlantilla) private readonly plantillaRepo: Repository<DespiecePlantilla>,
    @InjectRepository(DespieceCorte) private readonly corteRepo: Repository<DespieceCorte>,
    @InjectRepository(PrecioSucursal) private readonly precioRepo: Repository<PrecioSucursal>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Sucursal) private readonly sucursalRepo: Repository<Sucursal>,
    private readonly base: DespieceBaseService,
  ) {}

  private async ensureProducto(
    tenantId: string,
    sucursalId: string,
    producto: ProductoSeed,
  ): Promise<string> {
    const existente = await this.productoRepo.findOne({
      where: { tenantId, codigo: producto.codigo, activo: true },
    });
    if (existente) {
      if (producto.esPadre) {
        await this.productoRepo.update(
          { id: existente.id, tenantId },
          { esDespiecePadre: true },
        );
      }
      return existente.id;
    }

    const existentePorNombre = await this.productoRepo
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('LOWER(p.nombre) = LOWER(:nombre)', { nombre: producto.nombre.trim() })
      .andWhere('p.activo = true')
      .getOne();

    if (existentePorNombre) {
      if (producto.esPadre) {
        await this.productoRepo.update(
          { id: existentePorNombre.id, tenantId },
          { esDespiecePadre: true },
        );
      }
      return existentePorNombre.id;
    }

    const created = await this.productoRepo.save(
      this.productoRepo.create({
        tenantId,
        sucursalId,
        codigo: producto.codigo,
        nombre: producto.nombre,
        descripcion: 'Creado por plantilla predeterminada de despiece',
        unidad: UnidadMedida.kg,
        precioCosto: producto.precioCosto.toFixed(2),
        precioVenta: (producto.precioVenta ?? producto.precioCosto).toFixed(2),
        stockActual: '0',
        stockMinimo: '0',
        esPesable: true,
        esDespiecePadre: producto.esPadre === true,
        ivaPorcentaje: IVA_DESPIECE.toFixed(2),
        activo: true,
      }),
    );
    return created.id;
  }

  async cargar(body: unknown, user: AccessTokenPayload) {
    await this.base.assertModuloDespiece();
    await this.base.assertPermisoEditar(user);

    const sucursalId = await this.base.resolveSucursalId(null);
    const tenantId = this.base.getTenantId();

    const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    const slug = typeof b.slug === 'string' ? b.slug : 'todas';
    const slugNormalizado = slug === 'pollo-reyes' ? 'cajon-pollo-7' : slug;
    const plantillas =
      slugNormalizado === 'todas'
        ? PLANTILLAS_DESPIECE_PREDETERMINADAS
        : PLANTILLAS_DESPIECE_PREDETERMINADAS.filter((p) => p.slug === slugNormalizado);

    if (plantillas.length === 0) {
      throw new NotFoundException('Plantilla predeterminada no encontrada.');
    }

    const creadas: Array<{ id: string; nombre: string; existente: boolean }> = [];

    for (const pred of plantillas) {
      const padreId = await this.ensureProducto(tenantId, sucursalId, {
        codigo: pred.padre.codigo,
        nombre: pred.padre.nombre,
        precioCosto: pred.padre.costoKg,
        precioVenta: pred.padre.costoKg,
        esPadre: true,
      });

      const corteIds: string[] = [];
      for (const corte of pred.cortes) {
        const id = await this.ensureProducto(tenantId, sucursalId, {
          codigo: corte.codigo,
          nombre: corte.nombre,
          precioCosto: pred.padre.costoKg,
          precioVenta: corte.precioAnclado ?? pred.padre.costoKg,
        });
        corteIds.push(id);
      }

      const existente = await this.plantillaRepo.findOne({
        where: { tenantId, productoPadreId: padreId, nombre: pred.nombre },
      });

      if (existente) {
        await forzarIvaDespiece(
          this.productoRepo,
          this.precioRepo,
          this.tenantRepo,
          this.sucursalRepo,
          tenantId,
          [padreId, ...corteIds],
        );
        creadas.push({ id: existente.id, nombre: pred.nombre, existente: true });
        continue;
      }

      const plantilla = await this.plantillaRepo.save(
        this.plantillaRepo.create({
          tenantId,
          nombre: pred.nombre,
          productoPadreId: padreId,
          pesoTotalKg: pred.padre.pesoTotalKg.toFixed(3),
          unidadBaseTipo: pred.unidadBase?.tipo ?? 'kg',
          unidadBaseNombre: pred.unidadBase?.nombre ?? null,
          unidadBaseCantidad: String(pred.unidadBase?.cantidad ?? 1),
          unidadContenedorNombre: pred.unidadBase?.contenedorNombre ?? null,
          unidadContenedorCantidad:
            pred.unidadBase?.unidadesPorContenedor != null
              ? String(pred.unidadBase.unidadesPorContenedor)
              : null,
          rentabilidadObjetivoPct: pred.rentabilidadObjetivoPct.toFixed(2),
          activo: true,
          notas: 'Plantilla predeterminada creada desde Carnicerias.xlsx',
        }),
      );

      await this.corteRepo.save(
        pred.cortes.map((corte, index) =>
          this.corteRepo.create({
            tenantId,
            plantillaId: plantilla.id,
            productoHijoId: corteIds[index],
            kgRendimiento: corte.kgRendimiento.toFixed(3),
            factorAjustePct: String(corte.factorAjustePct),
            precioAnclado: corte.precioAnclado == null ? null : corte.precioAnclado.toFixed(2),
            nombreEnPlantilla: corte.nombre,
            pluSugerido: null,
            orden: index,
          }),
        ),
      );

      await forzarIvaDespiece(
        this.productoRepo,
        this.precioRepo,
        this.tenantRepo,
        this.sucursalRepo,
        tenantId,
        [padreId, ...corteIds],
      );

      creadas.push({ id: plantilla.id, nombre: pred.nombre, existente: false });
    }

    return { plantillas: creadas };
  }
}
