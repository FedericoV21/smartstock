import { Injectable, Logger } from '@nestjs/common';

import { LegacyFieldCryptoService } from '../common/crypto/legacy-field-crypto.service';
import { MpPointError } from '../mp-point/errors/mp-point.error';
import { MpPointClientFactory } from '../mp-point/mp-point-client.factory';
import { resolveMpQrPos } from '../mp-qr/utils/resolve-mp-qr-pos.util';
import { runMpQrVerificacionMpQr } from '../mp-qr/utils/verificar-mp-qr.util';
import type { PasarelaIntegracion } from './entities/pasarela-integracion.entity';
import { getPasarelaSecret, stringFromUnknown } from './utils/pasarela-secrets.util';

export type PasarelaVerificacionCheck = {
  ok: boolean;
  mensaje: string;
  sugerencia?: string;
  [key: string]: unknown;
};

export type PasarelaVerificacionResult = {
  ok: boolean;
  mensaje?: string;
  checks?: Record<string, PasarelaVerificacionCheck>;
  detalles?: Record<string, unknown>;
};

@Injectable()
export class PasarelaAdaptersService {
  private readonly logger = new Logger(PasarelaAdaptersService.name);

  constructor(
    private readonly fieldCrypto: LegacyFieldCryptoService,
    private readonly mpPointClientFactory: MpPointClientFactory,
  ) {}

  validateConfig(integracion: PasarelaIntegracion): { ok: true } | { ok: false; error: string } {
    const adapter = this.getAdapter(integracion.tipo);
    if (!adapter) return { ok: false, error: 'Tipo de pasarela no soportado' };
    return adapter.validate(integracion);
  }

  async verifyConfig(
    integracion: PasarelaIntegracion,
    overrides?: { configPublica?: Record<string, unknown>; secretos?: Record<string, unknown> },
  ): Promise<PasarelaVerificacionResult> {
    const merged: PasarelaIntegracion = {
      ...integracion,
      configPublica: { ...integracion.configPublica, ...(overrides?.configPublica ?? {}) },
      secretosCifrados: {
        ...integracion.secretosCifrados,
        ...(overrides?.secretos ?? {}),
      },
    };
    const adapter = this.getAdapter(integracion.tipo);
    if (!adapter?.verify) {
      return this.verificacionIncompleta('Esta pasarela no tiene verificacion disponible');
    }
    const validation = adapter.validate(merged);
    if (!validation.ok) return this.verificacionIncompleta(validation.error);
    return adapter.verify(merged);
  }

  private getAdapter(tipo: string) {
    if (tipo === 'mp_point') return this.mpPointAdapter();
    if (tipo === 'mp_qr') return this.mpQrAdapter();
    return null;
  }

  private verificacionIncompleta(mensaje: string): PasarelaVerificacionResult {
    return {
      ok: false,
      mensaje,
      checks: { configuracion: { ok: false, mensaje } },
    };
  }

  private configString(integracion: PasarelaIntegracion, key: string): string | null {
    return stringFromUnknown(integracion.configPublica?.[key]);
  }

  private mpPointAdapter() {
    return {
      validate: (integracion: PasarelaIntegracion) => {
        const token = getPasarelaSecret(this.fieldCrypto, integracion, 'access_token');
        const deviceId = this.configString(integracion, 'device_id');
        if (!token || !deviceId) return { ok: false as const, error: 'Configuracion de MP Point incompleta' };
        return { ok: true as const };
      },
      verify: async (integracion: PasarelaIntegracion): Promise<PasarelaVerificacionResult> => {
        const accessToken = getPasarelaSecret(this.fieldCrypto, integracion, 'access_token');
        const deviceId = this.configString(integracion, 'device_id');
        if (!accessToken || !deviceId) {
          return this.verificacionIncompleta('Configuracion de MP Point incompleta');
        }
        try {
          const client = this.mpPointClientFactory.create(accessToken);
          const devices = await client.listDevices();
          const tokenCheck = {
            ok: true,
            mensaje: `Token valido. Mercado Pago devolvio ${devices.length} terminal(es).`,
          };
          const device = devices.find((d) => d.id === deviceId);
          if (!device) {
            const disponibles = devices.map((d) => d.id).filter(Boolean).join(', ');
            return {
              ok: false,
              mensaje: 'No se encontro la terminal configurada en Mercado Pago.',
              checks: {
                token_valido: tokenCheck,
                terminal_existe: {
                  ok: false,
                  mensaje: disponibles
                    ? `No se encontro Device ID "${deviceId}". Disponibles: ${disponibles}`
                    : `No se encontro Device ID "${deviceId}".`,
                  sugerencia:
                    'Copia el Device ID exacto desde Mercado Pago Point o elegilo desde el listado.',
                },
                modo_pdv: { ok: false, mensaje: 'No ejecutado: la terminal no existe.' },
              },
            };
          }
          const terminalOk = {
            ok: true,
            mensaje: `Terminal encontrada${device.name ? `: ${device.name}` : ''}.`,
            device_id: device.id,
            pos_id: device.pos_id,
            external_pos_id: device.external_pos_id,
          };
          if (device.operating_mode === 'STANDALONE') {
            return {
              ok: false,
              mensaje: 'La terminal esta en modo autonomo.',
              checks: {
                token_valido: tokenCheck,
                terminal_existe: terminalOk,
                modo_pdv: {
                  ok: false,
                  mensaje: 'La terminal esta en modo STANDALONE.',
                  sugerencia: 'Cambiala a modo PDV desde la app o el panel de Mercado Pago.',
                },
              },
            };
          }
          return {
            ok: true,
            mensaje: 'Conexion MP Point verificada.',
            checks: {
              token_valido: tokenCheck,
              terminal_existe: terminalOk,
              modo_pdv: { ok: true, mensaje: 'La terminal esta en modo PDV.' },
            },
          };
        } catch (e) {
          if (e instanceof MpPointError) {
            const mensaje = e.status === 401 ? 'Token de MP invalido o vencido' : e.message;
            return {
              ok: false,
              mensaje,
              checks: {
                token_valido: { ok: false, mensaje },
                terminal_existe: { ok: false, mensaje: 'No ejecutado: fallo la validacion del token.' },
                modo_pdv: { ok: false, mensaje: 'No ejecutado: fallo la validacion del token.' },
              },
            };
          }
          this.logger.error('verify mp_point', e);
          return { ok: false, mensaje: 'No se pudo verificar MP Point. Reintenta en unos segundos.' };
        }
      },
    };
  }

  private mpQrAdapter() {
    return {
      validate: (integracion: PasarelaIntegracion) => {
        const token = getPasarelaSecret(this.fieldCrypto, integracion, 'access_token');
        const userId = this.configString(integracion, 'user_id');
        const externalPosId = this.configString(integracion, 'external_pos_id');
        if (!token || !userId || !externalPosId) {
          return { ok: false as const, error: 'Configuracion de MP QR incompleta' };
        }
        return { ok: true as const };
      },
      verify: async (integracion: PasarelaIntegracion): Promise<PasarelaVerificacionResult> => {
        const accessToken = getPasarelaSecret(this.fieldCrypto, integracion, 'access_token');
        const userId = this.configString(integracion, 'user_id');
        const externalPosId = this.configString(integracion, 'external_pos_id');
        const externalStoreId = this.configString(integracion, 'external_store_id');
        if (!accessToken || !userId || !externalPosId) {
          return this.verificacionIncompleta('Configuracion de MP QR incompleta');
        }
        try {
          const resolved = await resolveMpQrPos({
            access_token: accessToken,
            user_id: userId,
            external_pos_id: externalPosId,
            external_store_id: externalStoreId,
          }).catch(() => ({
            external_pos_id: externalPosId,
            external_store_id: externalStoreId,
            resolved_from_internal_id: false,
          }));
          const result = await runMpQrVerificacionMpQr({
            access_token: accessToken,
            user_id: userId,
            external_pos_id: resolved.external_pos_id,
            external_store_id: resolved.external_store_id,
          });
          return {
            ...result,
            mensaje: result.ok ? 'Conexion MP QR verificada.' : 'No se pudo verificar MP QR.',
            detalles:
              resolved.resolved_from_internal_id || resolved.external_store_id
                ? {
                    external_pos_id_original: externalPosId,
                    external_pos_id_resuelto: resolved.external_pos_id,
                    external_store_id: resolved.external_store_id,
                  }
                : undefined,
          };
        } catch (e) {
          this.logger.error('verify mp_qr', e);
          return { ok: false, mensaje: 'No se pudo verificar MP QR. Reintenta en unos segundos.' };
        }
      },
    };
  }
}
