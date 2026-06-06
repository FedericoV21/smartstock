import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { LegacyFieldCryptoService } from '../common/crypto/legacy-field-crypto.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import type { PatchMpPointConfigDto } from './dto/mp-point-config.dto';
import { MpPointConfig } from './entities/mp-point-config.entity';

export type MpPointConfigSecrets = {
  accessToken: string | null;
  deviceId: string | null;
  webhookSecret: string | null;
  habilitado: boolean;
};

@Injectable()
export class MpPointConfigService {
  constructor(
    @InjectRepository(MpPointConfig)
    private readonly configRepo: Repository<MpPointConfig>,
    @InjectRepository(ModuloConfig)
    private readonly moduloConfigRepo: Repository<ModuloConfig>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
    private readonly fieldCrypto: LegacyFieldCryptoService,
  ) {}

  async ensureFacturadorPos(): Promise<void> {
    await this.assertFacturadorPos();
  }

  async getPublicConfig(sucursalIdParam: string | undefined, isAdmin: boolean) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.resolveSucursalIdForRead(sucursalIdParam);
    const row = await this.loadRow(tenantId, sucursalId);

    const empty = {
      habilitado: true,
      device_id: null as string | null,
      access_token_configurado: false,
      access_token_preview: null as string | null,
      webhook_secret_configurado: false,
    };

    if (!row) {
      return isAdmin ? empty : this.maskForNonAdmin(empty);
    }

    const payload = {
      habilitado: row.habilitado,
      device_id: row.deviceId,
      access_token_configurado: Boolean(row.accessToken),
      access_token_preview: isAdmin ? this.buildAccessTokenPreview(row.accessToken) : null,
      webhook_secret_configurado: Boolean(row.webhookSecret?.trim()),
    };

    return isAdmin ? payload : this.maskForNonAdmin(payload);
  }

  async patchConfig(dto: PatchMpPointConfigDto, sucursalIdParam: string | undefined) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.requireSucursalIdForWrite(sucursalIdParam);
    await this.assertSucursalBelongsToTenant(tenantId, sucursalId);

    const updates: Partial<MpPointConfig> = {};
    if (dto.habilitado !== undefined) updates.habilitado = Boolean(dto.habilitado);
    if (dto.device_id !== undefined) {
      updates.deviceId =
        dto.device_id === '' || dto.device_id === null ? null : String(dto.device_id).trim();
    }
    if (dto.access_token !== undefined && dto.access_token !== '') {
      updates.accessToken = this.fieldCrypto.encrypt(dto.access_token.trim());
    }
    if (dto.webhook_secret !== undefined) {
      updates.webhookSecret =
        dto.webhook_secret === '' || dto.webhook_secret === null
          ? null
          : dto.webhook_secret.trim();
    }

    if (Object.keys(updates).length === 0) {
      return { ok: true };
    }

    let row = await this.configRepo.findOne({ where: { tenantId, sucursalId } });
    if (row) {
      Object.assign(row, updates);
    } else {
      row = this.configRepo.create({
        tenantId,
        sucursalId,
        habilitado: updates.habilitado ?? true,
        accessToken: updates.accessToken ?? null,
        deviceId: updates.deviceId ?? null,
        webhookSecret: updates.webhookSecret ?? null,
        lastPaymentIntentId: null,
      });
    }

    await this.configRepo.save(row);
    return { ok: true };
  }

  async deleteConfig(sucursalIdParam: string | undefined) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.requireSucursalIdForWrite(sucursalIdParam);
    await this.configRepo.delete({ tenantId, sucursalId });
    return { ok: true };
  }

  /** Uso interno (NB-MPP-002+): credenciales descifradas para la sucursal. */
  async loadSecretsForSucursal(sucursalId: string): Promise<MpPointConfigSecrets | null> {
    const tenantId = this.tenantContext.getTenantId();
    const row = await this.loadRow(tenantId, sucursalId);
    if (!row) return null;
    return {
      accessToken: this.fieldCrypto.tryDecrypt(row.accessToken),
      deviceId: row.deviceId,
      webhookSecret: row.webhookSecret?.trim() || null,
      habilitado: row.habilitado,
    };
  }

  private async loadRow(
    tenantId: string,
    sucursalId: string | null,
  ): Promise<MpPointConfig | null> {
    if (sucursalId) {
      return this.configRepo.findOne({ where: { tenantId, sucursalId } });
    }
    const rows = await this.configRepo.find({
      where: { tenantId },
      order: { createdAt: 'ASC' },
      take: 1,
    });
    return rows[0] ?? null;
  }

  private buildAccessTokenPreview(encrypted: string | null): string | null {
    if (!encrypted) return null;
    const plain = this.fieldCrypto.tryDecrypt(encrypted);
    if (plain && plain.length >= 4) return `ÔÇª${plain.slice(-4)}`;
    if (encrypted.length >= 4) return `ÔÇª${encrypted.slice(-4)}`;
    return null;
  }

  private maskForNonAdmin<T extends { access_token_configurado: boolean; access_token_preview: string | null; webhook_secret_configurado: boolean }>(
    payload: T,
  ): T {
    return {
      ...payload,
      access_token_configurado: false,
      access_token_preview: null,
      webhook_secret_configurado: false,
    };
  }

  private async assertFacturadorPos(): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const mod = await this.moduloConfigRepo.findOne({ where: { tenantId } });
    if (!mod?.facturadorPos) {
      throw new ForbiddenException("El m├│dulo 'facturador_pos' no est├í habilitado para tu plan.");
    }
  }

  private async resolveSucursalIdForRead(sucursalIdParam: string | undefined): Promise<string | null> {
    if (sucursalIdParam?.trim()) {
      return sucursalIdParam.trim();
    }
    return this.sucursalContext.resolveSucursalId();
  }

  private async requireSucursalIdForWrite(sucursalIdParam: string | undefined): Promise<string> {
    const fromQuery = sucursalIdParam?.trim();
    if (fromQuery) return fromQuery;
    const resolved = await this.sucursalContext.resolveSucursalId();
    if (!resolved) {
      throw new BadRequestException('No hay sucursal activa');
    }
    return resolved;
  }

  private async assertSucursalBelongsToTenant(tenantId: string, sucursalId: string): Promise<void> {
    const ok = await this.sucursalRepo.exist({ where: { id: sucursalId, tenantId, activa: true } });
    if (!ok) {
      throw new NotFoundException('Sucursal no encontrada o inactiva.');
    }
  }
}
