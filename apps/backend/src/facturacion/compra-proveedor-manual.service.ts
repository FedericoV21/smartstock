import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { ReferenciaTipo } from '../inventory/enums/referencia-tipo.enum';
import { TipoMovimiento } from '../inventory/enums/tipo-movimiento.enum';
import { REGISTRAR_MOVIMIENTO_SQL } from '../inventory/sql/registrar-movimiento.sql';
import { ProductoLoteIngreso } from '../products/entities/producto-lote-ingreso.entity';
import { Producto } from '../products/entities/producto.entity';
import { LoteIngresoOrigen } from '../products/enums/lote-ingreso-origen.enum';
import { UnidadMedida } from '../products/enums/unidad-medida.enum';
import { registrarLoteIngreso } from '../products/utils/registrar-lote-ingreso';
import {
  calcularPrecioVenta,
  IVA_DEFAULT_PCT,
} from '../products/utils/calcular-precio-venta';
import {
  CompraProveedorManualDto,
  TIPOS_MANUAL_COMPRA,
} from './dto/compra-proveedor-manual.dto';
import { ComprobanteItem } from './entities/comprobante-item.entity';
import { Comprobante } from './entities/comprobante.entity';
import { FacturaImportadaAplicacion } from './entities/factura-importada-aplicacion.entity';
import { EstadoComprobante } from './enums/estado-comprobante.enum';
import {
  calcularImportesCompra,
  importesDesdeCabeceraManual,
  totalPercepciones,
  type ImportesCompra,
} from './utils/calcular-importes-compra';
import { numeroComprobanteImportado } from './utils/numero-comprobante-importado';

const TOLERANCIA_COSTO = 0.005;
const UMBRAL_BONIFICACION = 0.000001;

export type ActualizacionCostoProducto = {
  productoId: string;
  codigo: string | null;
  nombre: string;
  precioCostoAnterior: number | null;
  precioCostoNuevo: number;
  precioVentaAnterior: number | null;
  precioVentaNuevo: number | null;
  variacionPct: number | null;
};

type ResolvedItem = {
  productoId: string;
  cantidad: number;
  precioUnitario: number;
  precioCosto: number;
  ivaPorcentaje: number | null;
};

@Injectable()
export class CompraProveedorManualService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Proveedor)
    private readonly proveedorRepo: Repository<Proveedor>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
  ) {}

  async registrar(dto: CompraProveedorManualDto, usuarioId: string) {
    if (!TIPOS_MANUAL_COMPRA.has(dto.tipoComprobante)) {
      throw new BadRequestException('Para compras manuales us├í Factura A/B/C o Remito');
    }

    this.validarItems(dto);

    const tenantId = this.tenantContext.getTenantId();
    const sucursalId =
      dto.sucursalId ?? (await this.sucursalContext.requireSucursalId());

    const proveedorId = await this.resolveProveedorId(tenantId, dto);
    const resolvedItems = await this.resolveItems(tenantId, sucursalId, proveedorId, dto);
    const importes = this.resolveImportes(dto, resolvedItems);
    await this.assertNoDuplicado(tenantId, dto, proveedorId, importes);

    const actualizacionesCostos: ActualizacionCostoProducto[] = [];
    const afectaStock = dto.afectaStock !== false;
    const afectaCuentaCorriente = dto.afectaCuentaCorriente !== false;
    const actualizarCostos = dto.actualizarCostos === true;

    const comprobanteId = await this.dataSource.transaction(async (manager) => {
      const ordenRows = (await manager.query(
        `SELECT COALESCE(MAX(numero_orden), 0) + 1 AS n FROM comprobante WHERE tenant_id = $1`,
        [tenantId],
      )) as Array<{ n?: number | string }>;
      const numeroOrden = Number(ordenRows[0]?.n);
      const numero = numeroComprobanteImportado(dto.puntoVenta ?? null, dto.numeroDocumento ?? null);

      const notas = this.buildNotas(dto);

      const comprobante = manager.create(Comprobante, {
        tenantId,
        tipo: dto.tipoComprobante,
        numero,
        numeroOrden: Number.isFinite(numeroOrden) ? numeroOrden : null,
        fecha: dto.fecha.slice(0, 10),
        clienteId: null,
        proveedorId,
        sucursalId,
        tipoOperacion: 'compra',
        subtotal: importes.subtotal.toFixed(2),
        ivaMonto: importes.ivaMonto.toFixed(2),
        ivaPorcentaje: importes.ivaPorcentaje.toFixed(2),
        total: importes.total.toFixed(2),
        estado: EstadoComprobante.importado,
        cae: dto.cae?.trim() || null,
        caeVencimiento: dto.caeVencimiento?.slice(0, 10) ?? null,
        notas,
        pdfUrl: null,
        usuarioId,
      });
      const saved = await manager.save(Comprobante, comprobante);

      const itemEntities = resolvedItems.map((it) =>
        manager.create(ComprobanteItem, {
          comprobanteId: saved.id,
          productoId: it.productoId,
          cantidad: it.cantidad.toFixed(3),
          precioUnitario: it.precioUnitario.toFixed(2),
          precioCosto: it.precioCosto.toFixed(6),
          subtotal: round2(it.cantidad * it.precioUnitario).toFixed(2),
        }),
      );
      await manager.save(ComprobanteItem, itemEntities);

      if (afectaStock) {
        const loteRepo = manager.getRepository(ProductoLoteIngreso);
        for (const it of resolvedItems) {
          const movRows = (await manager.query(REGISTRAR_MOVIMIENTO_SQL, [
            tenantId,
            it.productoId,
            sucursalId,
            TipoMovimiento.entrada,
            it.cantidad,
            'Entrada por factura recibida (manual)',
            ReferenciaTipo.factura_recibida,
            saved.id,
            usuarioId,
          ])) as Array<{ id?: string }>;
          const movimientoId = movRows[0]?.id ?? null;

          if (!esLineaBonificacion(it.precioUnitario)) {
            await registrarLoteIngreso(loteRepo, {
              tenantId,
              productoId: it.productoId,
              sucursalId,
              proveedorId,
              cantidad: it.cantidad,
              fechaVencimiento: null,
              precioCosto: it.precioCosto,
              origen: LoteIngresoOrigen.comprobante_compra,
              movimientoId,
              creadoPor: usuarioId,
            });
          }
        }
      }

      if (actualizarCostos) {
        const productoIds = [...new Set(resolvedItems.map((r) => r.productoId))];
        const productos = await manager.find(Producto, {
          where: { tenantId, id: In(productoIds) },
        });
        const prodMap = new Map(productos.map((p) => [p.id, p]));

        for (const it of resolvedItems) {
          if (it.precioUnitario <= UMBRAL_BONIFICACION) continue;
          const prod = prodMap.get(it.productoId);
          if (!prod) continue;

          const anterior = costoValido(Number(prod.precioCosto));
          const nuevo = it.precioCosto;
          if (anterior != null && Math.abs(anterior - nuevo) <= TOLERANCIA_COSTO) continue;

          const ventaAnt = Number(prod.precioVenta);
          await manager.update(
            Producto,
            { id: prod.id, tenantId },
            { precioCosto: nuevo.toFixed(2) },
          );

          const variacionPct =
            anterior != null && anterior > 0
              ? round2(((nuevo - anterior) / anterior) * 100)
              : null;

          actualizacionesCostos.push({
            productoId: prod.id,
            codigo: prod.codigo,
            nombre: prod.nombre,
            precioCostoAnterior: anterior,
            precioCostoNuevo: nuevo,
            precioVentaAnterior: ventaAnt,
            precioVentaNuevo: ventaAnt,
            variacionPct,
          });
        }
      }

      const cuentaCorrienteDelta =
        afectaCuentaCorriente && importes.total > 0 ? importes.total : 0;

      await manager.save(
        FacturaImportadaAplicacion,
        manager.create(FacturaImportadaAplicacion, {
          tenantId,
          comprobanteId: saved.id,
          origen: 'manual',
          afectaStock,
          afectaCuentaCorriente,
          subtotal: importes.subtotal.toFixed(6),
          ivaMonto: importes.ivaMonto.toFixed(6),
          total: importes.total.toFixed(6),
          cuentaCorrienteDelta: cuentaCorrienteDelta.toFixed(6),
          estado: 'aplicada',
        }),
      );

      return saved.id;
    });

    return {
      data: {
        comprobanteId,
        actualizacionesCostos,
        pdfUrl: null as string | null,
      },
    };
  }

  private validarItems(dto: CompraProveedorManualDto) {
    for (const it of dto.items) {
      if (it.productoId && it.crearDesdeFactura) {
        throw new BadRequestException('Cada ├¡tem debe tener productoId o crearDesdeFactura, no ambos.');
      }
      if (!it.productoId && !it.crearDesdeFactura) {
        throw new BadRequestException(
          'En compras, cada ├¡tem sin producto debe incluir crearDesdeFactura.',
        );
      }
    }
  }

  private async resolveProveedorId(
    tenantId: string,
    dto: CompraProveedorManualDto,
  ): Promise<string> {
    if (dto.crearProveedor) {
      const cuit = dto.crearProveedor.cuit.replace(/\D/g, '');
      if (cuit.length !== 11) {
        throw new BadRequestException('CUIT del proveedor inv├ílido');
      }
      const existentes = await this.proveedorRepo.find({
        where: { tenantId, activo: true },
        select: ['id', 'cuit', 'nombre'],
      });
      const match = existentes.find(
        (p) => p.cuit?.replace(/\D/g, '') === cuit || this.nombreSimilar(p.nombre, dto.crearProveedor!.razonSocial),
      );
      if (match) return match.id;

      const saved = await this.proveedorRepo.save(
        this.proveedorRepo.create({
          tenantId,
          nombre: dto.crearProveedor.razonSocial.trim(),
          cuit,
          activo: true,
        }),
      );
      return saved.id;
    }

    if (!dto.proveedorId) {
      throw new BadRequestException('Factura de compra: indic├í o cre├í un proveedor');
    }

    const prov = await this.proveedorRepo.findOne({
      where: { id: dto.proveedorId, tenantId, activo: true },
    });
    if (!prov) {
      throw new NotFoundException('Proveedor no encontrado');
    }
    return prov.id;
  }

  private nombreSimilar(a: string, b: string): boolean {
    const na = a.trim().toLowerCase();
    const nb = b.trim().toLowerCase();
    return na.length > 0 && na === nb;
  }

  private async resolveItems(
    tenantId: string,
    sucursalId: string,
    proveedorId: string,
    dto: CompraProveedorManualDto,
  ): Promise<ResolvedItem[]> {
    const out: ResolvedItem[] = [];
    let autoSeq = 0;

    for (const it of dto.items) {
      const precioCosto = it.precioCosto ?? it.precioUnitario;

      if (it.productoId) {
        const prod = await this.productoRepo.findOne({
          where: { id: it.productoId, tenantId, activo: true },
        });
        if (!prod) {
          throw new BadRequestException(`Producto no encontrado: ${it.productoId}`);
        }
        if (prod.usaVariantes) {
          throw new BadRequestException(
            'Productos con variantes no est├ín soportados en compra manual a├║n.',
          );
        }
        out.push({
          productoId: prod.id,
          cantidad: it.cantidad,
          precioUnitario: it.precioUnitario,
          precioCosto,
          ivaPorcentaje: it.ivaPorcentaje ?? null,
        });
        continue;
      }

      const crear = it.crearDesdeFactura!;
      let codigo = crear.codigo?.trim() || '';
      if (!codigo) {
        codigo = `CMP-${Date.now()}-${autoSeq++}`;
      } else {
        const dup = await this.productoRepo.findOne({
          where: { tenantId, sucursalId, codigo, activo: true },
        });
        if (dup) {
          codigo = `CMP-${Date.now()}-${autoSeq++}`;
        }
      }

      const ivaP = it.ivaPorcentaje ?? IVA_DEFAULT_PCT;
      const precioVenta = calcularPrecioVenta(precioCosto, 0, ivaP, IVA_DEFAULT_PCT);

      const entity = this.productoRepo.create({
        tenantId,
        sucursalId,
        codigo,
        nombre: crear.nombre.trim().slice(0, 500),
        proveedorId,
        unidad: UnidadMedida.unidad,
        precioCosto: precioCosto.toFixed(2),
        precioVenta: precioVenta.toFixed(2),
        stockActual: '0.000',
        stockMinimo: '0.000',
        activo: true,
      });
      const saved = await this.productoRepo.save(entity);
      out.push({
        productoId: saved.id,
        cantidad: it.cantidad,
        precioUnitario: it.precioUnitario,
        precioCosto,
        ivaPorcentaje: it.ivaPorcentaje ?? null,
      });
    }

    return out;
  }

  private resolveImportes(
    dto: CompraProveedorManualDto,
    items: ResolvedItem[],
  ): ImportesCompra {
    const percepciones = totalPercepciones(dto);

    if (dto.importesManuales) {
      return importesDesdeCabeceraManual({
        subtotal: dto.subtotal,
        ivaMonto: dto.ivaMonto,
        total: dto.total,
        percepciones,
      });
    }

    const calc = calcularImportesCompra(
      items.map((it) => ({
        productoId: it.productoId,
        cantidad: it.cantidad,
        precioUnitario: it.precioUnitario,
        ivaPorcentaje: it.ivaPorcentaje,
      })),
      dto.tipoComprobante,
    );

    if (percepciones > 0) {
      return { ...calc, total: round2(calc.total + percepciones) };
    }
    return calc;
  }

  private async assertNoDuplicado(
    tenantId: string,
    dto: CompraProveedorManualDto,
    proveedorId: string,
    importes: ImportesCompra,
  ) {
    const numero = numeroComprobanteImportado(dto.puntoVenta ?? null, dto.numeroDocumento ?? null);
    if (numero == null) return;

    const dup = await this.comprobanteRepo.findOne({
      where: {
        tenantId,
        estado: EstadoComprobante.importado,
        tipoOperacion: 'compra',
        tipo: dto.tipoComprobante,
        proveedorId,
        numero,
      },
    });
    if (dup) {
      throw new ConflictException(
        'Ya existe un comprobante importado con el mismo proveedor y numeraci├│n',
      );
    }

    if (importes.total <= 0 && dto.items.length > 0) {
      throw new BadRequestException('El total del comprobante debe ser mayor a cero');
    }
  }

  private buildNotas(dto: CompraProveedorManualDto): string {
    let notas = `[manual] pv=${dto.puntoVenta ?? '-'} n=${dto.numeroDocumento ?? '-'}`;
    const percIibb = dto.percepcionIibbMonto ?? 0;
    const percIva = dto.percepcionIvaMonto ?? 0;
    const impInt = dto.impuestoInternoMonto ?? 0;
    if (percIibb > 0 || percIva > 0 || impInt > 0) {
      notas += ` ┬À perc_iibb=${percIibb} perc_iva=${percIva} imp_int=${impInt}`;
    }
    if (dto.observaciones?.trim()) {
      notas += ` ┬À ${dto.observaciones.trim().slice(0, 500)}`;
    }
    return notas;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function costoValido(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= UMBRAL_BONIFICACION) return null;
  return value;
}

function esLineaBonificacion(precioUnitario: number): boolean {
  return precioUnitario <= UMBRAL_BONIFICACION;
}
