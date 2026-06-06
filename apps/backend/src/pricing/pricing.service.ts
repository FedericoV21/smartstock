import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Producto } from '../products/entities/producto.entity';
import { GetPricingSuggestionDto } from './dto/get-pricing-suggestion.dto';
import { ListPricingHistorialQueryDto } from './dto/list-pricing-historial-query.dto';
import { PrecioHistorial } from './entities/precio-historial.entity';

@Injectable()
export class PricingService {
  constructor(
    @InjectRepository(PrecioHistorial)
    private readonly precioHistorialRepo: Repository<PrecioHistorial>,
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    @InjectRepository(ModuloConfig)
    private readonly moduloConfigRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
  ) {}

  async listHistorial(query: ListPricingHistorialQueryDto) {
    await this.assertIaPreciosModule();

    const tenantId = this.tenantContext.getTenantId();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const where = {
      tenantId,
      ...(query.productoId ? { productoId: query.productoId } : {}),
      ...(query.origen ? { origen: query.origen } : {}),
    };

    const [rows, total] = await this.precioHistorialRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const productIds = [...new Set(rows.map((r) => r.productoId))];
    const products =
      productIds.length > 0
        ? await this.productoRepo.find({
            where: { tenantId, id: In(productIds) },
            select: { id: true, codigo: true, nombre: true },
          })
        : [];
    const productMap = new Map(products.map((p) => [p.id, p]));

    const historial = rows.map((r) => {
      const producto = productMap.get(r.productoId);
      return {
        id: r.id,
        created_at: r.createdAt.toISOString(),
        precio_costo_anterior: this.toNumber(r.precioCostoAnterior),
        precio_costo_nuevo: this.toNumber(r.precioCostoNuevo),
        precio_venta_anterior: this.toNumber(r.precioVentaAnterior),
        precio_venta_nuevo: this.toNumber(r.precioVentaNuevo),
        margen_anterior: this.toNumber(r.margenAnterior),
        margen_nuevo: this.toNumber(r.margenNuevo),
        origen: r.origen,
        producto: producto
          ? { id: producto.id, codigo: producto.codigo, nombre: producto.nombre }
          : null,
      };
    });

    return {
      data: {
        historial,
        total,
        pagina: page,
        por_pagina: pageSize,
      },
    };
  }

  private async assertIaPreciosModule(): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const modulos = await this.moduloConfigRepo.findOne({ where: { tenantId } });
    if (!modulos) {
      throw new ForbiddenException('Configuraci├│n de m├│dulos no encontrada');
    }
    if (!modulos.iaPrecios) {
      throw new ForbiddenException('M├│dulo ia_precios no habilitado');
    }
  }

  async getSuggestion(dto: GetPricingSuggestionDto) {
    const tenantId = this.tenantContext.getTenantId();
    const product = await this.productoRepo.findOne({
      where: { id: dto.productoId, tenantId, activo: true },
    });
    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    let margenUsadoPct: number;
    let fuente: 'margen_objetivo' | 'margen_actual_producto' | 'margen_promedio_categoria' | 'margen_default';

    if (dto.margenObjetivoPct !== undefined) {
      margenUsadoPct = dto.margenObjetivoPct;
      fuente = 'margen_objetivo';
    } else {
      const margenActual = this.calculateMargin(Number(product.precioCosto), Number(product.precioVenta));
      if (margenActual > 0) {
        margenUsadoPct = margenActual;
        fuente = 'margen_actual_producto';
      } else {
        const margenCategoria = await this.getCategoryAverageMargin(tenantId, product.categoriaId);
        if (margenCategoria !== null && margenCategoria > 0) {
          margenUsadoPct = margenCategoria;
          fuente = 'margen_promedio_categoria';
        } else {
          margenUsadoPct = 30;
          fuente = 'margen_default';
        }
      }
    }

    const precioSugerido = this.roundMoney(dto.nuevoPrecioCosto * (1 + margenUsadoPct / 100));

    return {
      data: {
        productoId: product.id,
        nuevoPrecioCosto: this.roundMoney(dto.nuevoPrecioCosto),
        precioSugerido,
        margenUsadoPct: this.roundPct(margenUsadoPct),
        fuente,
      },
    };
  }

  private async getCategoryAverageMargin(tenantId: string, categoriaId: string | null): Promise<number | null> {
    if (!categoriaId) return null;

    const rows = await this.productoRepo.find({
      where: { tenantId, categoriaId, activo: true },
      select: { precioCosto: true, precioVenta: true },
      take: 200,
    });

    const margenes = rows
      .map((p) => this.calculateMargin(Number(p.precioCosto), Number(p.precioVenta)))
      .filter((m) => m > 0);
    if (margenes.length === 0) return null;

    const avg = margenes.reduce((acc, item) => acc + item, 0) / margenes.length;
    return this.roundPct(avg);
  }

  private calculateMargin(costo: number, venta: number): number {
    if (costo <= 0) return 0;
    return ((venta - costo) / costo) * 100;
  }

  private roundMoney(value: number): number {
    return Number(value.toFixed(2));
  }

  private roundPct(value: number): number {
    return Number(value.toFixed(2));
  }

  private toNumber(value: string | null): number | null {
    return value === null ? null : Number(value);
  }
}
