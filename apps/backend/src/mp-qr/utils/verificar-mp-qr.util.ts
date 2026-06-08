import { MP_QR_API_BASE, createMpQrClient } from '../mp-qr-api.client';
import { resolveMpQrPos } from './resolve-mp-qr-pos.util';

export type MpQrVerificacionCheck = {
  ok: boolean;
  mensaje: string;
  user_detectado?: string;
  caja_info?: Record<string, unknown>;
  sugerencia?: string;
  endpoint_usado?: string;
  external_store_id?: string | null;
};

export type MpQrVerificacionResult = {
  ok: boolean;
  checks: {
    token_valido: MpQrVerificacionCheck;
    user_id_coincide: MpQrVerificacionCheck;
    caja_existe: MpQrVerificacionCheck;
    cobro_de_prueba: MpQrVerificacionCheck;
  };
};

const MP_USERS_ME = `${MP_QR_API_BASE}/users/me`;
const MP_POS_LIST = `${MP_QR_API_BASE}/pos`;

function omitido(): MpQrVerificacionCheck {
  return { ok: false, mensaje: 'No ejecutado: un check anterior falló.' };
}

export async function runMpQrVerificacionMpQr(input: {
  access_token: string;
  user_id: string;
  external_pos_id: string;
  external_store_id?: string | null;
}): Promise<MpQrVerificacionResult> {
  const fetchFn = globalThis.fetch;
  const { access_token, user_id, external_pos_id } = input;

  const meRes = await fetchFn(MP_USERS_ME, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!meRes.ok) {
    return {
      ok: false,
      checks: {
        token_valido: {
          ok: false,
          mensaje: meRes.status === 401 ? 'Token inválido o expirado' : `Error ${meRes.status} al validar el token`,
        },
        user_id_coincide: omitido(),
        caja_existe: omitido(),
        cobro_de_prueba: omitido(),
      },
    };
  }

  const meData = (await meRes.json()) as Record<string, unknown>;
  const meId = meData.id != null ? String(meData.id) : '';
  const nickname = meData.nickname != null ? String(meData.nickname) : '';
  const tokenOk: MpQrVerificacionCheck = {
    ok: true,
    mensaje: `Token válido (cuenta: ${nickname || meId || '—'})`,
    user_detectado: meId,
  };

  if (String(meId) !== String(user_id).trim()) {
    return {
      ok: false,
      checks: {
        token_valido: tokenOk,
        user_id_coincide: {
          ok: false,
          mensaje: `El User ID cargado (${user_id}) no coincide con el dueño del token (${meId}).`,
        },
        caja_existe: omitido(),
        cobro_de_prueba: omitido(),
      },
    };
  }

  const userOk: MpQrVerificacionCheck = { ok: true, mensaje: 'User ID coincide con el token' };

  const posRes = await fetchFn(MP_POS_LIST, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!posRes.ok) {
    return {
      ok: false,
      checks: {
        token_valido: tokenOk,
        user_id_coincide: userOk,
        caja_existe: { ok: false, mensaje: `Error ${posRes.status} al listar cajas.` },
        cobro_de_prueba: omitido(),
      },
    };
  }

  const posJson = (await posRes.json()) as unknown;
  const cajas = Array.isArray(posJson)
    ? (posJson as Record<string, unknown>[])
    : Array.isArray((posJson as Record<string, unknown>)?.results)
      ? ((posJson as Record<string, unknown>).results as Record<string, unknown>[])
      : [];

  const extTrim = String(external_pos_id).trim();
  const match = cajas.find((c) => {
    const ext = c.external_id != null ? String(c.external_id).trim() : '';
    const id = c.id != null ? String(c.id) : '';
    return ext === extTrim || id === extTrim;
  });

  if (!match) {
    return {
      ok: false,
      checks: {
        token_valido: tokenOk,
        user_id_coincide: userOk,
        caja_existe: { ok: false, mensaje: `No se encontró caja con external_pos_id="${extTrim}".` },
        cobro_de_prueba: omitido(),
      },
    };
  }

  const cajaOk: MpQrVerificacionCheck = {
    ok: true,
    mensaje: `Caja encontrada: "${String(match.name ?? '')}"`,
    caja_info: match as Record<string, unknown>,
  };

  const client = createMpQrClient(access_token, user_id);
  const resolved = await resolveMpQrPos({
    access_token,
    user_id,
    external_pos_id: extTrim,
  });

  try {
    await client.createOrder(
      resolved.external_pos_id,
      {
        external_reference: `test-config-${Date.now()}`,
        title: 'Prueba Nexus',
        description: 'Verificación MP QR',
        total_amount: 1,
        items: [
          {
            title: 'Prueba',
            description: 'Verificación',
            quantity: 1,
            unit_price: 1,
            unit_measure: 'unit',
            total_amount: 1,
          },
        ],
      },
      { externalStoreId: resolved.external_store_id },
    );
    await client.cancelOrder(resolved.external_pos_id, {
      externalStoreId: resolved.external_store_id,
    });
    return {
      ok: true,
      checks: {
        token_valido: tokenOk,
        user_id_coincide: userOk,
        caja_existe: cajaOk,
        cobro_de_prueba: { ok: true, mensaje: 'Cobro de prueba creado y cancelado correctamente.' },
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error en cobro de prueba';
    return {
      ok: false,
      checks: {
        token_valido: tokenOk,
        user_id_coincide: userOk,
        caja_existe: cajaOk,
        cobro_de_prueba: { ok: false, mensaje: msg },
      },
    };
  }
}
