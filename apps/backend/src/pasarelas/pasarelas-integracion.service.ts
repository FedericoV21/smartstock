import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { LegacyFieldCryptoService } from '../common/crypto/legacy-field-crypto.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { MpPointConfig } from '../mp-point/entities/mp-point-config.entity';
import { MpQrConfig } from '../mp-qr/entities/mp-qr-config.entity';
import { PasarelaAdaptersService } from './pasarela-adapters.service';
import {
  PasarelaIntegracion,
  type PasarelaCanal,
  type PasarelaEstado,
} from './entities/pasarela-integracion.entity';
import { PasarelaTransaccion } from './entities/pasarela-transaccion.entity';
import {
  CreatePasarelaIntegracionDto,
  PatchPasarelaIntegracionDto,
  PatchPasarelaIntegracionByIdDto,
} from './dto/pasarela-integracion.dto';
import {
  PASARELA_CANALES,
  PASARELA_ESTADOS,
  TRANSACCION_ESTADOS_ACTIVOS,
  cleanSlug,
  encryptSecretsRecord,
  jsonRecord,
  serializeIntegracion,
} from './utils/pasarela-secrets.util';

@Injectable()
export class PasarelasIntegracionService {
  constructor(
    @InjectRepository(PasarelaIntegracion)
    private readonly integracionRepo: Repository<PasarelaIntegracion>,
    @InjectRepository(PasarelaTransaccion)
    private readonly transaccionRepo: Repository<PasarelaTransaccion>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(ModuloConfig)
    private readonly moduloConfigRepo: Repository<ModuloConfig>,
    @InjectRepository(MpPointConfig)
    private readonly mpPointConfigRepo: Repository<MpPointConfig>,
    @InjectRepository(MpQrConfig)
    private readonly mpQrConfigRepo: Repository<MpQrConfig>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
    private readonly fieldCrypto: LegacyFieldCryptoService,
    private readonly adapters: PasarelaAdaptersService,
  ) {}

  async list(sucursalIdParam?: string, operableSucursalIds?: string[]) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = sucursalIdParam?.trim() || null;

    if (sucursalId) {
      await this.assertSucursalScope(sucursalId, operableSucursalIds);
      const rows = await this.integracionRepo.find({
        where: { tenantId, sucursalId },
        order: { nombre: 'ASC' },
      });
      return { integraciones: rows.map(serializeIntegracion) };
    }

    const ids = operableSucursalIds ?? [];
    if (ids.length === 0) return { integraciones: [] };

    const rows = await this.integracionRepo.find({
      where: { tenantId, sucursalId: In(ids) },
      order: { nombre: 'ASC' },
    });
    return { integraciones: rows.map(serializeIntegracion) };
  }

  async getById(id: string, operableSucursalIds?: string[]) {
    const row = await this.findIntegracionOrThrow(id);
    await this.assertSucursalScope(row.sucursalId, operableSucursalIds);
    return { integracion: serializeIntegracion(row) };
  }

  async create(dto: CreatePasarelaIntegracionDto) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = dto.sucursal_id.trim();
    await this.assertSucursalBelongsToTenant(tenantId, sucursalId);

    const proveedor = cleanSlug(dto.proveedor);
    const tipo = cleanSlug(dto.tipo);
    const canal = this.cleanCanal(dto.canal);
    const nombre = this.cleanNombre(dto.nombre);
    if (!proveedor || !tipo || !canal || !nombre) {
      throw new BadRequestException('proveedor, tipo, canal y nombre son obligatorios');
    }

    const estado = this.cleanEstado(dto.estado, 'incompleta');
    const entity = this.integracionRepo.create({
      tenantId,
      sucursalId,
      proveedor,
      tipo,
      canal,
      nombre,
      estado,
      configPublica: jsonRecord(dto.config_publica),
      secretosCifrados: encryptSecretsRecord(this.fieldCrypto, dto.secretos),
    });

    if (estado === 'activa') {
      const validation = this.adapters.validateConfig(entity);
      if (!validation.ok) throw new BadRequestException(validation.error);
    }

    const saved = await this.integracionRepo.save(entity);
    return { integracion: serializeIntegracion(saved) };
  }

  async patch(dto: PatchPasarelaIntegracionDto) {
    await this.assertFacturadorPos();
    const row = await this.findIntegracionOrThrow(dto.id);
    return this.applyPatch(row, dto);
  }

  async patchById(id: string, dto: PatchPasarelaIntegracionByIdDto) {
    await this.assertFacturadorPos();
    const row = await this.findIntegracionOrThrow(id);
    return this.applyPatch(row, dto);
  }

  async delete(id: string) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const row = await this.findIntegracionOrThrow(id);

    const activas = await this.transaccionRepo.count({
      where: {
        tenantId,
        integracionId: id,
        estado: In(TRANSACCION_ESTADOS_ACTIVOS),
      },
    });
    if (activas > 0) {
      throw new ConflictException('No se puede borrar una integracion con cobros activos.');
    }

    await this.integracionRepo.delete({ id, tenantId });
    await this.desactivarConfigLegacy(tenantId, row);
    return { ok: true };
  }

  async verificar(
    id: string,
    body: { config_publica?: Record<string, unknown>; secretos?: Record<string, unknown> },
  ) {
    await this.assertFacturadorPos();
    const row = await this.findIntegracionOrThrow(id);
    return this.adapters.verifyConfig(row, {
      configPublica: body.config_publica,
      secretos: body.secretos,
    });
  }

  private async applyPatch(row: PasarelaIntegracion, dto: PatchPasarelaIntegracionByIdDto) {
    const patch: Partial<PasarelaIntegracion> = {};

    if (dto.nombre !== undefined) {
      const nombre = this.cleanNombre(dto.nombre);
      if (!nombre) throw new BadRequestException('nombre no puede quedar vacio');
      patch.nombre = nombre;
    }
    if (dto.estado !== undefined) patch.estado = this.cleanEstado(dto.estado, row.estado);
    if (dto.config_publica !== undefined) patch.configPublica = jsonRecord(dto.config_publica);
    if (dto.secretos !== undefined) {
      patch.secretosCifrados = {
        ...row.secretosCifrados,
        ...encryptSecretsRecord(this.fieldCrypto, dto.secretos),
      };
    }

    if (Object.keys(patch).length === 0) {
      return { integracion: serializeIntegracion(row) };
    }

    const next = { ...row, ...patch } as PasarelaIntegracion;
    if (patch.estado === 'activa') {
      const validation = this.adapters.validateConfig(next);
      if (!validation.ok) throw new BadRequestException(validation.error);
    }

    Object.assign(row, patch);
    const saved = await this.integracionRepo.save(row);
    return { integracion: serializeIntegracion(saved) };
  }

  private async findIntegracionOrThrow(id: string): Promise<PasarelaIntegracion> {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const row = await this.integracionRepo.findOne({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Integracion no encontrada');
    return row;
  }

  private async desactivarConfigLegacy(tenantId: string, row: PasarelaIntegracion): Promise<void> {
    const legacyId = row.legacyConfigId;
    if (!legacyId) return;
    if (row.origenLegacy === 'mp_point_config') {
      await this.mpPointConfigRepo.update({ tenantId, id: legacyId }, { habilitado: false });
    } else if (row.origenLegacy === 'mp_qr_config') {
      await this.mpQrConfigRepo.update({ tenantId, id: legacyId }, { habilitado: false });
    }
  }

  private cleanCanal(value: unknown): PasarelaCanal | null {
    return PASARELA_CANALES.includes(value as PasarelaCanal) ? (value as PasarelaCanal) : null;
  }

  private cleanEstado(value: unknown, fallback: PasarelaEstado): PasarelaEstado {
    return PASARELA_ESTADOS.includes(value as PasarelaEstado) ? (value as PasarelaEstado) : fallback;
  }

  private cleanNombre(value: unknown): string {
    return (typeof value === 'string' ? value.trim() : '').slice(0, 120);
  }

  private async assertSucursalScope(sucursalId: string, operableIds?: string[]) {
    if (operableIds && !operableIds.includes(sucursalId)) {
      throw new ForbiddenException('No podes operar esta sucursal.');
    }
  }

  private async assertSucursalBelongsToTenant(tenantId: string, sucursalId: string) {
    const ok = await this.sucursalRepo.exist({ where: { id: sucursalId, tenantId, activa: true } });
    if (!ok) throw new NotFoundException('Sucursal no encontrada o inactiva.');
  }

  private async assertFacturadorPos() {
    const tenantId = this.tenantContext.getTenantId();
    const mod = await this.moduloConfigRepo.findOne({ where: { tenantId } });
    if (!mod?.facturadorPos) {
      throw new ForbiddenException("El módulo 'facturador_pos' no está habilitado para tu plan.");
    }
  }

  async resolveSucursalForWrite(sucursalIdParam?: string): Promise<string> {
    const fromParam = sucursalIdParam?.trim();
    if (fromParam) return fromParam;
    const resolved = await this.sucursalContext.resolveSucursalId();
    if (!resolved) throw new BadRequestException('sucursal_id es obligatorio');
    return resolved;
  }
}
