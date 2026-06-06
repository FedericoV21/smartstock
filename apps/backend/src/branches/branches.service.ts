import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { TenantContext } from '../auth/tenant-context.service';
import { Tenant } from '../config/entities/tenant.entity';
import { UsersService } from '../users/users.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { Sucursal } from './entities/sucursal.entity';
import { SucursalContext } from './sucursal-context.service';

@Injectable()
export class BranchesService {
  constructor(
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
    private readonly usersService: UsersService,
  ) {}

  async list() {
    const tenantId = this.tenantContext.getTenantId();
    const rows = await this.sucursalRepo.find({
      where: { tenantId },
      order: { createdAt: 'ASC' },
    });
    return { data: rows.map((s) => this.serialize(s)) };
  }

  async getById(id: string) {
    const row = await this.findOrThrow(id);
    return { data: this.serialize(row) };
  }

  async create(dto: CreateBranchDto) {
    const tenantId = this.tenantContext.getTenantId();
    const codigo = dto.codigo.trim();
    const nombre = dto.nombre.trim();
    if (!codigo || !nombre) {
      throw new BadRequestException('C├│digo y nombre son obligatorios.');
    }

    const entity = this.sucursalRepo.create({
      tenantId,
      codigo,
      nombre,
      direccion: dto.direccion?.trim() ?? null,
      activa: dto.activa ?? true,
      esPrincipal: false,
    });

    const perfil = dto.perfilTicket ?? 'copiar_negocio';
    if (perfil === 'personalizar_vacio') {
      entity.heredaDatosTicket = false;
    } else {
      const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
      if (!tenant) {
        throw new NotFoundException('Negocio no encontrado');
      }
      entity.heredaDatosTicket = false;
      entity.razonSocial = tenant.razonSocial;
      entity.cuit = tenant.cuit;
      entity.telefono = tenant.telefono;
      entity.email = tenant.email;
    }

    try {
      const saved = await this.sucursalRepo.save(entity);
      return { data: this.serialize(saved) };
    } catch (err) {
      this.rethrowUnique(err);
      throw err;
    }
  }

  async update(id: string, dto: UpdateBranchDto) {
    const row = await this.findOrThrow(id);
    if (dto.codigo !== undefined) row.codigo = dto.codigo.trim();
    if (dto.nombre !== undefined) row.nombre = dto.nombre.trim();
    if (dto.direccion !== undefined) row.direccion = dto.direccion?.trim() ?? null;
    if (dto.activa !== undefined) row.activa = dto.activa;

    if (dto.heredaDatosTicket === true) {
      row.heredaDatosTicket = true;
      row.razonSocial = null;
      row.cuit = null;
      row.telefono = null;
      row.horariosAtencion = null;
      row.email = null;
    } else {
      if (dto.heredaDatosTicket !== undefined) row.heredaDatosTicket = dto.heredaDatosTicket;
      if (dto.razonSocial !== undefined) row.razonSocial = dto.razonSocial;
      if (dto.cuit !== undefined) row.cuit = dto.cuit;
      if (dto.telefono !== undefined) row.telefono = dto.telefono;
      if (dto.horariosAtencion !== undefined) row.horariosAtencion = dto.horariosAtencion;
      if (dto.email !== undefined) row.email = dto.email;
    }

    try {
      const saved = await this.sucursalRepo.save(row);
      return { data: this.serialize(saved) };
    } catch (err) {
      this.rethrowUnique(err);
      throw err;
    }
  }

  async remove(id: string) {
    const row = await this.findOrThrow(id);
    if (row.esPrincipal) {
      throw new BadRequestException('No pod├®s eliminar la sucursal principal.');
    }
    await this.sucursalRepo.remove(row);
    return { data: { success: true } };
  }

  async getActiveContext(user: AccessTokenPayload) {
    const tenantId = this.tenantContext.getTenantId();
    const profile = await this.usersService.ensureFromJwt(user, tenantId);
    const appRole = resolveAppRole(user) ?? profile.rol;
    const resolvedId = await this.sucursalContext.resolveSucursalId();

    const operableIds = await this.usersService.listOperableSucursalIds(
      user.sub,
      tenantId,
      appRole,
    );
    const rows = await this.sucursalRepo.find({
      where: { tenantId, activa: true },
      order: { createdAt: 'ASC' },
    });
    const visible =
      appRole === 'admin'
        ? rows
        : rows.filter((s) => operableIds.includes(s.id));

    return {
      data: {
        sucursalDefaultId: profile.sucursalDefaultId,
        resolvedSucursalId: resolvedId,
        branches: visible.map((s) => this.serializeSummary(s)),
      },
    };
  }

  async setActive(dto: { sucursalId: string }, user: AccessTokenPayload) {
    const tenantId = this.tenantContext.getTenantId();
    const appRole = resolveAppRole(user);
    const saved = await this.usersService.setSucursalDefault(
      user.sub,
      tenantId,
      dto.sucursalId,
      appRole,
    );
    this.sucursalContext.setActiveSucursalId(dto.sucursalId);
    return {
      data: {
        ok: true,
        sucursalId: dto.sucursalId,
        sucursalDefaultId: saved.sucursalDefaultId,
      },
    };
  }

  private async findOrThrow(id: string): Promise<Sucursal> {
    const tenantId = this.tenantContext.getTenantId();
    const row = await this.sucursalRepo.findOne({ where: { id, tenantId } });
    if (!row) {
      throw new NotFoundException('Sucursal no encontrada.');
    }
    return row;
  }

  private rethrowUnique(err: unknown): void {
    if (err instanceof QueryFailedError) {
      const code = (err.driverError as { code?: string })?.code;
      if (code === '23505') {
        throw new ConflictException('Ya existe una sucursal con ese c├│digo o nombre.');
      }
    }
  }

  private serialize(s: Sucursal) {
    return {
      id: s.id,
      codigo: s.codigo,
      nombre: s.nombre,
      direccion: s.direccion,
      activa: s.activa,
      esPrincipal: s.esPrincipal,
      heredaDatosTicket: s.heredaDatosTicket,
      razonSocial: s.razonSocial,
      cuit: s.cuit,
      telefono: s.telefono,
      horariosAtencion: s.horariosAtencion,
      email: s.email,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  private serializeSummary(s: Sucursal) {
    return {
      id: s.id,
      codigo: s.codigo,
      nombre: s.nombre,
      activa: s.activa,
      esPrincipal: s.esPrincipal,
    };
  }
}
