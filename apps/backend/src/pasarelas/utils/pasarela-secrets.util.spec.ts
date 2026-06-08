import { encryptSecretsRecord, listSecretosConfigurados, serializeIntegracion } from './pasarela-secrets.util';
import type { PasarelaIntegracion } from '../entities/pasarela-integracion.entity';

describe('pasarela-secrets.util', () => {
  const crypto = {
    encrypt: (v: string) => `enc:${v}`,
    tryDecrypt: (v: string) => (v.startsWith('enc:') ? v.slice(4) : null),
  } as never;

  it('serializeIntegracion oculta secretos y lista claves', () => {
    const row = {
      id: 'i1',
      tenantId: 't1',
      sucursalId: 's1',
      proveedor: 'mercado_pago',
      canal: 'qr',
      tipo: 'mp_qr',
      nombre: 'MP QR',
      estado: 'activa',
      configPublica: { user_id: '123' },
      secretosCifrados: { access_token: 'enc:tok' },
      webhookPublicId: 'w1',
      origenLegacy: null,
      legacyConfigId: null,
      createdAt: new Date('2026-06-05T12:00:00.000Z'),
      updatedAt: new Date('2026-06-05T12:00:00.000Z'),
    } as PasarelaIntegracion;

    const out = serializeIntegracion(row);
    expect(out.secretos_configurados).toEqual(['access_token']);
    expect(out).not.toHaveProperty('secretos_cifrados');
    expect(out.tenant_id).toBe('t1');
  });

  it('encryptSecretsRecord cifra valores string', () => {
    const out = encryptSecretsRecord(crypto, { access_token: 'abc', empty: '' });
    expect(out.access_token).toBe('enc:abc');
    expect(out.empty).toBeUndefined();
  });

  it('listSecretosConfigurados ignora vacíos', () => {
    expect(listSecretosConfigurados({ a: 'x', b: '  ' })).toEqual(['a']);
  });
});
