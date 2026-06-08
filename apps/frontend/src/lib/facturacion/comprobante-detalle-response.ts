import { NextResponse } from 'next/server';

import type { TenantSession } from '@/lib/api/tenant-session';
import { lineaCajaTicketDesdeCajaUuid } from '@/lib/caja/linea-caja-etiqueta';
import { normalizarPorcentajeManual } from '@/lib/facturacion/ajuste-comercial';
import { buildQrArcaUrl } from '@/lib/facturacion/arca/qr';
import { extraerPuntoDeVentaDesdeXml } from '@/lib/facturacion/arca/punto-venta';
import { fetchLogoDataUrlForPdf } from '@/lib/facturacion/pdf-emisor-logo';
import { generarPDF } from '@/lib/facturacion/pdf-generator';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { formatCurrency } from '@/lib/utils/formatters';
import type { Database } from '@/types/database';

type TenantSessionOk = Exclude<TenantSession, { error: NextResponse }>;

type DetalleOpts = {
  /** Si se indica, solo responde si el comprobante es de ese tipo (si no, 404). */
  soloTipo?: Database['public']['Enums']['tipo_comprobante'];
  logTag?: string;
  sucursalId?: string;
};

/**
 * Carga un comprobante con ítems, cliente y PDF (backfill + signed URL si aplica).
 * Compartido entre GET /api/facturacion/[id] y GET /api/presupuestos/[id].
 */
export async function comprobanteDetalleJsonResponse(
  session: TenantSessionOk,
  comprobanteId: string,
  opts?: DetalleOpts,
): Promise<NextResponse> {
  const tag = opts?.logTag ?? '[comprobanteDetalle]';

  let comprobanteQuery = session.supabase
    .from('comprobante')
    .select(
      '*, cliente:cliente_id(nombre, razon_social, cuit_dni, condicion_iva, direccion), proveedor:proveedor_id(nombre, cuit), usuario:usuario_id(nombre, apellido), sucursal:sucursal_id(id, nombre, codigo), anulado_por_usuario:usuario!comprobante_anulado_por_fkey(nombre, apellido), items:comprobante_item(id, producto_id, producto_variante_id, producto_variante_etiqueta, cantidad, precio_unitario, subtotal, precio_costo, promocion_descripcion, precio_unitario_original, descuento_promo_monto, descuento_manual_pct, recargo_manual_pct, producto:producto_id(nombre, codigo, codigo_barras, iva_porcentaje, unidad, es_pesable, stock_actual, activo))',
    )
    .eq('id', comprobanteId)
    .eq('tenant_id', session.tenantId);
  if (opts?.sucursalId) {
    comprobanteQuery = comprobanteQuery.eq('sucursal_id', opts.sucursalId);
  }
  const { data, error } = await comprobanteQuery.maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
  }

  if (opts?.soloTipo && data.tipo !== opts.soloTipo) {
    return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
  }

  let puntoDeVenta: number | null = null;

  const { data: arcaLog } = await session.supabase
    .from('arca_log')
    .select('request_xml')
    .eq('comprobante_id', comprobanteId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  puntoDeVenta = extraerPuntoDeVentaDesdeXml(arcaLog?.request_xml);

  if (puntoDeVenta == null) {
    const { data: arcaConfig } = await session.supabase
      .from('arca_config')
      .select('punto_de_venta')
      .eq('tenant_id', data.tenant_id)
      .eq('sucursal_id', data.sucursal_id)
      .maybeSingle();

    puntoDeVenta = arcaConfig?.punto_de_venta ?? null;
  }

  let pdfUrl: string | null = data.pdf_url;
  let pdfPath: string | null = null;

  if (data.pdf_url && data.estado === 'emitido' && data.numero != null) {
    pdfPath = `${data.tenant_id}/comprobantes/${data.tipo}_${data.numero}.pdf`;
  }

  if (!pdfUrl && data.estado === 'emitido' && data.numero != null) {
    const { data: tenant } = await session.supabase
      .from('tenant')
      .select('nombre, razon_social, cuit, domicilio, condicion_iva, logo_url')
      .eq('id', data.tenant_id)
      .maybeSingle();

    if (tenant) {
      const logoDataUrl = await fetchLogoDataUrlForPdf(tenant.logo_url);
      const itemsRaw = data.items ?? [];
      const ahorroPromoBackfill =
        Math.round(
          itemsRaw.reduce(
            (s, it: { descuento_promo_monto?: number | string | null }) =>
              s + (Number(it.descuento_promo_monto) || 0),
            0,
          ) * 100,
        ) / 100;

      const itemsPdf = itemsRaw.map((item: {
        cantidad: number;
        precio_unitario: number;
        subtotal: number;
        promocion_descripcion?: string | null;
        precio_unitario_original?: number | null;
        descuento_promo_monto?: number | null;
        descuento_manual_pct?: number | null;
        recargo_manual_pct?: number | null;
        producto?: {
          nombre?: string;
          codigo?: string | null;
          iva_porcentaje?: number | null;
        } | null;
      }) => {
        const rate = item.producto?.iva_porcentaje ?? data.iva_porcentaje;
        const ivaMonto =
          data.iva_monto > 0 && rate != null
            ? Math.round(((item.subtotal * rate) / (100 + rate)) * 100) / 100
            : 0;
        const promoDesc =
          typeof item.promocion_descripcion === 'string' && item.promocion_descripcion.trim() !== ''
            ? item.promocion_descripcion.trim()
            : null;
        const nombre = item.producto?.nombre ?? 'Producto';
        const listaPu =
          item.precio_unitario_original != null
            ? Number(item.precio_unitario_original)
            : Number(item.precio_unitario);
        const eff = Number(item.precio_unitario);
        return {
          cantidad: item.cantidad,
          descripcion: promoDesc ? `${nombre} — ${promoDesc}` : nombre,
          codigo: item.producto?.codigo ?? null,
          unidad_medida: 'unidades',
          precio_unitario: listaPu,
          precio_unitario_efectivo:
            Math.abs(eff - listaPu) > 0.0005 ? eff : null,
          descuento_promo_monto:
            item.descuento_promo_monto != null ? Number(item.descuento_promo_monto) : null,
          descuento_manual_pct: normalizarPorcentajeManual(item.descuento_manual_pct),
          recargo_manual_pct: normalizarPorcentajeManual(item.recargo_manual_pct),
          subtotal: item.subtotal,
          iva_porcentaje: rate,
          iva_monto: ivaMonto,
        };
      });

      const compRow = data as Record<string, unknown>;
      const dg = normalizarPorcentajeManual(compRow.descuento_global_pct);
      const rg = normalizarPorcentajeManual(compRow.recargo_global_pct);
      const dgm = Number(compRow.descuento_global_monto ?? 0);
      const rgm = Number(compRow.recargo_global_monto ?? 0);
      const ajusteGlobalTextoParts: string[] = [];
      if (dg > 0.0005) ajusteGlobalTextoParts.push(`Desc. ${dg}%`);
      if (rg > 0.0005) ajusteGlobalTextoParts.push(`Rec. ${rg}%`);
      if (Number.isFinite(dgm) && dgm > 0.005) ajusteGlobalTextoParts.push(`Desc. ${formatCurrency(dgm)}`);
      if (Number.isFinite(rgm) && rgm > 0.005) ajusteGlobalTextoParts.push(`Rec. ${formatCurrency(rgm)}`);
      const ajusteComercialGlobalTexto =
        ajusteGlobalTextoParts.length > 0 ? ajusteGlobalTextoParts.join(' · ') : null;

      const impFin =
        data.financiacion_monto != null && Number(data.financiacion_monto) > 0.005
          ? Number(data.financiacion_monto)
          : 0;
      const impCom =
        compRow.imp_trib_comercial != null && Number(compRow.imp_trib_comercial) > 0.005
          ? Number(compRow.imp_trib_comercial)
          : 0;
      const otrosTribBackfill =
        Math.round((impFin + impCom) * 100) / 100 > 0.005
          ? Math.round((impFin + impCom) * 100) / 100
          : null;

      const pdf = generarPDF(
        {
          nombre: tenant.nombre,
          razon_social: tenant.razon_social,
          cuit: tenant.cuit,
          domicilio: tenant.domicilio,
          condicion_iva: tenant.condicion_iva ?? 'consumidor_final',
          punto_de_venta: puntoDeVenta ?? 1,
          logo_data_url: logoDataUrl,
        },
        {
          nombre: data.cliente?.nombre ?? 'Consumidor Final',
          razon_social: data.cliente?.razon_social ?? null,
          cuit_dni: data.cliente?.cuit_dni ?? null,
          condicion_iva: data.cliente?.condicion_iva ?? 'consumidor_final',
          direccion: data.cliente?.direccion ?? null,
        },
        {
          tipo: data.tipo,
          numero: data.numero,
          fecha: data.fecha,
          subtotal: data.subtotal,
          iva_monto: data.iva_monto,
          iva_porcentaje: data.iva_porcentaje,
          total: data.total,
          notas: data.notas,
          cae: data.cae,
          cae_vencimiento: data.cae_vencimiento,
          total_mercaderia: data.total_mercaderia,
          financiacion_monto: data.financiacion_monto,
          financiacion_porcentaje: data.financiacion_porcentaje,
          financiacion_descripcion: data.financiacion_descripcion,
          ahorro_promociones: ahorroPromoBackfill > 0.005 ? ahorroPromoBackfill : null,
          ajuste_comercial_global_texto: ajusteComercialGlobalTexto,
          importe_otros_tributos: otrosTribBackfill,
        },
        itemsPdf,
      );

      const pdfBuffer = Buffer.from(pdf.output('arraybuffer'));
      const uploadPath = `${data.tenant_id}/comprobantes/${data.tipo}_${data.numero}.pdf`;

      const admin = createServiceRoleClient();

      const { error: uploadErr } = await admin.storage
        .from('comprobantes')
        .upload(uploadPath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (uploadErr) {
        console.error(`${tag} PDF backfill upload falló:`, uploadErr.message, {
          comprobanteId: data.id,
          pdfPath: uploadPath,
        });
      } else {
        pdfPath = uploadPath;
        const { data: publicUrl } = admin.storage
          .from('comprobantes')
          .getPublicUrl(uploadPath);
        pdfUrl = publicUrl.publicUrl;
        const { error: updateErr } = await session.supabase
          .from('comprobante')
          .update({ pdf_url: pdfUrl })
          .eq('id', data.id);
        if (updateErr) {
          console.error(`${tag} pdf_url no se pudo guardar:`, updateErr.message, {
            comprobanteId: data.id,
          });
        }
      }
    }
  }

  if (pdfPath) {
    const admin = createServiceRoleClient();
    const { data: signed, error: signErr } = await admin.storage
      .from('comprobantes')
      .createSignedUrl(pdfPath, 60 * 60);
    if (signErr) {
      console.error(`${tag} no se pudo firmar pdf:`, signErr.message, {
        comprobanteId: data.id,
        pdfPath,
      });
    } else {
      pdfUrl = signed.signedUrl;
    }
  }

  let facturaFiscal: { id: string; tipo: string; numero: number | null } | null = null;
  const fid = (data as { fiscalizado_por_id?: string | null }).fiscalizado_por_id;
  if (fid) {
    let facQuery = session.supabase
      .from('comprobante')
      .select('id, tipo, numero')
      .eq('id', fid)
      .eq('tenant_id', session.tenantId);
    if (opts?.sucursalId) {
      facQuery = facQuery.eq('sucursal_id', opts.sucursalId);
    }
    const { data: fac } = await facQuery.maybeSingle();
    if (fac) facturaFiscal = fac;
  }

  let ticketOrigen: { id: string; numero: number | null; numero_caja: number | null } | null = null;
  const tipoRow = data.tipo as string;
  if (
    (tipoRow === 'factura_a' || tipoRow === 'factura_b' || tipoRow === 'factura_c') &&
    data.numero_orden != null
  ) {
    let ticketQuery = session.supabase
      .from('comprobante')
      .select('id, numero, numero_caja')
      .eq('tenant_id', data.tenant_id)
      .eq('numero_orden', data.numero_orden)
      .eq('tipo', 'ticket')
      .eq('estado', 'emitido')
      .neq('id', data.id);
    if (opts?.sucursalId) {
      ticketQuery = ticketQuery.eq('sucursal_id', opts.sucursalId);
    }
    const { data: tick } = await ticketQuery.maybeSingle();
    if (tick) ticketOrigen = tick;
  }

  let remitoOrigen: { id: string; numero: number | null } | null = null;
  const docAsocId = (data as { documento_asociado_id?: string | null }).documento_asociado_id;
  if (tipoRow === 'devolucion_remito' && docAsocId) {
    let remQuery = session.supabase
      .from('comprobante')
      .select('id, numero, tipo')
      .eq('id', docAsocId)
      .eq('tenant_id', session.tenantId);
    if (opts?.sucursalId) {
      remQuery = remQuery.eq('sucursal_id', opts.sucursalId);
    }
    const { data: rem } = await remQuery.maybeSingle();
    if (rem?.tipo === 'remito') {
      remitoOrigen = { id: rem.id, numero: rem.numero };
    }
  }

  let arcaQrUrl: string | null = null;
  const tipoFiscalArca = tipoRow.startsWith('factura_') || tipoRow.startsWith('nota_credito_');
  const caeTrim = data.cae != null ? String(data.cae).trim() : '';
  if (
    tipoFiscalArca &&
    /^\d{14}$/.test(caeTrim) &&
    data.numero != null &&
    data.estado === 'emitido'
  ) {
    const { data: tenantCuit } = await session.supabase
      .from('tenant')
      .select('cuit')
      .eq('id', data.tenant_id)
      .maybeSingle();
    if (tenantCuit?.cuit) {
      try {
        arcaQrUrl = buildQrArcaUrl({
          cuitEmisor: tenantCuit.cuit,
          puntoVenta: puntoDeVenta ?? 1,
          tipoComprobante: tipoRow,
          numero: data.numero,
          importeTotal: Math.abs(Number(data.total)),
          fechaYmd: String(data.fecha).slice(0, 10),
          cae: caeTrim,
          clienteCuitDni: (data as { cliente?: { cuit_dni?: string | null } | null }).cliente
            ?.cuit_dni ?? null,
        });
      } catch (e) {
        console.error(`${tag} buildQrArcaUrl:`, e);
      }
    }
  }

  const rowExtras = data as Record<string, unknown>;
  const cajaUuidDet =
    typeof rowExtras.caja_uuid === 'string' && rowExtras.caja_uuid.trim() !== ''
      ? rowExtras.caja_uuid.trim()
      : null;
  const linea_caja_ticket = cajaUuidDet
    ? await lineaCajaTicketDesdeCajaUuid(session.supabase, cajaUuidDet)
    : null;

  let actualizacionesCostosFactura: {
    producto_id: string;
    codigo: string | null;
    codigo_barras: string | null;
    nombre: string;
    precio_costo_anterior: number | null;
    precio_costo_nuevo: number | null;
    precio_venta_anterior: number | null;
    precio_venta_nuevo: number | null;
    variacion_pct: number | null;
  }[] = [];

  if (data.tipo_operacion === 'compra' && data.estado === 'importado') {
    const items = (data.items ?? []) as {
      producto_id?: string | null;
      precio_costo?: number | string | null;
      producto?: {
        nombre?: string | null;
        codigo?: string | null;
        codigo_barras?: string | null;
      } | null;
    }[];
    const productoIds = [...new Set(items.map((it) => it.producto_id).filter((id): id is string => Boolean(id)))];
    if (productoIds.length > 0) {
      const desde = new Date(new Date(data.created_at).getTime() - 2 * 60 * 1000).toISOString();
      const hasta = new Date(new Date(data.created_at).getTime() + 20 * 60 * 1000).toISOString();
      const { data: historial, error: historialErr } = await session.supabase
        .from('precio_historial')
        .select('producto_id, precio_costo_anterior, precio_costo_nuevo, precio_venta_anterior, precio_venta_nuevo, created_at')
        .eq('tenant_id', session.tenantId)
        .eq('origen', 'factura_recibida')
        .in('producto_id', productoIds)
        .gte('created_at', desde)
        .lte('created_at', hasta)
        .order('created_at', { ascending: false });

      if (historialErr) {
        console.error(`${tag} precio_historial factura importada:`, historialErr.message);
      } else {
        const costoPorProducto = new Map(
          items.map((it) => [it.producto_id, Number(it.precio_costo ?? NaN)] as const),
        );
        const itemPorProducto = new Map(items.map((it) => [it.producto_id, it] as const));
        const vistos = new Set<string>();
        actualizacionesCostosFactura = (historial ?? [])
          .filter((h) => {
            if (vistos.has(h.producto_id)) return false;
            const costoLinea = costoPorProducto.get(h.producto_id);
            const nuevo = Number(h.precio_costo_nuevo);
            if (costoLinea == null || !Number.isFinite(costoLinea) || !Number.isFinite(nuevo)) return false;
            if (Math.abs(costoLinea - nuevo) > 0.01) return false;
            vistos.add(h.producto_id);
            return true;
          })
          .map((h) => {
            const item = itemPorProducto.get(h.producto_id);
            const anterior =
              h.precio_costo_anterior == null ? null : Number(h.precio_costo_anterior);
            const nuevo = h.precio_costo_nuevo == null ? null : Number(h.precio_costo_nuevo);
            const variacionPct =
              anterior != null && anterior > 0 && nuevo != null
                ? Math.round(((nuevo - anterior) / anterior) * 10_000) / 100
                : null;
            return {
              producto_id: h.producto_id,
              codigo: item?.producto?.codigo ?? null,
              codigo_barras: item?.producto?.codigo_barras ?? null,
              nombre: item?.producto?.nombre?.trim() || 'Producto sin nombre',
              precio_costo_anterior: anterior,
              precio_costo_nuevo: nuevo,
              precio_venta_anterior:
                h.precio_venta_anterior == null ? null : Number(h.precio_venta_anterior),
              precio_venta_nuevo:
                h.precio_venta_nuevo == null ? null : Number(h.precio_venta_nuevo),
              variacion_pct: variacionPct,
            };
          });
      }
    }
  }

  return NextResponse.json({
    ...data,
    punto_de_venta: puntoDeVenta,
    pdf_url: pdfUrl,
    factura_fiscal: facturaFiscal,
    ticket_origen: ticketOrigen,
    remito_origen: remitoOrigen,
    arca_qr_url: arcaQrUrl,
    actualizaciones_costos_factura: actualizacionesCostosFactura,
    ...(linea_caja_ticket ? { linea_caja_ticket } : {}),
  });
}
