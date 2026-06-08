import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { TenantContext } from '../auth/tenant-context.service';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Producto } from '../products/entities/producto.entity';
import { UnidadMedida } from '../products/enums/unidad-medida.enum';
import { UsersService } from '../users/users.service';
import { ImportPreflightDto } from './dto/import-preflight.dto';
import { effectiveBusinessPrefs } from './utils/effective-business-prefs.util';
import {
  chunkStrings,
  claveProductoMatchCodigoUnidad,
  esMatchEstrictoCodigoBarcode,
  normalizarBarcodeMatch,
} from './utils/import-match.util';
import { resolverUnidadStockImportacion } from './utils/resolver-unidad-stock-importacion.util';

const CODIGOS_PREFLIGHT_CHUNK = 400;
const PROVEEDOR_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ProductoMini = {
  id: string;
  codigo: string;
  nombre: string;
  unidad: UnidadMedida;
  codigo_barras: string | null;
  proveedor_id: string | null;
  sucursal_id: string;
  sucursal_nombre: string | null;
  activo: boolean;
  updated_at: string;
  stock_actual: number;
  precio_costo: number;
  precio_venta: number;
  unidad_compra: UnidadMedida | null;
  contenido_unidad_compra: number | null;
};

@Injectable()
export class ImportPreflightService {
  constructor(
    @InjectRepository(Producto) private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Sucursal) private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(ModuloConfig) private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
    private readonly usersService: UsersService,
  ) {}

  async preflight(dto: ImportPreflightDto, user: AccessTokenPayload) {
    await this.assertImportadorExcel();

    const tenantId = this.tenantContext.getTenantId();
    const filas = dto.filas ?? [];

    const proveedorIdRaw =
      typeof dto.proveedor_id === 'string' && dto.proveedor_id.trim()
        ? dto.proveedor_id.trim()
        : null;
    if (proveedorIdRaw && !PROVEEDOR_UUID_RE.test(proveedorIdRaw)) {
      throw new BadRequestException('El proveedor seleccionado no es válido. Volvé a elegirlo.');
    }
    const proveedorId = proveedorIdRaw;

    const forzarProductosPesables = dto.forzar_productos_pesables === true;
    const optsUnidadImportacion = {
      forzarProductosPesables,
      aplicarInferenciaPesablePorNombre:
        dto.aplicar_inferencia_pesable_por_nombre === true && !forzarProductosPesables,
    };

    const sucursalId = await this.resolveSucursalOperativa(dto.sucursal_id ?? null, user, tenantId);
    if (!sucursalId) {
      throw new BadRequestException('No hay sucursal operativa seleccionada.');
    }

    if (filas.length === 0) {
      throw new BadRequestException('No hay filas para analizar');
    }

    const codigos = [
      ...new Set(
        filas
          .map((f) => (typeof f.codigo === 'string' ? f.codigo.trim() : null))
          .filter((c): c is string => Boolean(c)),
      ),
    ];

    if (codigos.length === 0) {
      return { matches: {} as Record<string, ProductoMini[]>, requiere_resolucion: {} };
    }

    const [tenant, sucursal] = await Promise.all([
      this.tenantRepo.findOne({ where: { id: tenantId }, select: { businessPrefs: true } }),
      this.sucursalRepo.findOne({
        where: { id: sucursalId, tenantId },
        select: { businessPrefs: true },
      }),
    ]);
    const businessPrefs = effectiveBusinessPrefs(
      tenant?.businessPrefs ?? null,
      sucursal?.businessPrefs ?? null,
    );
    const unificar = businessPrefs.unificarProductosEntreProveedores === true;

    const productosRaw: Producto[] = [];
    for (const slice of chunkStrings(codigos, CODIGOS_PREFLIGHT_CHUNK)) {
      const qb = this.productoRepo
        .createQueryBuilder('p')
        .where('p.tenant_id = :tenantId', { tenantId })
        .andWhere('p.codigo IN (:...codigos)', { codigos: slice });

      if (!unificar) {
        if (proveedorId) {
          qb.andWhere('p.proveedor_id = :proveedorId', { proveedorId });
        } else {
          qb.andWhere('p.proveedor_id IS NULL');
        }
      }

      try {
        const parte = await qb
          .select([
            'p.id',
            'p.codigo',
            'p.nombre',
            'p.unidad',
            'p.codigoBarras',
            'p.proveedorId',
            'p.sucursalId',
            'p.activo',
            'p.updatedAt',
            'p.stockActual',
            'p.precioCosto',
            'p.precioVenta',
          ])
          .getMany();
        productosRaw.push(...parte);
      } catch {
        throw new InternalServerErrorException(
          'No pudimos consultar los productos para el preanálisis. Reintentá en unos minutos.',
        );
      }
    }

    const sucursales = await this.sucursalRepo.find({
      where: { tenantId },
      select: { id: true, nombre: true },
    });
    const sucursalNombre = new Map(sucursales.map((s) => [s.id, s.nombre]));

    const productos: ProductoMini[] = productosRaw.map((p) => ({
      id: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      unidad: p.unidad,
      unidad_compra: null,
      contenido_unidad_compra: null,
      codigo_barras: p.codigoBarras,
      proveedor_id: p.proveedorId,
      sucursal_id: p.sucursalId ?? '',
      sucursal_nombre: p.sucursalId ? (sucursalNombre.get(p.sucursalId) ?? null) : null,
      activo: p.activo,
      updated_at: p.updatedAt.toISOString(),
      stock_actual: Number(p.stockActual),
      precio_costo: Number(p.precioCosto),
      precio_venta: Number(p.precioVenta),
    }));

    const porClave = new Map<string, ProductoMini[]>();
    const porCodigo = new Map<string, ProductoMini[]>();
    for (const p of productos) {
      const codKey = (p.codigo ?? '').trim().toLowerCase();
      if (codKey) {
        const arrCod = porCodigo.get(codKey) ?? [];
        arrCod.push(p);
        porCodigo.set(codKey, arrCod);
      }

      const enContexto = !unificar
        ? true
        : proveedorId
          ? p.proveedor_id === proveedorId
          : p.proveedor_id == null;
      if (enContexto) {
        const k = claveProductoMatchCodigoUnidad(p.codigo ?? '', p.unidad);
        const arr = porClave.get(k) ?? [];
        arr.push(p);
        porClave.set(k, arr);
      }
    }

    const requiereResolucion: Record<
      string,
      { motivo: 'unidad_distinta'; unidad_fila: UnidadMedida }
    > = {};
    const out: Record<string, ProductoMini[]> = {};

    for (const f of filas) {
      const codigo = typeof f.codigo === 'string' ? f.codigo.trim() : '';
      const nombre = typeof f.nombre === 'string' ? f.nombre : '';
      if (!codigo) continue;

      const unidadFila = resolverUnidadStockImportacion(
        { nombre, unidad: f.unidad ?? undefined },
        UnidadMedida.unidad,
        optsUnidadImportacion,
      );
      const k = claveProductoMatchCodigoUnidad(codigo, unidadFila);
      let candidatos = porClave.get(k) ?? [];
      const key = String(f.fila_original);

      if (unificar) {
        candidatos = candidatos.filter((p) => p.activo);
      }

      if (
        candidatos.length === 0 &&
        unificar &&
        normalizarBarcodeMatch(f.codigo_barras ?? null) != null
      ) {
        const codKey = codigo.trim().toLowerCase();
        const cross = (porCodigo.get(codKey) ?? []).filter(
          (p) =>
            p.activo &&
            esMatchEstrictoCodigoBarcode(
              { codigo, codigo_barras: f.codigo_barras ?? null },
              { codigo: p.codigo, codigo_barras: p.codigo_barras },
            ),
        );
        if (cross.length > 0) {
          candidatos = cross;
        }
      }

      if (candidatos.length === 0) {
        const codKey = codigo.trim().toLowerCase();
        const mismoCodigo = (porCodigo.get(codKey) ?? [])
          .filter((p) => p.activo && p.unidad !== unidadFila)
          .sort((a, b) => (a.updated_at >= b.updated_at ? -1 : 1));
        if (mismoCodigo.length > 0) {
          candidatos = mismoCodigo;
          requiereResolucion[key] = { motivo: 'unidad_distinta', unidad_fila: unidadFila };
        }
      }
      if (candidatos.length > 0 && candidatos.every((p) => p.unidad !== unidadFila)) {
        requiereResolucion[key] = { motivo: 'unidad_distinta', unidad_fila: unidadFila };
      }

      out[key] = candidatos;
    }

    return { matches: out, requiere_resolucion: requiereResolucion };
  }

  private async resolveSucursalOperativa(
    sucursalIdParam: string | null,
    user: AccessTokenPayload,
    tenantId: string,
  ): Promise<string | null> {
    const appRole = resolveAppRole(user);
    let sucursalId = sucursalIdParam?.trim() || null;

    if (!sucursalId) {
      const operables = await this.usersService.listOperableSucursalIds(
        user.sub,
        tenantId,
        appRole,
      );
      sucursalId = operables[0] ?? null;
    }

    if (!sucursalId) return null;

    await this.usersService.assertCanOperateSucursal(user.sub, tenantId, sucursalId, appRole);
    return sucursalId;
  }

  private async assertImportadorExcel(): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const modulos = await this.moduloRepo.findOne({ where: { tenantId } });
    if (!modulos?.importadorExcel) {
      throw new ForbiddenException('Módulo importador_excel no habilitado');
    }
  }
}
