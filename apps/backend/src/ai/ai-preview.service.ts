import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { PricingService } from '../pricing/pricing.service';
import { Producto } from '../products/entities/producto.entity';
import {
  calcularPrecioVenta,
  IVA_DEFAULT_PCT,
} from '../products/utils/calcular-precio-venta';
import { effectivePosPricingPrefs } from '../products/utils/effective-pos-prefs.util';
import { AiPreviewDto } from './dto/ai-preview.dto';

@Injectable()
export class AiPreviewService {
  constructor(
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(ModuloConfig)
    private readonly moduloConfigRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
    private readonly pricingService: PricingService,
  ) {}

  async preview(dto: AiPreviewDto) {
    await this.assertModuleAllowed();

    const filas = dto.filas ?? [];
    if (filas.length === 0) {
      return { data: { cambios: [], sugerencias: [] } };
    }

    const tenantId = this.tenantContext.getTenantId();
    const tenant = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: { ivaPorcentajeDefault: true, posPrefs: true },
    });
    const ivaTenantDefault = tenant ? Number(tenant.ivaPorcentajeDefault) : IVA_DEFAULT_PCT;
    const posPrefs = effectivePosPricingPrefs(tenant?.posPrefs ?? null, null);

    const codigos = [
      ...new Set(
        filas.map((f) => (f.codigo != null ? String(f.codigo).trim() : '')).filter(Boolean),
      ),
    ];

    let porCodigo = new Map<
      string,
      {
        id: string;
        codigo: string;
        nombre: string;
        precioCosto: number;
        precioVenta: number;
        porcentajeGanancia: number | null;
        ivaPorcentaje: number | null;
        descuentoCostoPct: number | null;
      }
    >();

    if (codigos.length > 0) {
      const productos = await this.productoRepo.find({
        where: { tenantId, activo: true, codigo: In(codigos) },
        select: {
          id: true,
          codigo: true,
          nombre: true,
          precioCosto: true,
          precioVenta: true,
          porcentajeGanancia: true,
          ivaPorcentaje: true,
          descuentoCostoPct: true,
        },
      });
      porCodigo = new Map(productos.map((p) => [p.codigo.toLowerCase(), {
        id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        precioCosto: Number(p.precioCosto),
        precioVenta: Number(p.precioVenta),
        porcentajeGanancia: p.porcentajeGanancia != null ? Number(p.porcentajeGanancia) : null,
        ivaPorcentaje: p.ivaPorcentaje != null ? Number(p.ivaPorcentaje) : null,
        descuentoCostoPct: p.descuentoCostoPct != null ? Number(p.descuentoCostoPct) : null,
      }]));
    }

    const cambioPorProducto = new Map<string, {
      productoId: string;
      codigo: string;
      nombre: string;
      precioVentaAnterior: number;
      precioVentaNuevo: number;
      precioCostoAnterior: number | null;
      precioCostoNuevo: number | null;
      variacionPorcentaje: number;
    }>();

    for (const f of filas) {
      if (!f.codigo || String(f.codigo).trim() === '') continue;
      const p = porCodigo.get(String(f.codigo).trim().toLowerCase());
      if (!p) continue;

      const costoNuevo = f.precioCosto ?? p.precioCosto;
      const gNuevo = f.porcentajeGanancia != null ? f.porcentajeGanancia : (p.porcentajeGanancia ?? 0);
      const ivaNuevo = f.ivaPorcentaje != null ? f.ivaPorcentaje : p.ivaPorcentaje;
      const ventaNuevo = calcularPrecioVenta(costoNuevo, gNuevo, ivaNuevo, ivaTenantDefault, {
        redondearPreciosCentenas: posPrefs.redondearPreciosCentenas,
        redondearMenores100ADecenas: posPrefs.redondearMenores100ADecenas,
        descuentoCostoPct: p.descuentoCostoPct,
      });
      const ventaAnt = p.precioVenta;
      const costoAnt = p.precioCosto;

      if (ventaNuevo === ventaAnt && costoNuevo === costoAnt) continue;

      const variacion =
        ventaAnt > 0 ? ((ventaNuevo - ventaAnt) / ventaAnt) * 100 : ventaNuevo !== ventaAnt ? 100 : 0;

      cambioPorProducto.set(p.id, {
        productoId: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        precioVentaAnterior: ventaAnt,
        precioVentaNuevo: ventaNuevo,
        precioCostoAnterior: costoAnt,
        precioCostoNuevo: costoNuevo,
        variacionPorcentaje: Math.round(variacion * 10) / 10,
      });
    }

    const cambios = [...cambioPorProducto.values()].sort(
      (a, b) => Math.abs(b.variacionPorcentaje) - Math.abs(a.variacionPorcentaje),
    );

    const sugerencias: Array<{ precioSugerido: number; margenUsado: number; fuente: string } | null> = [];

    for (const f of filas) {
      if (
        f.precioCosto == null ||
        typeof f.precioCosto !== 'number' ||
        f.precioCosto < 0 ||
        !f.codigo
      ) {
        sugerencias.push(null);
        continue;
      }
      const p = porCodigo.get(String(f.codigo).trim().toLowerCase());
      if (!p) {
        sugerencias.push(null);
        continue;
      }
      const s = await this.pricingService.getSuggestion({
        productoId: p.id,
        nuevoPrecioCosto: f.precioCosto,
      });
      sugerencias.push({
        precioSugerido: s.data.precioSugerido,
        margenUsado: s.data.margenUsadoPct,
        fuente: s.data.fuente,
      });
    }

    return { data: { cambios, sugerencias } };
  }

  private async assertModuleAllowed(): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const modulos = await this.moduloConfigRepo.findOne({ where: { tenantId } });
    if (!modulos) {
      throw new ForbiddenException('Configuraci├│n de m├│dulos no encontrada');
    }
    if (!modulos.importadorExcel && !modulos.iaPrecios) {
      throw new ForbiddenException('M├│dulo de importaci├│n o IA precios no habilitado');
    }
  }
}
