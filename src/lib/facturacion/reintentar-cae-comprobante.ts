import type { SupabaseClient } from '@supabase/supabase-js';

import { formatearTipoComprobante } from '@/lib/facturacion/formato';
import { generarPDF } from '@/lib/facturacion/pdf-generator';
import { solicitarCAE, type SolicitudCAE } from '@/lib/facturacion/arca/wsfe';
import type { TributoAFIP } from '@/lib/facturacion/arca/xml-builder';
import type { Database } from '@/types/database';

type ComprobanteRow = Database['public']['Tables']['comprobante']['Row'];

function caeAfipValido(cae: string | null | undefined): boolean {
  return typeof cae === 'string' && /^\d{14}$/.test(cae.trim());
}

function tipoRequiereCaeAfip(tipo: string): boolean {
  return (
    tipo === 'factura' ||
    tipo === 'nota_credito' ||
    tipo.startsWith('factura_') ||
    tipo.startsWith('nota_credito_')
  );
}

function construirSolicitudCaeDesdeComprobante(
  row: Pick<
    ComprobanteRow,
    | 'tipo'
    | 'numero'
    | 'fecha'
    | 'subtotal'
    | 'iva_monto'
    | 'total'
    | 'iva_porcentaje'
    | 'financiacion_monto'
    | 'total_mercaderia'
    | 'financiacion_porcentaje'
    | 'financiacion_descripcion'
  >,
  tenantId: string,
  clienteCuitDni: string | null,
): SolicitudCAE {
  const impTribRaw =
    row.financiacion_monto != null ? Number(row.financiacion_monto) : 0;
  const impTrib = impTribRaw > 0.001 ? impTribRaw : 0;

  let tributos: TributoAFIP[] | undefined;
  if (impTrib > 0.001) {
    const baseMerc =
      row.total_mercaderia != null
        ? Number(row.total_mercaderia)
        : Number(row.total) - impTrib;
    const pctFin =
      row.financiacion_porcentaje != null ? Number(row.financiacion_porcentaje) : 0;
    tributos = [
      {
        id: 99,
        descripcion: row.financiacion_descripcion?.trim() || 'Recargo financiero',
        baseImp: baseMerc,
        alicuota: Math.abs(pctFin),
        importe: impTrib,
      },
    ];
  }

  return {
    tenantId,
    tipo: row.tipo,
    numero: row.numero,
    fecha: row.fecha,
    clienteCuitDni,
    importeTotal: Number(row.total),
    importeNeto: Number(row.subtotal),
    importeIVA: Number(row.iva_monto),
    alicuotaIVA: Number(row.iva_porcentaje),
    impTrib: impTrib > 0.001 ? impTrib : undefined,
    tributos,
  };
}

export type ReintentarCaeResult =
  | { ok: true; cae: string; cae_vencimiento: string | null; pdf_url: string | null }
  | { ok: false; status: number; error: string };

/**
 * Vuelve a solicitar CAE para un comprobante ya grabado (sin stock ni numeración nueva).
 * Estados admitidos: `error_arca`, `pendiente_arca`, sin CAE válido.
 */
export async function reintentarCaeComprobante(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string },
  comprobanteId: string,
): Promise<ReintentarCaeResult> {
  const { data: modulo } = await supabase
    .from('modulo_config')
    .select('facturador_arca')
    .maybeSingle();

  if (!modulo || !(modulo as { facturador_arca?: boolean }).facturador_arca) {
    return { ok: false, status: 400, error: 'El facturador ARCA no está habilitado.' };
  }

  const { data: comp, error: compErr } = await supabase
    .from('comprobante')
    .select(
      `
      id,
      tenant_id,
      tipo,
      numero,
      fecha,
      estado,
      cae,
      subtotal,
      iva_monto,
      iva_porcentaje,
      total,
      notas,
      metodo_pago,
      total_mercaderia,
      financiacion_monto,
      financiacion_porcentaje,
      financiacion_descripcion,
      cliente_id,
      pdf_url
    `,
    )
    .eq('id', comprobanteId)
    .maybeSingle();

  if (compErr) {
    return { ok: false, status: 500, error: compErr.message };
  }
  if (!comp || comp.tenant_id !== ctx.tenantId) {
    return { ok: false, status: 404, error: 'Comprobante no encontrado.' };
  }

  if (!tipoRequiereCaeAfip(comp.tipo)) {
    return {
      ok: false,
      status: 400,
      error: `Este tipo de comprobante (${formatearTipoComprobante(comp.tipo)}) no se fiscaliza por ARCA.`,
    };
  }

  if (!['error_arca', 'pendiente_arca'].includes(comp.estado)) {
    return {
      ok: false,
      status: 400,
      error: 'Solo se puede reintentar ARCA en comprobantes con error o pendiente de autorización.',
    };
  }

  if (caeAfipValido(comp.cae)) {
    return { ok: false, status: 400, error: 'El comprobante ya tiene CAE.' };
  }

  const { data: arcaConfig } = await supabase
    .from('arca_config')
    .select('tenant_id, cuit_emisor, punto_de_venta, ambiente')
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();

  if (!arcaConfig?.cuit_emisor || arcaConfig.punto_de_venta == null) {
    return { ok: false, status: 400, error: 'Configuración ARCA incompleta (CUIT o punto de venta).' };
  }

  let clienteCuit: string | null = null;
  if (comp.cliente_id) {
    const { data: cl } = await supabase
      .from('cliente')
      .select('cuit_dni')
      .eq('id', comp.cliente_id)
      .maybeSingle();
    clienteCuit = cl?.cuit_dni ?? null;
  }

  const solicitud = construirSolicitudCaeDesdeComprobante(comp, ctx.tenantId, clienteCuit);

  const resultado = await solicitarCAE(
    supabase,
    {
      tenant_id: arcaConfig.tenant_id,
      cuit_emisor: arcaConfig.cuit_emisor,
      punto_de_venta: arcaConfig.punto_de_venta,
      ambiente: arcaConfig.ambiente,
    },
    solicitud,
    comp.id,
  );

  if (resultado.aprobado && resultado.cae) {
    await supabase
      .from('comprobante')
      .update({
        cae: resultado.cae,
        cae_vencimiento: resultado.caeVencimiento,
        estado: 'emitido' as never,
      })
      .eq('id', comp.id);

    const { data: tenant } = await supabase
      .from('tenant')
      .select('nombre, razon_social, cuit, domicilio, condicion_iva, punto_de_venta')
      .eq('id', ctx.tenantId)
      .maybeSingle();

    let clientePdf: {
      nombre: string;
      razon_social: string | null;
      cuit_dni: string | null;
      condicion_iva: string;
      direccion: string | null;
    } = {
      nombre: 'Consumidor Final',
      razon_social: null,
      cuit_dni: null,
      condicion_iva: 'consumidor_final',
      direccion: null,
    };
    if (comp.cliente_id) {
      const { data: clienteDb } = await supabase
        .from('cliente')
        .select('nombre, razon_social, cuit_dni, condicion_iva, direccion')
        .eq('id', comp.cliente_id)
        .maybeSingle();
      if (clienteDb) {
        clientePdf = {
          nombre: clienteDb.nombre,
          razon_social: clienteDb.razon_social,
          cuit_dni: clienteDb.cuit_dni,
          condicion_iva: clienteDb.condicion_iva ?? 'consumidor_final',
          direccion: clienteDb.direccion,
        };
      }
    }

    const { data: itemsRows } = await supabase
      .from('comprobante_item')
      .select(
        'cantidad, precio_unitario, subtotal, producto:producto_id(nombre, codigo, iva_porcentaje)',
      )
      .eq('comprobante_id', comp.id);

    const puntoDeVenta = arcaConfig.punto_de_venta ?? tenant?.punto_de_venta ?? 1;
    const ivaFallback = Number(comp.iva_porcentaje);

    const mostrarFinanciacion =
      comp.total_mercaderia != null ||
      (comp.financiacion_monto != null &&
        Math.abs(Number(comp.financiacion_monto)) > 0.001);

    const pdfFinanciacion = {
      total_mercaderia: mostrarFinanciacion ? comp.total_mercaderia : null,
      financiacion_monto: mostrarFinanciacion ? comp.financiacion_monto : null,
      financiacion_porcentaje: mostrarFinanciacion ? comp.financiacion_porcentaje : null,
      financiacion_descripcion: mostrarFinanciacion ? comp.financiacion_descripcion : null,
    };

    const otrosTributosPdf =
      comp.financiacion_monto != null && Number(comp.financiacion_monto) > 0.005
        ? Number(comp.financiacion_monto)
        : null;

    const itemsPDF = (itemsRows ?? []).map((item) => {
      const prod = item.producto as {
        nombre: string;
        codigo: string | null;
        iva_porcentaje: number | null;
      } | null;
      const rate = prod?.iva_porcentaje ?? ivaFallback;
      const lineGross = Number(item.subtotal);
      const lineIva =
        comp.iva_monto > 0 && rate
          ? Math.round(((lineGross * rate) / (100 + rate)) * 100) / 100
          : 0;
      return {
        cantidad: Number(item.cantidad),
        descripcion: prod?.nombre ?? '—',
        codigo: prod?.codigo ?? null,
        unidad_medida: 'unidades',
        precio_unitario: Number(item.precio_unitario),
        subtotal: lineGross,
        iva_porcentaje: rate,
        iva_monto: lineIva,
      };
    });

    let pdfUrl: string | null = comp.pdf_url;

    if (tenant && itemsPDF.length > 0) {
      const pdf = generarPDF(
        {
          nombre: tenant.nombre,
          razon_social: tenant.razon_social,
          cuit: tenant.cuit,
          domicilio: tenant.domicilio,
          condicion_iva: tenant.condicion_iva ?? 'consumidor_final',
          punto_de_venta: puntoDeVenta,
        },
        {
          nombre: clientePdf.nombre,
          razon_social: clientePdf.razon_social,
          cuit_dni: clientePdf.cuit_dni,
          condicion_iva: clientePdf.condicion_iva ?? 'consumidor_final',
          direccion: clientePdf.direccion,
        },
        {
          tipo: comp.tipo,
          numero: comp.numero,
          fecha: comp.fecha,
          subtotal: Number(comp.subtotal),
          iva_monto: Number(comp.iva_monto),
          iva_porcentaje: Number(comp.iva_porcentaje),
          total: Number(comp.total),
          notas: comp.notas,
          cae: resultado.cae,
          cae_vencimiento: resultado.caeVencimiento,
          condicion_venta: comp.metodo_pago?.trim() || null,
          importe_otros_tributos: otrosTributosPdf,
          ...pdfFinanciacion,
        },
        itemsPDF,
      );

      const pdfBuffer = Buffer.from(pdf.output('arraybuffer'));
      const pdfPath = `${ctx.tenantId}/comprobantes/${comp.tipo}_${comp.numero}.pdf`;

      const { error: uploadError } = await supabase.storage
        .from('comprobantes')
        .upload(pdfPath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (!uploadError) {
        const { data: publicUrl } = supabase.storage.from('comprobantes').getPublicUrl(pdfPath);
        pdfUrl = publicUrl.publicUrl;
        await supabase.from('comprobante').update({ pdf_url: pdfUrl }).eq('id', comp.id);
      }
    }

    return {
      ok: true,
      cae: resultado.cae,
      cae_vencimiento: resultado.caeVencimiento,
      pdf_url: pdfUrl,
    };
  }

  if (resultado.errores.some((e) => e.codigo === 'NETWORK')) {
    await supabase
      .from('comprobante')
      .update({ estado: 'pendiente_arca' as never })
      .eq('id', comp.id);

    return {
      ok: false,
      status: 503,
      error:
        resultado.errores[0]?.mensaje ??
        'Sin respuesta de ARCA. Quedó pendiente; podés reintentar cuando la red esté estable.',
    };
  }

  await supabase
    .from('comprobante')
    .update({ estado: 'error_arca' as never })
    .eq('id', comp.id);

  const msg =
    resultado.errores.map((e) => `${e.codigo}: ${e.mensaje}`).join(' · ') ||
    resultado.observaciones.map((o) => `${o.codigo}: ${o.mensaje}`).join(' · ') ||
    'ARCA rechazó la solicitud de CAE.';

  return { ok: false, status: 422, error: msg };
}
