import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ArcaConfig } from '../arca/entities/arca-config.entity';
import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { CondicionIva } from '../catalog/enums/condicion-iva.enum';
import { ModuloConfig } from './entities/modulo-config.entity';
import { Tenant } from './entities/tenant.entity';
import type { PatchTenantDto } from './dto/patch-tenant.dto';

@Injectable()
export class TenantConfigService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(ModuloConfig)
    private readonly moduloConfigRepo: Repository<ModuloConfig>,
    @InjectRepository(ArcaConfig)
    private readonly arcaConfigRepo: Repository<ArcaConfig>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
  ) {}

  async getTenantProfile() {
    const tenantId = this.tenantContext.getTenantId();
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Negocio no encontrado');
    }

    const [modulos, sucursalId] = await Promise.all([
      this.moduloConfigRepo.findOne({ where: { tenantId } }),
      this.sucursalContext.resolveSucursalId(),
    ]);

    let arcaConfigurado = false;
    const arcaModuloActivo = !!modulos?.facturadorArca;
    if (arcaModuloActivo && sucursalId) {
      const arca = await this.arcaConfigRepo.findOne({
        where: { tenantId, sucursalId },
      });
      arcaConfigurado = !!(
        arca?.certificadoPem &&
        arca?.clavePrivadaPem &&
        arca?.cuitEmisor &&
        arca?.puntoDeVenta != null
      );
    }

    return {
      data: {
        ...this.serializeTenant(tenant),
        arcaConfigurado,
        arca_configurado: arcaConfigurado,
      },
    };
  }

  async patchTenant(dto: PatchTenantDto) {
    const tenantId = this.tenantContext.getTenantId();
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('No se encontr├│ el negocio.');
    }

    const updates = this.buildTenantUpdates(dto);
    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('Sin cambios');
    }

    Object.assign(tenant, updates);
    const saved = await this.tenantRepo.save(tenant);
    return this.serializeTenantSnake(saved);
  }

  async getModuloConfig() {
    const tenantId = this.tenantContext.getTenantId();
    const row = await this.moduloConfigRepo.findOne({ where: { tenantId } });
    if (!row) {
      throw new NotFoundException('Configuraci├│n de m├│dulos no encontrada');
    }
    return { data: this.serializeModulos(row) };
  }

  private buildTenantUpdates(dto: PatchTenantDto): Partial<Tenant> {
    const updates: Partial<Tenant> = {};
    const str = (v: unknown) =>
      v === null || v === undefined ? null : String(v).trim() || null;

    if (dto.nombre !== undefined) {
      const nombre = String(dto.nombre ?? '').trim();
      if (!nombre) {
        throw new BadRequestException('El nombre del negocio no puede estar vac├¡o');
      }
      updates.nombre = nombre;
    }
    if (dto.razon_social !== undefined) updates.razonSocial = str(dto.razon_social);
    if (dto.cuit !== undefined) updates.cuit = str(dto.cuit);
    if (dto.domicilio !== undefined) updates.domicilio = str(dto.domicilio);
    if (dto.telefono !== undefined) updates.telefono = str(dto.telefono);
    if (dto.horarios_atencion !== undefined) updates.horariosAtencion = str(dto.horarios_atencion);
    if (dto.email !== undefined) updates.email = str(dto.email);
    if (dto.condicion_iva !== undefined) updates.condicionIva = dto.condicion_iva as CondicionIva;
    if (dto.punto_de_venta !== undefined) updates.puntoDeVenta = Number(dto.punto_de_venta) || 1;
    if (dto.codigo_acceso !== undefined) updates.codigoAcceso = str(dto.codigo_acceso);

    return updates;
  }

  private serializeTenant(t: Tenant) {
    return {
      id: t.id,
      nombre: t.nombre,
      codigoAcceso: t.codigoAcceso,
      codigo_acceso: t.codigoAcceso,
      razonSocial: t.razonSocial,
      razon_social: t.razonSocial,
      cuit: t.cuit,
      domicilio: t.domicilio,
      telefono: t.telefono,
      email: t.email,
      horariosAtencion: t.horariosAtencion,
      horarios_atencion: t.horariosAtencion,
      logoUrl: t.logoUrl,
      logo_url: t.logoUrl,
      puntoDeVenta: t.puntoDeVenta,
      punto_de_venta: t.puntoDeVenta,
      condicionIva: t.condicionIva,
      condicion_iva: t.condicionIva,
      plan: t.plan,
      activo: t.activo,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  private serializeTenantSnake(t: Tenant) {
    return {
      id: t.id,
      nombre: t.nombre,
      codigo_acceso: t.codigoAcceso,
      razon_social: t.razonSocial,
      cuit: t.cuit,
      domicilio: t.domicilio,
      telefono: t.telefono,
      email: t.email,
      horarios_atencion: t.horariosAtencion,
      logo_url: t.logoUrl,
      punto_de_venta: t.puntoDeVenta,
      condicion_iva: t.condicionIva,
      plan: t.plan,
      activo: t.activo,
      created_at: t.createdAt.toISOString(),
      updated_at: t.updatedAt.toISOString(),
    };
  }

  private serializeModulos(m: ModuloConfig) {
    return {
      tenantId: m.tenantId,
      stock: m.stock,
      importadorExcel: m.importadorExcel,
      facturadorSimple: m.facturadorSimple,
      facturadorArca: m.facturadorArca,
      facturadorPos: m.facturadorPos,
      pedidos: m.pedidos,
      presupuestos: m.presupuestos,
      iaPrecios: m.iaPrecios,
      analizadorRentabilidad: m.analizadorRentabilidad,
      updatedAt: m.updatedAt.toISOString(),
    };
  }
}
