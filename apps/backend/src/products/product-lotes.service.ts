import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { CreateProductoLoteDto } from './dto/create-producto-lote.dto';
import { UpdateProductoLoteDto } from './dto/update-producto-lote.dto';
import { ProductoLoteIngreso } from './entities/producto-lote-ingreso.entity';
import { Producto } from './entities/producto.entity';
import { LoteIngresoOrigen } from './enums/lote-ingreso-origen.enum';
import { registrarLoteIngreso } from './utils/registrar-lote-ingreso';

@Injectable()
export class ProductLotesService {
  constructor(
    @InjectRepository(ProductoLoteIngreso)
    private readonly loteRepo: Repository<ProductoLoteIngreso>,
    @InjectRepository(Producto)
    private readonly productoRepo: Repository<Producto>,
    @InjectRepository(Proveedor)
    private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
  ) {}

  async listByProduct(productoId: string) {
    const tenantId = this.tenantContext.getTenantId();
    await this.assertProducto(tenantId, productoId);

    const rows = await this.loteRepo.find({
      where: { tenantId, productoId },
      order: { createdAt: 'DESC' },
      take: 200,
    });

    const proveedorIds = [...new Set(rows.map((r) => r.proveedorId).filter(Boolean))] as string[];
    const sucursalIds = [...new Set(rows.map((r) => r.sucursalId))];

    const [proveedores, sucursales] = await Promise.all([
      proveedorIds.length
        ? this.proveedorRepo.find({ where: { tenantId, id: In(proveedorIds) } })
        : Promise.resolve([]),
      this.sucursalRepo.find({ where: { tenantId, id: In(sucursalIds) } }),
    ]);

    const provMap = new Map(proveedores.map((p) => [p.id, p]));
    const sucMap = new Map(sucursales.map((s) => [s.id, s]));

    return {
      data: rows.map((row) => this.serialize(row, provMap.get(row.proveedorId ?? ''), sucMap.get(row.sucursalId))),
    };
  }

  async create(productoId: string, dto: CreateProductoLoteDto, usuarioId: string) {
    const tenantId = this.tenantContext.getTenantId();
    const producto = await this.assertProducto(tenantId, productoId);

    const sucursalId =
      dto.sucursalId ?? producto.sucursalId ?? (await this.sucursalContext.requireSucursalId());

    if (dto.proveedorId) {
      const prov = await this.proveedorRepo.findOne({
        where: { id: dto.proveedorId, tenantId, activo: true },
      });
      if (!prov) {
        throw new BadRequestException('proveedorId inv├ílido');
      }
    }

    const { id } = await registrarLoteIngreso(this.loteRepo, {
      tenantId,
      productoId,
      sucursalId,
      proveedorId: dto.proveedorId ?? producto.proveedorId,
      cantidad: dto.cantidad,
      fechaVencimiento: dto.fechaVencimiento ?? null,
      precioCosto: dto.precioCosto ?? (producto.precioCosto ? Number(producto.precioCosto) : null),
      origen: dto.origen ?? LoteIngresoOrigen.manual,
      movimientoId: dto.movimientoId ?? null,
      creadoPor: usuarioId,
    });

    if (!id) {
      throw new BadRequestException('Indic├í cantidad > 0 o fecha de vencimiento');
    }

    const row = await this.loteRepo.findOne({ where: { id, tenantId } });
    if (!row) {
      throw new NotFoundException('Lote no encontrado tras crear');
    }

    const [prov, suc] = await Promise.all([
      row.proveedorId
        ? this.proveedorRepo.findOne({ where: { id: row.proveedorId, tenantId } })
        : Promise.resolve(null),
      this.sucursalRepo.findOne({ where: { id: row.sucursalId, tenantId } }),
    ]);

    return { data: this.serialize(row, prov, suc) };
  }

  async update(productoId: string, loteId: string, dto: UpdateProductoLoteDto) {
    const tenantId = this.tenantContext.getTenantId();
    await this.assertProducto(tenantId, productoId);

    const row = await this.loteRepo.findOne({ where: { id: loteId, tenantId, productoId } });
    if (!row) {
      throw new NotFoundException('Lote no encontrado');
    }

    if (dto.cantidad !== undefined) {
      row.cantidad = dto.cantidad.toFixed(3);
    }
    if (dto.fechaVencimiento !== undefined) {
      row.fechaVencimiento = dto.fechaVencimiento;
    }

    const saved = await this.loteRepo.save(row);
    const [prov, suc] = await Promise.all([
      saved.proveedorId
        ? this.proveedorRepo.findOne({ where: { id: saved.proveedorId, tenantId } })
        : Promise.resolve(null),
      this.sucursalRepo.findOne({ where: { id: saved.sucursalId, tenantId } }),
    ]);

    return { data: this.serialize(saved, prov, suc) };
  }

  private async assertProducto(tenantId: string, productoId: string) {
    const producto = await this.productoRepo.findOne({ where: { id: productoId, tenantId } });
    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }
    return producto;
  }

  private serialize(
    row: ProductoLoteIngreso,
    proveedor: Proveedor | null | undefined,
    sucursal: Sucursal | null | undefined,
  ) {
    return {
      id: row.id,
      productoId: row.productoId,
      cantidad: Number(row.cantidad),
      fechaVencimiento: row.fechaVencimiento,
      precioCosto: row.precioCosto != null ? Number(row.precioCosto) : null,
      origen: row.origen,
      importacionLogId: row.importacionLogId,
      lectorFacturaLogId: row.lectorFacturaLogId,
      movimientoId: row.movimientoId,
      createdAt: row.createdAt.toISOString(),
      proveedor: proveedor ? { id: proveedor.id, nombre: proveedor.nombre } : null,
      sucursal: sucursal
        ? { id: sucursal.id, nombre: sucursal.nombre, codigo: sucursal.codigo }
        : null,
    };
  }
}
