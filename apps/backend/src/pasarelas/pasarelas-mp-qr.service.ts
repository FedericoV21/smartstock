import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { LegacyFieldCryptoService } from '../common/crypto/legacy-field-crypto.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { PasarelaAdaptersService } from './pasarela-adapters.service';
import { PasarelaIntegracion, type PasarelaEstado } from './entities/pasarela-integracion.entity';
import { MpQrPasarelaSetupDto, MpQrPasarelaStoresDto } from './dto/pasarela-caja.dto';
import {
  MpQrSetupError,
  getMpQrAccountInfo,
  listMpQrStores,
  prepareMpQrNexusSetup,
} from './utils/mp-qr-nexus-setup.util';
import {
  PASARELA_ESTADOS,
  encryptSecretsRecord,
  serializeIntegracion,
} from './utils/pasarela-secrets.util';

const MP_TRANSFERENCIA_HABILITADA_CONFIG_KEY = 'mp_transferencia_habilitada';

@Injectable()
export class PasarelasMpQrService {
  constructor(
    @InjectRepository(PasarelaIntegracion)
    private readonly integracionRepo: Repository<PasarelaIntegracion>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(ModuloConfig)
    private readonly moduloConfigRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
    private readonly fieldCrypto: LegacyFieldCryptoService,
    private readonly adapters: PasarelaAdaptersService,
  ) {}

  async listStores(dto: MpQrPasarelaStoresDto) {
    await this.assertFacturadorPos();
    const accessToken = dto.access_token.trim();
    if (!accessToken) throw new BadRequestException('access_token es obligatorio');
    try {
      const account = await getMpQrAccountInfo(accessToken);
      const stores = await listMpQrStores(accessToken, account.id);
      return { user: account, stores };
    } catch (e) {
      throw this.mapSetupError(e);
    }
  }

  async setup(dto: MpQrPasarelaSetupDto) {
    await this.assertFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const sucursalId = dto.sucursal_id.trim();
    await this.assertSucursalBelongsToTenant(tenantId, sucursalId);

    const accessToken = dto.access_token.trim();
    const storeId = dto.store_id.trim();
    if (!accessToken) throw new BadRequestException('access_token es obligatorio');
    if (!storeId) throw new BadRequestException('store_id es obligatorio');

    try {
      const setup = await prepareMpQrNexusSetup({ accessToken, storeId });
      const configPublica = {
        user_id: setup.account.id,
        external_pos_id: setup.pos.external_id,
        external_store_id: setup.external_store_id,
        mp_store_id: setup.store.id,
        mp_store_name: setup.store.name,
        mp_pos_id: setup.pos.id,
        mp_pos_name: setup.pos.name,
        [MP_TRANSFERENCIA_HABILITADA_CONFIG_KEY]: dto.mp_transferencia_habilitada === true,
      };
      const secretos: Record<string, string> = { access_token: accessToken };
      const webhookSecret = dto.webhook_secret?.trim();
      if (webhookSecret) secretos.webhook_secret = webhookSecret;

      const estado = this.cleanEstado(dto.estado, 'activa');
      const nombre = (dto.nombre?.trim() || 'Mercado Pago QR').slice(0, 120);

      const entity = this.integracionRepo.create({
        tenantId,
        sucursalId,
        proveedor: 'mercado_pago',
        canal: 'qr',
        tipo: 'mp_qr',
        nombre,
        estado,
        configPublica,
        secretosCifrados: encryptSecretsRecord(this.fieldCrypto, secretos),
      });

      if (estado === 'activa') {
        const validation = this.adapters.validateConfig(entity);
        if (!validation.ok) throw new BadRequestException(validation.error);
      }

      const saved = await this.integracionRepo.save(entity);
      return { integracion: serializeIntegracion(saved), mp: setup };
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw this.mapSetupError(e);
    }
  }

  private cleanEstado(value: unknown, fallback: PasarelaEstado): PasarelaEstado {
    return PASARELA_ESTADOS.includes(value as PasarelaEstado) ? (value as PasarelaEstado) : fallback;
  }

  private mapSetupError(error: unknown): HttpException {
    if (error instanceof MpQrSetupError) {
      const status = error.status >= 500 ? HttpStatus.SERVICE_UNAVAILABLE : error.status;
      return new HttpException(
        { error: error.message, code: error.code, details: error.details },
        status,
      );
    }
    return new HttpException({ error: 'No se pudo preparar Mercado Pago QR' }, HttpStatus.SERVICE_UNAVAILABLE);
  }

  private async assertSucursalBelongsToTenant(tenantId: string, sucursalId: string) {
    const ok = await this.sucursalRepo.exist({ where: { id: sucursalId, tenantId, activa: true } });
    if (!ok) throw new BadRequestException('Sucursal no encontrada o inactiva.');
  }

  private async assertFacturadorPos() {
    const tenantId = this.tenantContext.getTenantId();
    const mod = await this.moduloConfigRepo.findOne({ where: { tenantId } });
    if (!mod?.facturadorPos) {
      throw new ForbiddenException("El módulo 'facturador_pos' no está habilitado para tu plan.");
    }
  }
}
