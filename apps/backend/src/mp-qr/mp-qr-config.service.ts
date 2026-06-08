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
import type { PatchMpQrConfigDto, VerificarMpQrConfigDto } from './dto/mp-qr-config.dto';
import { MpQrConfig } from './entities/mp-qr-config.entity';
import { runMpQrVerificacionMpQr } from './utils/verificar-mp-qr.util';

export type MpQrConfigSecrets = {
  accessToken: string | null;
  userId: string | null;
  externalPosId: string | null;
  webhookSecret: string | null;
  habilitado: boolean;
};

@Injectable()
export class MpQrConfigService {
  constructor(
    @InjectRepository(MpQrConfig)
    private readonly configRepo: Repository<MpQrConfig>,
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
      habilitado: false,
      transferencia_habilitada: false,
      user_id: null as string | null,
      external_pos_id: null as string | null,
      access_token_configurado: false,
      access_token_preview: null as string | null,
      webhook_secret_configurado: false,
    };

    if (!row) {
      return isAdmin ? empty : this.maskForNonAdmin(empty);
    }

    const payload = {
      habilitado: row.habilitado,
      transferencia_habilitada: row.transferenciaHabilitada,
      user_id: row.userId,
      external_pos_id: row.externalPosId,
      access_token_configurado: Boolean(row.accessToken),
      access_token_preview: isAdmin ? this.buildAccessTokenPreview(row.accessToken) : null,
      webhook_secret_configurado: Boolean(row.webhookSecret?.trim()),
    };

    return isAdmin ? payload : this.maskForNonAdmin(payload);
  }

  async patchConfig(dto: PatchMpQrConfigDto, sucursalIdParam: string | undefined) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.requireSucursalIdForWrite(sucursalIdParam);
    await this.assertSucursalBelongsToTenant(tenantId, sucursalId);

    const updates: Partial<MpQrConfig> = {};
    if (dto.habilitado !== undefined) updates.habilitado = Boolean(dto.habilitado);
    if (dto.transferencia_habilitada !== undefined) {
      updates.transferenciaHabilitada = Boolean(dto.transferencia_habilitada);
    }
    if (dto.user_id !== undefined) {
      updates.userId =
        dto.user_id === '' || dto.user_id === null ? null : String(dto.user_id).trim();
    }
    if (dto.external_pos_id !== undefined) {
      updates.externalPosId =
        dto.external_pos_id === '' || dto.external_pos_id === null
          ? null
          : String(dto.external_pos_id).trim();
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
        habilitado: updates.habilitado ?? false,
        accessToken: updates.accessToken ?? null,
        userId: updates.userId ?? null,
        externalPosId: updates.externalPosId ?? null,
        webhookSecret: updates.webhookSecret ?? null,
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

  async verificarConfig(dto: VerificarMpQrConfigDto, sucursalIdParam: string | undefined) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.resolveSucursalIdForRead(sucursalIdParam);

    let accessToken = dto.access_token?.trim() ?? '';
    if (!accessToken && sucursalId) {
      const secrets = await this.loadSecretsForTenantSucursal(tenantId, sucursalId);
      accessToken = secrets?.accessToken ?? '';
    }
    if (!accessToken) {
      throw new BadRequestException(
        'access_token es obligatorio o guardá uno en configuración antes de verificar.',
      );
    }

    return runMpQrVerificacionMpQr({
      access_token: accessToken,
      user_id: dto.user_id.trim(),
      external_pos_id: dto.external_pos_id.trim(),
    });
  }

  async loadTransferenciaAccessToken(
    sucursalId: string,
  ): Promise<{ ok: true; token: string } | { ok: false; status: number; error: string }> {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const row = await this.loadRow(tenantId, sucursalId);
    if (!row?.transferenciaHabilitada) {
      return {
        ok: false,
        status: 403,
        error:
          'El verificador de Transferencia MP está deshabilitado. Activalo en Configuración → MP QR (transferencia_habilitada).',
      };
    }
    const token = this.fieldCrypto.tryDecrypt(row.accessToken);
    if (!token) {
      return {
        ok: false,
        status: 400,
        error:
          'Configuración de MP QR incompleta: falta Access Token para consultar transferencias.',
      };
    }
    return { ok: true, token };
  }

  async loadSecretsForSucursal(sucursalId: string): Promise<MpQrConfigSecrets | null> {
    const tenantId = this.tenantContext.getTenantId();
    return this.loadSecretsForTenantSucursal(tenantId, sucursalId);
  }

  async loadSecretsForTenantSucursal(
    tenantId: string,
    sucursalId: string,
  ): Promise<MpQrConfigSecrets | null> {
    const row = await this.loadRow(tenantId, sucursalId);
    if (!row) return null;
    return {
      accessToken: this.fieldCrypto.tryDecrypt(row.accessToken),
      userId: row.userId,
      externalPosId: row.externalPosId,
      webhookSecret: row.webhookSecret?.trim() || null,
      habilitado: row.habilitado,
    };
  }

  private async loadRow(tenantId: string, sucursalId: string | null): Promise<MpQrConfig | null> {
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
    if (plain && plain.length >= 4) return `…${plain.slice(-4)}`;
    if (encrypted.length >= 4) return `…${encrypted.slice(-4)}`;
    return null;
  }

  private maskForNonAdmin<
    T extends {
      access_token_configurado: boolean;
      access_token_preview: string | null;
      webhook_secret_configurado: boolean;
    },
  >(payload: T): T {
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
      throw new ForbiddenException("El módulo 'facturador_pos' no está habilitado para tu plan.");
    }
  }

  private async resolveSucursalIdForRead(sucursalIdParam: string | undefined): Promise<string | null> {
    if (sucursalIdParam?.trim()) return sucursalIdParam.trim();
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
