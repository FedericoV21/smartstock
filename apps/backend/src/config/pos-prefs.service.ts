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
import { Sucursal } from '../branches/entities/sucursal.entity';
import { ModuloConfig } from './entities/modulo-config.entity';
import { Tenant } from './entities/tenant.entity';
import type { PatchPosPrefsDto } from './dto/pos-prefs.dto';
import {
  resolveEmisorTicket,
  type SucursalEmisorTicket,
  type TenantEmisorTicket,
} from './utils/emisor-ticket.util';
import {
  clampPosPrefsForArca,
  effectivePosPrefsFromRows,
  finalizePosPrefsForStorage,
  isPosPrefsPayload,
  normalizePosPrefs,
  posPrefsSucursalDiffForStorage,
  posPrefsSucursalParaGuardar,
  sucursalTieneOverrideBalanza,
  type PosPrefs,
} from './utils/pos-prefs.util';

@Injectable()
export class PosPrefsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(ModuloConfig)
    private readonly moduloRepo: Repository<ModuloConfig>,
    @InjectRepository(ArcaConfig)
    private readonly arcaRepo: Repository<ArcaConfig>,
    private readonly tenantContext: TenantContext,
  ) {}

  async get(forConfig: boolean, requestedSucursalId?: string | null) {
    const tenantId = this.tenantContext.getTenantId();
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    const tenantNorm = normalizePosPrefs(tenant.posPrefs);
    const tenantEmisor = this.mapTenantEmisor(tenant);

    if (forConfig) {
      let outSucursalId: string | null = null;
      let sucursalPosPrefs: unknown | null = null;
      let sucursalEmisor: SucursalEmisorTicket | null = null;

      if (requestedSucursalId) {
        const s = await this.sucursalRepo.findOne({ where: { id: requestedSucursalId, tenantId } });
        if (!s) throw new NotFoundException('Sucursal no encontrada.');
        outSucursalId = requestedSucursalId;
        sucursalPosPrefs = s.posPrefs ?? null;
        sucursalEmisor = this.mapSucursalEmisor(s);
      }

      const arcaOk = outSucursalId
        ? await this.arcaConfiguradoForSucursal(tenantId, outSucursalId)
        : await this.arcaConfiguradoAlgunaSucursal(tenantId);

      const effective = clampPosPrefsForArca(
        effectivePosPrefsFromRows(tenant.posPrefs, outSucursalId ? sucursalPosPrefs : null),
        arcaOk,
      );

      return {
        arca_configurado: arcaOk,
        sucursal_id: outSucursalId,
        tenant_pos_prefs: tenantNorm,
        sucursal_pos_prefs: outSucursalId ? sucursalPosPrefs : null,
        effective_pos_prefs: effective,
        emisor_ticket: resolveEmisorTicket(tenantEmisor, sucursalEmisor),
      };
    }

    const sucursalId = requestedSucursalId?.trim() || null;
    let sucursalPosPrefs: unknown | null = null;
    let sucursalEmisor: SucursalEmisorTicket | null = null;

    if (sucursalId) {
      const s = await this.sucursalRepo.findOne({ where: { id: sucursalId, tenantId } });
      if (s) {
        sucursalPosPrefs = s.posPrefs ?? null;
        sucursalEmisor = this.mapSucursalEmisor(s);
      }
    }

    const arcaOk = await this.arcaConfiguradoForSucursal(tenantId, sucursalId);
    const effective = clampPosPrefsForArca(
      effectivePosPrefsFromRows(tenant.posPrefs, sucursalPosPrefs),
      arcaOk,
    );

    return {
      arca_configurado: arcaOk,
      sucursal_id: sucursalId,
      tenant_pos_prefs: tenantNorm,
      sucursal_pos_prefs: sucursalPosPrefs,
      effective_pos_prefs: effective,
      emisor_ticket: resolveEmisorTicket(tenantEmisor, sucursalEmisor),
    };
  }

  async patch(dto: PatchPosPrefsDto, appRole: string | undefined) {
    const tenantId = this.tenantContext.getTenantId();

    if (dto.scope === 'tenant') {
      if (appRole !== 'admin') {
        throw new ForbiddenException('Solo el administrador puede editar los defaults del negocio.');
      }
      if (!dto.pos_prefs || !isPosPrefsPayload(dto.pos_prefs)) {
        throw new BadRequestException('pos_prefs inválido.');
      }
      const arcaOk = await this.arcaConfiguradoAlgunaSucursal(tenantId);
      const normalized = finalizePosPrefsForStorage(
        clampPosPrefsForArca(normalizePosPrefs(dto.pos_prefs), arcaOk),
      );
      const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
      if (!tenant) throw new NotFoundException('Tenant no encontrado');
      tenant.posPrefs = normalized as unknown as Record<string, unknown>;
      await this.tenantRepo.save(tenant);
      return { ok: true, pos_prefs: normalized };
    }

    const sucursalId = dto.sucursal_id?.trim();
    if (!sucursalId) {
      throw new BadRequestException(
        'Usá scope "tenant" + pos_prefs, o sucursal_id + pos_prefs / inherit_from_tenant.',
      );
    }

    if (appRole !== 'admin') {
      throw new ForbiddenException('Sin permisos para editar sucursales.');
    }

    const sucursal = await this.sucursalRepo.findOne({ where: { id: sucursalId, tenantId } });
    if (!sucursal) throw new NotFoundException('Sucursal no encontrada.');

    if (dto.inherit_from_tenant === true) {
      sucursal.posPrefs = null;
      await this.sucursalRepo.save(sucursal);
      return { ok: true, pos_prefs: null };
    }

    if (!dto.pos_prefs || !isPosPrefsPayload(dto.pos_prefs)) {
      throw new BadRequestException('pos_prefs inválido.');
    }

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    let tenantNorm = finalizePosPrefsForStorage(normalizePosPrefs(tenant.posPrefs));
    const merged = posPrefsSucursalParaGuardar(tenantNorm, dto.pos_prefs as Partial<PosPrefs>);
    const arcaOk = await this.arcaConfiguradoForSucursal(tenantId, sucursalId);
    const normalized = finalizePosPrefsForStorage(clampPosPrefsForArca(merged, arcaOk));
    const balanzaOverride = sucursalTieneOverrideBalanza(tenantNorm, normalized);

    if (balanzaOverride && !tenantNorm.balanzaConfigPorSucursal) {
      tenantNorm = finalizePosPrefsForStorage({
        ...tenantNorm,
        balanzaConfigPorSucursal: true,
      });
      tenant.posPrefs = tenantNorm as unknown as Record<string, unknown>;
      await this.tenantRepo.save(tenant);
    }

    const valueToStore = posPrefsSucursalDiffForStorage(tenantNorm, normalized);
    sucursal.posPrefs = valueToStore;
    await this.sucursalRepo.save(sucursal);

    const effectiveAfter = effectivePosPrefsFromRows(tenantNorm, valueToStore);
    return {
      ok: true,
      pos_prefs: valueToStore,
      inherited: valueToStore === null,
      balanza_override: balanzaOverride,
      balanza_config_por_sucursal: tenantNorm.balanzaConfigPorSucursal === true,
      effective_balanza_templates: effectiveAfter.balanzaTemplates,
    };
  }

  async listBalanzaSucursales() {
    const tenantId = this.tenantContext.getTenantId();
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    const tenantNorm = finalizePosPrefsForStorage(normalizePosPrefs(tenant.posPrefs));
    const sucursales = await this.sucursalRepo.find({
      where: { tenantId },
      order: { codigo: 'ASC' },
    });

    const rows = sucursales.map((s) => {
      const effective = effectivePosPrefsFromRows(tenant.posPrefs, s.posPrefs ?? null);
      return {
        sucursal_id: s.id,
        nombre: s.nombre,
        codigo: s.codigo,
        sucursal_pos_prefs: s.posPrefs ?? null,
        effective_pos_prefs: effective,
        balanza_override: sucursalTieneOverrideBalanza(tenantNorm, effective),
      };
    });

    return {
      tenant_pos_prefs: tenantNorm,
      balanza_config_por_sucursal: tenantNorm.balanzaConfigPorSucursal === true,
      sucursales: rows,
    };
  }

  private mapTenantEmisor(t: Tenant): TenantEmisorTicket {
    return {
      nombre: t.nombre,
      razon_social: t.razonSocial,
      cuit: t.cuit,
      domicilio: t.domicilio,
      logo_url: t.logoUrl,
    };
  }

  private mapSucursalEmisor(s: Sucursal): SucursalEmisorTicket {
    return {
      nombre: s.nombre,
      direccion: s.direccion,
      hereda_datos_ticket: s.heredaDatosTicket !== false,
      razon_social: s.razonSocial,
      cuit: s.cuit,
      telefono: s.telefono,
      horarios_atencion: s.horariosAtencion,
      email: s.email,
    };
  }

  private async arcaModuloActivo(tenantId: string): Promise<boolean> {
    const mod = await this.moduloRepo.findOne({ where: { tenantId } });
    return !!mod?.facturadorArca;
  }

  private async arcaConfiguradoForSucursal(
    tenantId: string,
    sucursalId: string | null,
  ): Promise<boolean> {
    if (!(await this.arcaModuloActivo(tenantId)) || !sucursalId) return false;
    const arca = await this.arcaRepo.findOne({ where: { tenantId, sucursalId } });
    return !!(
      arca?.certificadoPem &&
      arca?.clavePrivadaPem &&
      arca?.cuitEmisor &&
      arca?.puntoDeVenta != null
    );
  }

  private async arcaConfiguradoAlgunaSucursal(tenantId: string): Promise<boolean> {
    if (!(await this.arcaModuloActivo(tenantId))) return false;
    const rows = await this.arcaRepo.find({ where: { tenantId } });
    return rows.some(
      (r) => r.certificadoPem && r.clavePrivadaPem && r.cuitEmisor && r.puntoDeVenta != null,
    );
  }
}
