import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { CreateCategoriaDto } from './dto/create-categoria.dto';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { CreateProveedorDto } from './dto/create-proveedor.dto';
import { ListCatalogQueryDto } from './dto/list-catalog-query.dto';
import { UpdateCategoriaDto } from './dto/update-categoria.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { UpdateProveedorDto } from './dto/update-proveedor.dto';
import { Categoria } from './entities/categoria.entity';
import { Cliente } from './entities/cliente.entity';
import { Proveedor } from './entities/proveedor.entity';

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Categoria)
    private readonly categoriaRepo: Repository<Categoria>,
    @InjectRepository(Proveedor)
    private readonly proveedorRepo: Repository<Proveedor>,
    @InjectRepository(Cliente)
    private readonly clienteRepo: Repository<Cliente>,
    private readonly tenantContext: TenantContext,
  ) {}

  // ÔÇöÔÇöÔÇö Categor├¡as ÔÇöÔÇöÔÇö

  async listCategorias(query: ListCatalogQueryDto) {
    const tenantId = this.tenantContext.getTenantId();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const base: FindOptionsWhere<Categoria> = { tenantId };
    if (!query.includeInactive) base.activa = true;
    const q = query.q?.trim();
    const where = q ? { ...base, nombre: ILike(`%${q}%`) } : base;
    const [rows, total] = await this.categoriaRepo.findAndCount({
      where,
      order: { nombre: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      data: rows.map((c) => this.serializeCategoria(c)),
      meta: { total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async getCategoria(id: string) {
    const row = await this.findCategoriaOrThrow(id);
    return { data: this.serializeCategoria(row) };
  }

  async createCategoria(dto: CreateCategoriaDto) {
    const tenantId = this.tenantContext.getTenantId();
    const saved = await this.categoriaRepo.save(
      this.categoriaRepo.create({
        tenantId,
        nombre: dto.nombre.trim(),
        descripcion: dto.descripcion ?? null,
        activa: dto.activa ?? true,
      }),
    );
    return { data: this.serializeCategoria(saved) };
  }

  async updateCategoria(id: string, dto: UpdateCategoriaDto) {
    const row = await this.findCategoriaOrThrow(id);
    if (dto.nombre !== undefined) row.nombre = dto.nombre.trim();
    if (dto.descripcion !== undefined) row.descripcion = dto.descripcion ?? null;
    if (dto.activa !== undefined) row.activa = dto.activa;
    const saved = await this.categoriaRepo.save(row);
    return { data: this.serializeCategoria(saved) };
  }

  async deactivateCategoria(id: string) {
    const row = await this.findCategoriaOrThrow(id);
    row.activa = false;
    await this.categoriaRepo.save(row);
    return { data: { id, activa: false } };
  }

  // ÔÇöÔÇöÔÇö Proveedores ÔÇöÔÇöÔÇö

  async listProveedores(query: ListCatalogQueryDto) {
    const tenantId = this.tenantContext.getTenantId();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const base: FindOptionsWhere<Proveedor> = { tenantId };
    if (!query.includeInactive) base.activo = true;
    const q = query.q?.trim();
    const where = q ? { ...base, nombre: ILike(`%${q}%`) } : base;
    const [rows, total] = await this.proveedorRepo.findAndCount({
      where,
      order: { nombre: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      data: rows.map((p) => this.serializeProveedor(p)),
      meta: { total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async getProveedor(id: string) {
    const row = await this.findProveedorOrThrow(id);
    return { data: this.serializeProveedor(row) };
  }

  async createProveedor(dto: CreateProveedorDto) {
    const tenantId = this.tenantContext.getTenantId();
    const saved = await this.proveedorRepo.save(
      this.proveedorRepo.create({
        tenantId,
        nombre: dto.nombre.trim(),
        cuit: dto.cuit?.trim() || null,
        telefono: dto.telefono?.trim() || null,
        email: dto.email?.trim() || null,
        direccion: dto.direccion ?? null,
        notas: dto.notas ?? null,
        mapeoExcel: dto.mapeoExcel ?? null,
        activo: dto.activo ?? true,
      }),
    );
    return { data: this.serializeProveedor(saved) };
  }

  async updateProveedor(id: string, dto: UpdateProveedorDto) {
    const row = await this.findProveedorOrThrow(id);
    if (dto.nombre !== undefined) row.nombre = dto.nombre.trim();
    if (dto.cuit !== undefined) row.cuit = dto.cuit?.trim() || null;
    if (dto.telefono !== undefined) row.telefono = dto.telefono?.trim() || null;
    if (dto.email !== undefined) row.email = dto.email?.trim() || null;
    if (dto.direccion !== undefined) row.direccion = dto.direccion ?? null;
    if (dto.notas !== undefined) row.notas = dto.notas ?? null;
    if (dto.mapeoExcel !== undefined) row.mapeoExcel = dto.mapeoExcel ?? null;
    if (dto.activo !== undefined) row.activo = dto.activo;
    const saved = await this.proveedorRepo.save(row);
    return { data: this.serializeProveedor(saved) };
  }

  async deactivateProveedor(id: string) {
    const row = await this.findProveedorOrThrow(id);
    row.activo = false;
    await this.proveedorRepo.save(row);
    return { data: { id, activo: false } };
  }

  // ÔÇöÔÇöÔÇö Clientes ÔÇöÔÇöÔÇö

  async listClientes(query: ListCatalogQueryDto) {
    const tenantId = this.tenantContext.getTenantId();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const base: FindOptionsWhere<Cliente> = { tenantId };
    if (!query.includeInactive) base.activo = true;
    const q = query.q?.trim();
    const where = q ? { ...base, nombre: ILike(`%${q}%`) } : base;
    const [rows, total] = await this.clienteRepo.findAndCount({
      where,
      order: { nombre: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      data: rows.map((c) => this.serializeCliente(c)),
      meta: { total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async getCliente(id: string) {
    const row = await this.findClienteOrThrow(id);
    return { data: this.serializeCliente(row) };
  }

  async createCliente(dto: CreateClienteDto) {
    const tenantId = this.tenantContext.getTenantId();
    const saved = await this.clienteRepo.save(
      this.clienteRepo.create({
        tenantId,
        nombre: dto.nombre.trim(),
        razonSocial: dto.razonSocial?.trim() || null,
        cuitDni: dto.cuitDni?.trim() || null,
        condicionIva: dto.condicionIva ?? null,
        direccion: dto.direccion ?? null,
        telefono: dto.telefono?.trim() || null,
        email: dto.email?.trim() || null,
        notas: dto.notas ?? null,
        activo: dto.activo ?? true,
      }),
    );
    return { data: this.serializeCliente(saved) };
  }

  async updateCliente(id: string, dto: UpdateClienteDto) {
    const row = await this.findClienteOrThrow(id);
    if (dto.nombre !== undefined) row.nombre = dto.nombre.trim();
    if (dto.razonSocial !== undefined) row.razonSocial = dto.razonSocial?.trim() || null;
    if (dto.cuitDni !== undefined) row.cuitDni = dto.cuitDni?.trim() || null;
    if (dto.condicionIva !== undefined) row.condicionIva = dto.condicionIva ?? null;
    if (dto.direccion !== undefined) row.direccion = dto.direccion ?? null;
    if (dto.telefono !== undefined) row.telefono = dto.telefono?.trim() || null;
    if (dto.email !== undefined) row.email = dto.email?.trim() || null;
    if (dto.notas !== undefined) row.notas = dto.notas ?? null;
    if (dto.activo !== undefined) row.activo = dto.activo;
    const saved = await this.clienteRepo.save(row);
    return { data: this.serializeCliente(saved) };
  }

  async deactivateCliente(id: string) {
    const row = await this.findClienteOrThrow(id);
    row.activo = false;
    await this.clienteRepo.save(row);
    return { data: { id, activo: false } };
  }

  private async findCategoriaOrThrow(id: string): Promise<Categoria> {
    const tenantId = this.tenantContext.getTenantId();
    const row = await this.categoriaRepo.findOne({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Categor├¡a no encontrada');
    return row;
  }

  private async findProveedorOrThrow(id: string): Promise<Proveedor> {
    const tenantId = this.tenantContext.getTenantId();
    const row = await this.proveedorRepo.findOne({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Proveedor no encontrado');
    return row;
  }

  private async findClienteOrThrow(id: string): Promise<Cliente> {
    const tenantId = this.tenantContext.getTenantId();
    const row = await this.clienteRepo.findOne({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Cliente no encontrado');
    return row;
  }

  private serializeCategoria(c: Categoria) {
    return {
      id: c.id,
      tenantId: c.tenantId,
      nombre: c.nombre,
      descripcion: c.descripcion,
      activa: c.activa,
      createdAt: c.createdAt.toISOString(),
    };
  }

  private serializeProveedor(p: Proveedor) {
    return {
      id: p.id,
      tenantId: p.tenantId,
      nombre: p.nombre,
      cuit: p.cuit,
      telefono: p.telefono,
      email: p.email,
      direccion: p.direccion,
      notas: p.notas,
      mapeoExcel: p.mapeoExcel,
      activo: p.activo,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private serializeCliente(c: Cliente) {
    return {
      id: c.id,
      tenantId: c.tenantId,
      nombre: c.nombre,
      razonSocial: c.razonSocial,
      cuitDni: c.cuitDni,
      condicionIva: c.condicionIva,
      direccion: c.direccion,
      telefono: c.telefono,
      email: c.email,
      notas: c.notas,
      activo: c.activo,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }
}
