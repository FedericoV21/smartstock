import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { UpsertArcaConfigDto } from './dto/upsert-arca-config.dto';
import { ArcaConfig } from './entities/arca-config.entity';
import { ArcaAmbiente } from './enums/arca-ambiente.enum';
import { ArcaCryptoService } from './crypto/arca-crypto.service';

const KEEP_EXISTING = '__KEEP_EXISTING__';

@Injectable()
export class ArcaService {
  constructor(
    @InjectRepository(ArcaConfig)
    private readonly arcaConfigRepo: Repository<ArcaConfig>,
    @InjectRepository(ModuloConfig)
    private readonly moduloConfigRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
    private readonly crypto: ArcaCryptoService,
  ) {}

  async getConfig() {
    await this.assertFacturadorArcaEnabled();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = await this.sucursalContext.requireSucursalId();
    const row = await this.arcaConfigRepo.findOne({ where: { tenantId, sucursalId } });

    if (!row) {
      return {
        data: {
          tenantId,
          sucursalId,
          ambiente: ArcaAmbiente.homologacion,
          cuitEmisor: null,
          puntoDeVenta: null,
          hasCertificado: false,
          hasClavePrivada: false,
          ticketExpiracion: null,
          updatedAt: null,
        },
      };
    }

    return {
      data: {
        tenantId: row.tenantId,
        sucursalId: row.sucursalId,
        ambiente: row.ambiente,
        cuitEmisor: row.cuitEmisor,
        puntoDeVenta: row.puntoDeVenta,
        hasCertificado: Boolean(row.certificadoPem),
        hasClavePrivada: Boolean(row.clavePrivadaPem),
        ticketExpiracion: row.ticketExpiracion?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
      },
    };
  }

  async upsertConfig(dto: UpsertArcaConfigDto) {
    await this.assertFacturadorArcaEnabled();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId =
      dto.sucursalId?.trim() || (await this.sucursalContext.requireSucursalId());

    const existing = await this.arcaConfigRepo.findOne({ where: { tenantId, sucursalId } });
    const row = existing ?? this.arcaConfigRepo.create({ tenantId, sucursalId });

    const isKeepCert = dto.certificadoPem === KEEP_EXISTING;
    const isKeepKey = dto.clavePrivadaPem === KEEP_EXISTING;

    if (
      !existing &&
      (isKeepCert ||
        isKeepKey ||
        !dto.certificadoPem ||
        !dto.clavePrivadaPem ||
        dto.certificadoPem === KEEP_EXISTING ||
        dto.clavePrivadaPem === KEEP_EXISTING)
    ) {
      throw new BadRequestException(
        'El certificado y la clave privada son obligatorios en la primera configuraci├│n.',
      );
    }

    if (dto.certificadoPem !== undefined && !isKeepCert) {
      row.certificadoPem = dto.certificadoPem ? this.crypto.encrypt(dto.certificadoPem) : null;
    }
    if (dto.clavePrivadaPem !== undefined && !isKeepKey) {
      row.clavePrivadaPem = dto.clavePrivadaPem ? this.crypto.encrypt(dto.clavePrivadaPem) : null;
    }
    if (dto.cuitEmisor !== undefined) {
      const cuitLimpio = dto.cuitEmisor.replace(/[-\s]/g, '');
      if (cuitLimpio.length !== 11 || !/^\d+$/.test(cuitLimpio)) {
        throw new BadRequestException('CUIT inv├ílido (debe tener 11 d├¡gitos).');
      }
      row.cuitEmisor = cuitLimpio;
    }
    if (dto.puntoDeVenta !== undefined) row.puntoDeVenta = dto.puntoDeVenta ?? null;

    if (dto.ambiente !== undefined) {
      if (existing && existing.ambiente !== dto.ambiente) {
        row.ticketAcceso = null;
        row.ticketSign = null;
        row.ticketExpiracion = null;
      }
      row.ambiente = dto.ambiente;
    }

    const saved = await this.arcaConfigRepo.save(row);
    return {
      data: {
        tenantId: saved.tenantId,
        sucursalId: saved.sucursalId,
        ambiente: saved.ambiente,
        cuitEmisor: saved.cuitEmisor,
        puntoDeVenta: saved.puntoDeVenta,
        hasCertificado: Boolean(saved.certificadoPem),
        hasClavePrivada: Boolean(saved.clavePrivadaPem),
        updatedAt: saved.updatedAt.toISOString(),
      },
    };
  }

  async findConfigOrThrow(tenantId: string, sucursalId: string): Promise<ArcaConfig> {
    const row = await this.arcaConfigRepo.findOne({ where: { tenantId, sucursalId } });
    if (!row) {
      throw new NotFoundException('Configuraci├│n ARCA no encontrada para la sucursal.');
    }
    return row;
  }

  async assertFacturadorArcaEnabled(): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const modulos = await this.moduloConfigRepo.findOne({ where: { tenantId } });
    if (!modulos?.facturadorArca) {
      throw new BadRequestException('El facturador ARCA no est├í habilitado.');
    }
  }
}
