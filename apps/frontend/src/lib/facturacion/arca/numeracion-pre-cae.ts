import type { SupabaseClient } from '@supabase/supabase-js';

import { formatearTipoComprobante } from '@/lib/facturacion/formato';
import { mapTipoComprobante } from '@/lib/facturacion/arca/tipos';
import {
  consultarCbteFchUltimoAutorizadoAfip,
  consultarComprobanteExisteEnAfip,
  consultarUltimoComprobante,
} from '@/lib/facturacion/arca/wsfe';
import type { Database } from '@/types/database';

export type ArcaConfigEmision = {
  tenant_id: string;
  sucursal_id: string;
  cuit_emisor: string;
  punto_de_venta: number;
  ambiente: Database['public']['Enums']['arca_ambiente'];
};

type TipoComprobante = Database['public']['Enums']['tipo_comprobante'];

/** Límite superior del número de comprobante según RG AFIP / WSFE (8 dígitos). */
export const AFIP_CBTE_NUMERO_MAX = 99_999_999;

/** Salida de `resolverNumeroParaSolicitudCae`: número siguiente + fecha mínima por correlatividad AFIP (RFC Solución #2 Afip SDK). */
export type ResolverNumeroCaeOk = {
  numero: number;
  /** `FECompConsultar` sobre el último `FECompUltimoAutorizado`: el siguiente `CbteFch` debe ser ≥ esta fecha. */
  fechaMinCorrelativaAfip: string | null;
};

/**
 * Descarta valores fuera del rango permitido por WSFE (basura por parse XML o número fiscal corrupto en DB).
 */
function sanitizarUltimoConsultadoWsfe(n: unknown): number {
  const raw = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(raw)) return 0;
  const k = Math.trunc(raw);
  if (k < 0 || k > AFIP_CBTE_NUMERO_MAX) return 0;
  return k;
}

/** CAE de comprobantes electrónicos AFIP: 14 dígitos. */
export function caeAfipFormatoValido(cae: string | null | undefined): boolean {
  return typeof cae === 'string' && /^\d{14}$/.test(cae.trim());
}

async function obtenerSiguienteNumeroLocal(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalId: string,
  tipo: TipoComprobante,
): Promise<number> {
  const { data, error } = await supabase.rpc('siguiente_numero_comprobante', {
    p_tenant_id: tenantId,
    p_sucursal_id: sucursalId,
    p_tipo: tipo,
  });

  if (error) {
    throw new Error(`Error al obtener número: ${error.message}`);
  }

  return data;
}

async function obtenerNumeroArchivado(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  tipo: TipoComprobante,
): Promise<number> {
  const { data, error } = await supabase
    .from('comprobante')
    .select('numero')
    .eq('tenant_id', tenantId)
    .eq('tipo', tipo)
    .lt('numero', 0)
    .order('numero', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al reservar numeración archivada: ${error.message}`);
  }

  return (data?.numero ?? 0) - 1;
}

/** Último número fiscal ya autorizado en Nexus (CAE válido). */
export async function ultimoNumeroLocalConCaeValido(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalId: string,
  tipo: TipoComprobante,
): Promise<number> {
  const { data, error } = await supabase
    .from('comprobante')
    .select('numero, cae')
    .eq('tenant_id', tenantId)
    .eq('sucursal_id', sucursalId)
    .eq('tipo', tipo)
    .gt('numero', 0)
    .not('cae', 'is', null);

  if (error) {
    throw new Error(`Error al leer numeración local con CAE: ${error.message}`);
  }

  let max = 0;
  for (const row of data ?? []) {
    const n = row.numero;
    if (
      n != null &&
      caeAfipFormatoValido(row.cae) &&
      n >= 1 &&
      n <= AFIP_CBTE_NUMERO_MAX &&
      n > max
    ) {
      max = n;
    }
  }
  return max;
}

export async function liberarNumeroConflictuanteErrorArca(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalId: string,
  tipo: TipoComprobante,
  numero: number,
): Promise<string | null> {
  const { data: conflicto, error } = await supabase
    .from('comprobante')
    .select('id, numero, estado, cae, notas, numero_orden')
    .eq('tenant_id', tenantId)
    .eq('sucursal_id', sucursalId)
    .eq('tipo', tipo)
    .eq('numero', numero)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al verificar conflictos de numeración: ${error.message}`);
  }

  if (!conflicto) return null;

  if (caeAfipFormatoValido(conflicto.cae)) {
    const ordenHint =
      conflicto.numero_orden != null
        ? ` La orden de venta de ese registro es #${conflicto.numero_orden} (distinta del número fiscal).`
        : '';
    return (
      `Ya hay un ${formatearTipoComprobante(tipo)} autorizado por ARCA con número fiscal ${numero}.${ordenHint} ` +
      `Si el sistema ofrece de nuevo el ${numero}, revisá punto de venta y ambiente (homologación vs producción) o sincronizá la numeración con AFIP.`
    );
  }

  const numeroArchivado = await obtenerNumeroArchivado(supabase, tenantId, tipo);
  const notaArchivo = [
    conflicto.notas?.trim(),
    `[Nexus] Registro archivado localmente como ${numeroArchivado} para liberar la numeración fiscal ${numero} (sin CAE válido AFIP; estado ${conflicto.estado}).`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const { error: updateError } = await supabase
    .from('comprobante')
    .update({
      numero: numeroArchivado,
      notas: notaArchivo,
    })
    .eq('id', conflicto.id);

  if (updateError) {
    throw new Error(`Error al liberar número fiscal: ${updateError.message}`);
  }

  return null;
}

/**
 * Si Nexus tiene CAE con formato válido pero AFIP no devuelve ese comprobante en `FECompConsultar`,
 * archiva el registro (numero negativo), limpia CAE y libera el número fiscal para reemitir alineado con ARCA.
 */
async function archivarComprobanteFantasmaSiNoExisteEnAfip(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalId: string,
  tipo: TipoComprobante,
  numero: number,
): Promise<boolean> {
  const { data: conflicto, error } = await supabase
    .from('comprobante')
    .select('id, numero, estado, cae, notas, numero_orden')
    .eq('tenant_id', tenantId)
    .eq('sucursal_id', sucursalId)
    .eq('tipo', tipo)
    .eq('numero', numero)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al verificar comprobante fantasma: ${error.message}`);
  }

  if (!conflicto || !caeAfipFormatoValido(conflicto.cae)) {
    return false;
  }

  const numeroArchivado = await obtenerNumeroArchivado(supabase, tenantId, tipo);
  const notaArchivo = [
    conflicto.notas?.trim(),
    `[Nexus] Registro archivado: FECompConsultar no devolvió comprobante autorizado para el número fiscal ${numero}; ` +
      `el CAE local no figura en AFIP para este PtoVta/tipo. Numeración liberada para reemisión alineada con ARCA.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const { error: updateError } = await supabase
    .from('comprobante')
    .update({
      numero: numeroArchivado,
      cae: null,
      cae_vencimiento: null,
      notas: notaArchivo,
    })
    .eq('id', conflicto.id);

  if (updateError) {
    throw new Error(`Error al archivar comprobante fantasma: ${updateError.message}`);
  }

  return true;
}

/**
 * Próximo número a enviar en FECAESolicitar (tras lock en `arca_config`).
 *
 * **Flujo AFIP (obligatorio):** en cada emisión se llama a `FECompUltimoAutorizado` vía
 * {@link consultarUltimoComprobante}; el candidato es **`ultimoArca + 1`** (no `max(AFIP, local)+1`).
 * Si la DB tiene un CAE “adelantado” respecto de AFIP, `max+1` **salta** el número que ARCA exige y devuelve 10016.
 * **No** se usa `arca_config.ultimo_comprobante` para calcular (solo se actualiza tras CAE exitoso).
 * La correlatividad de **fecha** se acota con `FECompConsultar`.
 *
 * Concurrencia: el caller debe haber tomado `lock_arca_config_for_update` antes de FECAESolicitar.
 */
export async function resolverNumeroParaSolicitudCae(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string; sucursalId: string },
  tipo: TipoComprobante,
  arcaConfig: ArcaConfigEmision,
): Promise<ResolverNumeroCaeOk | { error: string }> {
  let ultimoAutorizado: number;
  try {
    ultimoAutorizado = await consultarUltimoComprobante(supabase, arcaConfig, tipo);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    return {
      error: `No se pudo consultar la numeración ARCA para ${formatearTipoComprobante(tipo)}: ${mensaje}`,
    };
  }

  let ultimoLocalConCae = 0;
  try {
    ultimoLocalConCae = await ultimoNumeroLocalConCaeValido(supabase, ctx.tenantId, ctx.sucursalId, tipo);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    return { error: mensaje };
  }

  const ultimoArca = sanitizarUltimoConsultadoWsfe(ultimoAutorizado);
  const ultimoLocal = sanitizarUltimoConsultadoWsfe(ultimoLocalConCae);

  /**
   * Próximo que acepta WSFE: estrictamente `FECompUltimoAutorizado + 1`.
   * No mezclar con `ultimoLocal`: si Nexus tiene 11 con CAE y AFIP último 10, el siguiente en ARCA es **11**;
   * `max(10,11)+1` daría 12 y 10016.
   */
  const candArca = ultimoArca + 1;
  let numero = candArca;
  if (!Number.isFinite(numero) || numero < 1) {
    numero = Math.max(1, candArca);
  }
  if (numero > AFIP_CBTE_NUMERO_MAX) {
    if (candArca >= 1 && candArca <= AFIP_CBTE_NUMERO_MAX) {
      numero = candArca;
    } else {
      return {
        error:
          `La numeración fiscal calculada (${numero}) está fuera del rango permitido por ARCA (1..99999999). ` +
          `Revisá la numeración local/ARCA y sincronizá desde Facturación → Resolver ARCA.`,
      };
    }
  }
  // Si el número calculado ya fue autorizado con CAE (conflicto de numeración),
  // avanzamos al siguiente en vez de bloquear al usuario.
  for (let i = 0; i < 200; i++) {
    const conflicto = await liberarNumeroConflictuanteErrorArca(
      supabase,
      ctx.tenantId,
      ctx.sucursalId,
      tipo,
      numero,
    );
    if (!conflicto) {
      /** Fecha mínima: max entre `CbteFch(N-1)` (predecesor del envío) y `CbteFch(Último según FECompUltimoAutorizado)` por si una consulta falla o hay huecos. */
      let fechaMinCorrelativaAfip: string | null = null;
      const acumMax = (iso: string | null) => {
        if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
        fechaMinCorrelativaAfip =
          !fechaMinCorrelativaAfip || iso > fechaMinCorrelativaAfip ? iso : fechaMinCorrelativaAfip;
      };
      /**
       * Defensivo: 2x FECompConsultar en paralelo y con presupuesto corto.
       * Si AFIP está degradado y no responden en 15s, igual seguimos: el reintento
       * de alineación ante 10016 (en `solicitar-cae-y-asignar-numero`) cubre el
       * caso. Sin esto, cada emit suma hasta ~12 min de timeouts seriados.
       */
      const FECOMP_CONSULTAR_OPTS = { perAttemptTimeoutMs: 15_000, maxAttempts: 1 } as const;
      const fechaPromises: Promise<string | null>[] = [];
      if (numero > 1) {
        fechaPromises.push(
          consultarCbteFchUltimoAutorizadoAfip(
            supabase,
            arcaConfig,
            tipo,
            numero - 1,
            FECOMP_CONSULTAR_OPTS,
          ),
        );
      }
      if (ultimoArca >= 1) {
        fechaPromises.push(
          consultarCbteFchUltimoAutorizadoAfip(
            supabase,
            arcaConfig,
            tipo,
            ultimoArca,
            FECOMP_CONSULTAR_OPTS,
          ),
        );
      }
      if (fechaPromises.length > 0) {
        const settled = await Promise.allSettled(fechaPromises);
        for (const s of settled) {
          if (s.status === 'fulfilled') {
            acumMax(s.value);
          }
        }
      }
      if (process.env.NODE_ENV === 'development') {
        let cbteTipoWsfe = 0;
        try {
          cbteTipoWsfe = mapTipoComprobante(tipo);
        } catch {
          /* tipo no mapeado en dev */
        }
        console.log('[ARCA][resolverNumeroParaSolicitudCae]', {
          ambiente: arcaConfig.ambiente,
          punto_de_venta: arcaConfig.punto_de_venta,
          tipo_nexus: tipo,
          cbte_tipo_wsfe: cbteTipoWsfe,
          ultimo_fe_comp_ultimo_autorizado: ultimoArca,
          ultimo_local_con_cae_valido: ultimoLocal,
          siguiente_numero_fecae: numero,
          fecha_min_correlativa_yyyy_mm_dd: fechaMinCorrelativaAfip,
        });
      }
      return { numero, fechaMinCorrelativaAfip };
    }
    const conflictoAutorizado = conflicto.includes('autorizado por ARCA');
    if (!conflictoAutorizado) {
      return { error: conflicto };
    }
    const proximoSegunAfip = Math.min(AFIP_CBTE_NUMERO_MAX, Math.max(1, ultimoArca + 1));
    if (numero === proximoSegunAfip) {
      let existeEnAfip = true;
      try {
        /** Best-effort: si AFIP no responde rápido, devolvemos error accionable al usuario antes que colgar el flujo. */
        existeEnAfip = await consultarComprobanteExisteEnAfip(
          supabase,
          arcaConfig,
          tipo,
          numero,
          { perAttemptTimeoutMs: 15_000, maxAttempts: 1 },
        );
      } catch {
        return {
          error:
            `AFIP exige emitir el comprobante fiscal n.º ${proximoSegunAfip} (último en ARCA: ${ultimoArca}), ` +
            `pero en Nexus ya hay un registro con ese número y CAE. No se pudo consultar AFIP (FECompConsultar) para comprobar si ese comprobante existe allí; reintentá en unos minutos o revisá conexión/certificado. ` +
            `Si el CAE local es erróneo, corregí desde Facturación o unificá con ARCA.`,
        };
      }
      if (!existeEnAfip) {
        const archivado = await archivarComprobanteFantasmaSiNoExisteEnAfip(
          supabase,
          ctx.tenantId,
          ctx.sucursalId,
          tipo,
          numero,
        );
        if (archivado) {
          if (process.env.NODE_ENV === 'development') {
            console.log('[ARCA][resolverNumeroParaSolicitudCae] archivado comprobante con CAE no presente en FECompConsultar; reintentando mismo número fiscal', {
              tipo,
              numero_fiscal: numero,
            });
          }
          continue;
        }
      }
      return {
        error:
          `AFIP exige emitir el comprobante fiscal n.º ${proximoSegunAfip} (último autorizado en ARCA para este PtoVta/tipo: ${ultimoArca}), ` +
          `pero en Nexus ya existe un registro con ese número y CAE. La base local está adelantada respecto de AFIP. ` +
          `Revisá el comprobante n.º ${numero} en Facturación o corregí la numeración; si el CAE es inválido o duplicado, unificá con ARCA.`,
      };
    }
    numero += 1;
    if (numero > AFIP_CBTE_NUMERO_MAX) {
      return {
        error:
          'No hay numeración fiscal disponible en el rango permitido por ARCA (1..99999999). ' +
          'Revisá punto de venta/ambiente y sincronizá numeración.',
      };
    }
  }

  return {
    error:
      'No se pudo reservar una numeración fiscal libre tras varios intentos. ' +
      'Sincronizá numeración ARCA y reintentá.',
  };
}

/** Numeración local clásica (sin ARCA o tipos no fiscales). */
export async function obtenerSiguienteNumeroComprobanteLocal(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalId: string,
  tipo: TipoComprobante,
): Promise<number> {
  return obtenerSiguienteNumeroLocal(supabase, tenantId, sucursalId, tipo);
}

/** Igual que el flujo previo a emisión con ARCA ya configurado (consulta AFIP + local). */
export async function obtenerNumeroComprobanteParaEmision(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string; sucursalId: string },
  tipo: TipoComprobante,
  arcaConfig: ArcaConfigEmision | null,
): Promise<ResolverNumeroCaeOk | { error: string }> {
  if (!arcaConfig) {
    return {
      numero: await obtenerSiguienteNumeroLocal(
        supabase,
        ctx.tenantId,
        ctx.sucursalId,
        tipo,
      ),
      fechaMinCorrelativaAfip: null,
    };
  }
  return resolverNumeroParaSolicitudCae(supabase, ctx, tipo, arcaConfig);
}
