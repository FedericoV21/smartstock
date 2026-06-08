import type { MpQrVerificacionCheck, MpQrVerificacionResult } from '@/types/mp-qr';

const MP_USERS_ME = 'https://api.mercadopago.com/users/me';
/** Listado de cajas (POS) del dueño del token — usar /pos, no /users/{id}/pos (deprecado, 403 en prod). */
const MP_POS_LIST = 'https://api.mercadopago.com/pos';
const MP_STORES_BASE = 'https://api.mercadopago.com/stores';

type MpFetch = typeof fetch;

function omitido(): MpQrVerificacionCheck {
  return { ok: false, mensaje: 'No ejecutado: un check anterior falló.' };
}

function cajaInfoFromRaw(raw: Record<string, unknown>): MpQrVerificacionCheck['caja_info'] {
  return {
    id: Number(raw.id),
    name: String(raw.name ?? ''),
    external_id:
      raw.external_id === undefined || raw.external_id === null
        ? null
        : String(raw.external_id).trim() || null,
    store_id:
      raw.store_id === undefined || raw.store_id === null
        ? null
        : String(raw.store_id).trim() || null,
    external_store_id:
      raw.external_store_id === undefined || raw.external_store_id === null
        ? null
        : String(raw.external_store_id).trim() || null,
    fixed_amount: Boolean(raw.fixed_amount ?? raw.fixedAmount),
  };
}

function listarCajasDesdeJson(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const r = o.results;
    if (Array.isArray(r)) return r as Record<string, unknown>[];
    const d = o.data;
    if (Array.isArray(d)) return d as Record<string, unknown>[];
  }
  return [];
}

export interface RunMpQrVerificacionInput {
  access_token: string;
  user_id: string;
  external_pos_id: string;
  external_store_id?: string | null;
}

export interface RunMpQrVerificacionOptions {
  fetchImpl?: MpFetch;
}

export interface MpQrResolvedPos {
  external_pos_id: string;
  external_store_id: string | null;
  resolved_from_internal_id: boolean;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const t = String(value).trim();
  return t ? t : null;
}

async function loadExternalStoreId(params: {
  accessToken: string;
  storeId: string | null;
  configuredExternalStoreId?: string | null;
  fetchFn: MpFetch;
}): Promise<string | null> {
  const configured = cleanString(params.configuredExternalStoreId);
  if (configured) return configured;
  if (!params.storeId) return null;

  const res = await params.fetchFn(`${MP_STORES_BASE}/${encodeURIComponent(params.storeId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  if (!res.ok) return null;

  try {
    const data = (await res.json()) as Record<string, unknown>;
    return cleanString(data.external_id);
  } catch {
    return null;
  }
}

export async function resolveMpQrPos(
  input: RunMpQrVerificacionInput,
  options?: RunMpQrVerificacionOptions,
): Promise<MpQrResolvedPos> {
  const fetchFn: MpFetch = options?.fetchImpl ?? globalThis.fetch;
  const requested = String(input.external_pos_id).trim();
  const configuredExternalStoreId = cleanString(input.external_store_id);
  if (!requested) {
    return {
      external_pos_id: requested,
      external_store_id: configuredExternalStoreId,
      resolved_from_internal_id: false,
    };
  }
  if (!/^\d+$/.test(requested)) {
    const posRes = await fetchFn(MP_POS_LIST, {
      method: 'GET',
      headers: { Authorization: `Bearer ${input.access_token}` },
    });
    if (!posRes.ok) {
      return {
        external_pos_id: requested,
        external_store_id: configuredExternalStoreId,
        resolved_from_internal_id: false,
      };
    }
    try {
      const posJson = await posRes.json();
      const match = listarCajasDesdeJson(posJson).find((raw) => cajaInfoFromRaw(raw)?.external_id === requested);
      const info = match ? cajaInfoFromRaw(match) : null;
      const externalStoreId =
        cleanString(info?.external_store_id) ??
        (await loadExternalStoreId({
          accessToken: input.access_token,
          storeId: cleanString(info?.store_id),
          configuredExternalStoreId,
          fetchFn,
        }));
      return {
        external_pos_id: requested,
        external_store_id: externalStoreId,
        resolved_from_internal_id: false,
      };
    } catch {
      return {
        external_pos_id: requested,
        external_store_id: configuredExternalStoreId,
        resolved_from_internal_id: false,
      };
    }
  }

  const posRes = await fetchFn(MP_POS_LIST, {
    method: 'GET',
    headers: { Authorization: `Bearer ${input.access_token}` },
  });
  if (!posRes.ok) {
    return {
      external_pos_id: requested,
      external_store_id: configuredExternalStoreId,
      resolved_from_internal_id: false,
    };
  }

  let posJson: unknown;
  try {
    posJson = await posRes.json();
  } catch {
    return {
      external_pos_id: requested,
      external_store_id: configuredExternalStoreId,
      resolved_from_internal_id: false,
    };
  }

  const cajas = listarCajasDesdeJson(posJson).map((raw) => ({ raw, info: cajaInfoFromRaw(raw)! }));
  const porExternalId = cajas.find((c) => c.info.external_id === requested);
  if (porExternalId?.info.external_id) {
    const externalStoreId =
      cleanString(porExternalId.info.external_store_id) ??
      (await loadExternalStoreId({
        accessToken: input.access_token,
        storeId: cleanString(porExternalId.info.store_id),
        configuredExternalStoreId,
        fetchFn,
      }));
    return {
      external_pos_id: porExternalId.info.external_id,
      external_store_id: externalStoreId,
      resolved_from_internal_id: false,
    };
  }

  const porIdInterno = cajas.find((c) => String(c.info.id) === requested);
  if (porIdInterno?.info.external_id) {
    const externalStoreId =
      cleanString(porIdInterno.info.external_store_id) ??
      (await loadExternalStoreId({
        accessToken: input.access_token,
        storeId: cleanString(porIdInterno.info.store_id),
        configuredExternalStoreId,
        fetchFn,
      }));
    return {
      external_pos_id: porIdInterno.info.external_id,
      external_store_id: externalStoreId,
      resolved_from_internal_id: true,
    };
  }

  return {
    external_pos_id: requested,
    external_store_id: configuredExternalStoreId,
    resolved_from_internal_id: false,
  };
}

export async function resolveMpQrExternalPosId(
  input: RunMpQrVerificacionInput,
  options?: RunMpQrVerificacionOptions,
): Promise<{ external_pos_id: string; resolved_from_internal_id: boolean }> {
  const requested = String(input.external_pos_id).trim();
  if (!requested || !/^\d+$/.test(requested)) {
    return {
      external_pos_id: requested,
      resolved_from_internal_id: false,
    };
  }
  const resolved = await resolveMpQrPos(input, options);
  return {
    external_pos_id: resolved.external_pos_id,
    resolved_from_internal_id: resolved.resolved_from_internal_id,
  };
}

/**
 * Ejecuta los 4 checks de configuración MP QR (token, user, caja, cobro de prueba $1 + cancel).
 * No persiste nada. Pensado para tests con `fetchImpl` mockeado.
 */
export async function runMpQrVerificacionMpQr(
  input: RunMpQrVerificacionInput,
  options?: RunMpQrVerificacionOptions,
): Promise<MpQrVerificacionResult> {
  const fetchFn: MpFetch = options?.fetchImpl ?? globalThis.fetch;
  const { access_token, user_id, external_pos_id } = input;

  /** Check 1 — Token */
  const meRes = await fetchFn(MP_USERS_ME, {
    method: 'GET',
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!meRes.ok) {
    const tokenCheck: MpQrVerificacionCheck = {
      ok: false,
      mensaje:
        meRes.status === 401
          ? 'Token inválido o expirado'
          : `Error ${meRes.status} al validar el token`,
    };
    return {
      ok: false,
      checks: {
        token_valido: tokenCheck,
        user_id_coincide: omitido(),
        caja_existe: omitido(),
        cobro_de_prueba: omitido(),
      },
    };
  }

  let meData: Record<string, unknown>;
  try {
    meData = (await meRes.json()) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      checks: {
        token_valido: { ok: false, mensaje: 'Respuesta inválida de Mercado Pago al validar el token.' },
        user_id_coincide: omitido(),
        caja_existe: omitido(),
        cobro_de_prueba: omitido(),
      },
    };
  }

  const meId = meData.id != null ? String(meData.id) : '';
  const nickname = meData.nickname != null ? String(meData.nickname) : '';
  const tokenOk: MpQrVerificacionCheck = {
    ok: true,
    mensaje: `Token válido (cuenta: ${nickname || meId || '—'})`,
    user_detectado: meId,
  };

  /** Check 2 — User ID */
  if (String(meId) !== String(user_id).trim()) {
    return {
      ok: false,
      checks: {
        token_valido: tokenOk,
        user_id_coincide: {
          ok: false,
          mensaje: `El User ID cargado (${user_id}) no coincide con el dueño del token (${meId}). Cargá ${meId} como User ID.`,
        },
        caja_existe: omitido(),
        cobro_de_prueba: omitido(),
      },
    };
  }

  const userOk: MpQrVerificacionCheck = {
    ok: true,
    mensaje: 'User ID coincide con el token',
  };

  /** Check 3 — Cajas (GET /pos: scope del access token) */
  const posRes = await fetchFn(MP_POS_LIST, {
    method: 'GET',
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!posRes.ok) {
    return {
      ok: false,
      checks: {
        token_valido: tokenOk,
        user_id_coincide: userOk,
        caja_existe: {
          ok: false,
          mensaje: `Error ${posRes.status} al listar las cajas. Verificá los permisos del token.`,
        },
        cobro_de_prueba: omitido(),
      },
    };
  }

  let posJson: unknown;
  try {
    posJson = await posRes.json();
  } catch {
    return {
      ok: false,
      checks: {
        token_valido: tokenOk,
        user_id_coincide: userOk,
        caja_existe: { ok: false, mensaje: 'Respuesta inválida al listar cajas.' },
        cobro_de_prueba: omitido(),
      },
    };
  }

  const cajasRaw = listarCajasDesdeJson(posJson);
  const cajas = cajasRaw.map((c) => ({
    raw: c,
    info: cajaInfoFromRaw(c)!,
  }));

  if (cajas.length === 0) {
    return {
      ok: false,
      checks: {
        token_valido: tokenOk,
        user_id_coincide: userOk,
        caja_existe: {
          ok: false,
          mensaje: 'No tenés ninguna caja creada en Mercado Pago. Creá una desde la API o el panel de MP.',
          sugerencia:
            'Si la caja la creaste solo desde el panel web, puede no tener external_id: creá una caja vía API con external_id definido (documentación del proyecto, apéndice A).',
        },
        cobro_de_prueba: omitido(),
      },
    };
  }

  const extTrim = String(external_pos_id).trim();
  const cajaEntry = cajas.find(
    (c) =>
      (c.info.external_id != null && String(c.info.external_id) === extTrim) ||
      String(c.info.id) === extTrim,
  );

  if (!cajaEntry) {
    const haySinExternal = cajas.some((c) => !c.info.external_id);
    const cajasFormateadas = cajas
      .map(
        (c) =>
          `  • "${c.info.name}" — id=${c.info.id}, external_id=${c.info.external_id ?? 'sin asignar'}`,
      )
      .join('\n');

    return {
      ok: false,
      checks: {
        token_valido: tokenOk,
        user_id_coincide: userOk,
        caja_existe: {
          ok: false,
          mensaje: `No se encontró caja con external_pos_id="${extTrim}".\n\nCajas disponibles en tu cuenta:\n${cajasFormateadas}`,
          sugerencia: haySinExternal
            ? 'Algunas cajas no tienen external_id. Creá una caja nueva vía API con external_id definido (apéndice A de la documentación MP QR).'
            : 'Cargá el external_id exacto de alguna de las cajas listadas arriba.',
        },
        cobro_de_prueba: omitido(),
      },
    };
  }

  const caja = cajaEntry.info;
  if (!caja.fixed_amount) {
    return {
      ok: false,
      checks: {
        token_valido: tokenOk,
        user_id_coincide: userOk,
        caja_existe: {
          ok: false,
          mensaje: `La caja "${caja.name}" NO está en modo "monto cerrado". El cliente podría tipear cualquier monto al escanear el QR.`,
          sugerencia: 'Activá "Cobrar con monto cerrado" en el panel de MP, o recreá la caja con fixed_amount=true.',
          caja_info: caja,
        },
        cobro_de_prueba: omitido(),
      },
    };
  }

  const cajaOk: MpQrVerificacionCheck = {
    ok: true,
    mensaje: `Caja encontrada: "${caja.name}" (modo monto cerrado activo)`,
    caja_info: caja,
  };

  /** Check 4 — PUT $1 + DELETE */
  const externalStoreId =
    cleanString(input.external_store_id) ??
    cleanString(caja.external_store_id) ??
    (await loadExternalStoreId({
      accessToken: access_token,
      storeId: cleanString(caja.store_id),
      configuredExternalStoreId: null,
      fetchFn,
    }));
  const cajaIdParaUrl = encodeURIComponent(
    caja.external_id != null && String(caja.external_id).trim() !== ''
      ? String(caja.external_id).trim()
      : String(caja.id),
  );
  const uidEnc = encodeURIComponent(String(user_id).trim());
  const storeEnc = externalStoreId ? encodeURIComponent(externalStoreId) : '';
  const createUrl = externalStoreId
    ? `https://api.mercadopago.com/instore/qr/seller/collectors/${uidEnc}/stores/${storeEnc}/pos/${cajaIdParaUrl}/orders`
    : `https://api.mercadopago.com/instore/orders/qr/seller/collectors/${uidEnc}/pos/${cajaIdParaUrl}/qrs`;
  const cancelUrl = `https://api.mercadopago.com/instore/qr/seller/collectors/${uidEnc}/pos/${cajaIdParaUrl}/orders`;
  const endpointLabel = externalStoreId
    ? `QR v2 con store (${externalStoreId})`
    : 'QR dinamico sin store';

  const testRef = `test-config-${Date.now()}`;
  const testPayload = {
    external_reference: testRef,
    title: 'Prueba de configuración Nexus',
    description: 'Cobro de prueba — se cancela automáticamente',
    total_amount: 1,
    items: [
      {
        title: 'Prueba',
        description: 'Verificación de configuración Nexus',
        quantity: 1,
        unit_price: 1,
        unit_measure: 'unit' as const,
        total_amount: 1,
      },
    ],
  };

  const createRes = await fetchFn(createUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${access_token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(testPayload),
  });

  if (!createRes.ok) {
    let errMsg = createRes.statusText;
    let errCode = '';
    let blockedBy = '';
    try {
      const errBody = JSON.parse(await createRes.text()) as Record<string, unknown>;
      errMsg =
        (typeof errBody.message === 'string' && errBody.message) ||
        (typeof errBody.error === 'string' && errBody.error) ||
        errMsg;
      errCode =
        (typeof errBody.code === 'string' && errBody.code) ||
        (typeof errBody.error === 'string' && errBody.error) ||
        '';
      blockedBy = typeof errBody.blocked_by === 'string' ? errBody.blocked_by : '';
    } catch {
      /* noop */
    }
    const policyUnauthorized =
      createRes.status === 403 &&
      (/policy.*unauthorized/i.test(errMsg) ||
        /unauthorized.*polic/i.test(errMsg) ||
        /pa_unauthorized_result_from_policies/i.test(errCode) ||
        /policyagent/i.test(blockedBy));
    const detalle = [errCode ? `codigo=${errCode}` : '', blockedBy ? `blocked_by=${blockedBy}` : '']
      .filter(Boolean)
      .join(', ');
    return {
      ok: false,
      checks: {
        token_valido: tokenOk,
        user_id_coincide: userOk,
        caja_existe: cajaOk,
        cobro_de_prueba: {
          ok: false,
          mensaje: `MP rechazó el cobro de prueba usando ${endpointLabel}: ${errMsg} (status ${createRes.status})${detalle ? ` - ${detalle}` : ''}`,
          sugerencia: policyUnauthorized
            ? externalStoreId
              ? 'El token es valido para leer la cuenta, pero Mercado Pago bloquea la creacion de orden QR v2 para esa cuenta/app.'
              : 'Falta External Store ID o no se pudo resolver automaticamente. Carga el external_id de la sucursal, por ejemplo SUC01, y volve a verificar.'
            : undefined,
          endpoint_usado: endpointLabel,
          external_store_id: externalStoreId,
        },
      },
    };
  }

  const cancelRes = await fetchFn(cancelUrl, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${access_token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  if (!cancelRes.ok) {
    console.warn(
      `[mp-qr] verificar: orden de prueba ${testRef} no se pudo cancelar (status ${cancelRes.status})`,
    );
    return {
      ok: true,
      checks: {
        token_valido: tokenOk,
        user_id_coincide: userOk,
        caja_existe: cajaOk,
        cobro_de_prueba: {
          ok: true,
          mensaje:
            `Cobro de prueba creado correctamente usando ${endpointLabel}. Atención: no se pudo cancelar automáticamente — revisá manualmente en MP si el QR quedó con orden activa.`,
          endpoint_usado: endpointLabel,
          external_store_id: externalStoreId,
        },
      },
    };
  }

  return {
    ok: true,
    checks: {
      token_valido: tokenOk,
      user_id_coincide: userOk,
      caja_existe: cajaOk,
      cobro_de_prueba: {
        ok: true,
        mensaje: `Cobro de prueba creado y cancelado correctamente usando ${endpointLabel}. Todo listo.`,
        endpoint_usado: endpointLabel,
        external_store_id: externalStoreId,
      },
    },
  };
}
