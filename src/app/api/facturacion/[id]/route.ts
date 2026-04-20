import { NextResponse } from 'next/server';

import { extraerPuntoDeVentaDesdeXml } from '@/lib/facturacion/arca/punto-venta';
import { generarPDF } from '@/lib/facturacion/pdf-generator';
import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('facturador_simple');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { id } = await params;

  const { data, error } = await session.supabase
    .from('comprobante')
    .select(
      '*, cliente:cliente_id(nombre, razon_social, cuit_dni, condicion_iva, direccion), usuario:usuario_id(nombre, apellido), items:comprobante_item(id, producto_id, cantidad, precio_unitario, subtotal, precio_costo, producto:producto_id(nombre, codigo, iva_porcentaje, stock_actual, activo))',
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: 'Comprobante no encontrado' },
      { status: 404 },
    );
  }

  let puntoDeVenta: number | null = null;

  const { data: arcaLog } = await session.supabase
    .from('arca_log')
    .select('request_xml')
    .eq('comprobante_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  puntoDeVenta = extraerPuntoDeVentaDesdeXml(arcaLog?.request_xml);

  if (puntoDeVenta == null) {
    const { data: arcaConfig } = await session.supabase
      .from('arca_config')
      .select('punto_de_venta')
      .eq('tenant_id', data.tenant_id)
      .maybeSingle();

    puntoDeVenta = arcaConfig?.punto_de_venta ?? null;
  }

  let pdfUrl: string | null = data.pdf_url;
  let pdfPath: string | null = null;

  if (data.pdf_url && data.estado === 'emitido') {
    pdfPath = `${data.tenant_id}/comprobantes/${data.tipo}_${data.numero}.pdf`;
  }

  if (!pdfUrl && data.estado === 'emitido') {
    const { data: tenant } = await session.supabase
      .from('tenant')
      .select('nombre, razon_social, cuit, domicilio, condicion_iva')
      .eq('id', data.tenant_id)
      .maybeSingle();

    if (tenant) {
      const itemsPdf = (data.items ?? []).map((item) => {
        const rate = item.producto?.iva_porcentaje ?? data.iva_porcentaje;
        const ivaMonto =
          data.iva_monto > 0 && rate != null
            ? Math.round(((item.subtotal * rate) / (100 + rate)) * 100) / 100
            : 0;

        return {
          cantidad: item.cantidad,
          descripcion: item.producto?.nombre ?? 'Producto',
          codigo: item.producto?.codigo ?? null,
          unidad_medida: 'unidades',
          precio_unitario: item.precio_unitario,
          subtotal: item.subtotal,
          iva_porcentaje: rate,
          iva_monto: ivaMonto,
        };
      });

      const pdf = generarPDF(
        {
          nombre: tenant.nombre,
          razon_social: tenant.razon_social,
          cuit: tenant.cuit,
          domicilio: tenant.domicilio,
          condicion_iva: tenant.condicion_iva ?? 'consumidor_final',
          punto_de_venta: puntoDeVenta ?? 1,
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
        },
        itemsPdf,
      );

      const pdfBuffer = Buffer.from(pdf.output('arraybuffer'));
      const uploadPath = `${data.tenant_id}/comprobantes/${data.tipo}_${data.numero}.pdf`;

      // Usamos service role porque el bucket es privado y las policies de storage
      // pueden no estar alineadas con el claim de tenant del JWT; la autorización
      // ya se validó arriba via getTenantSession + moduloGuard.
      const admin = createServiceRoleClient();

      const { error: uploadErr } = await admin.storage
        .from('comprobantes')
        .upload(uploadPath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (uploadErr) {
        console.error(
          '[GET /api/facturacion/[id]] PDF backfill upload falló:',
          uploadErr.message,
          { comprobanteId: data.id, pdfPath: uploadPath },
        );
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
          console.error(
            '[GET /api/facturacion/[id]] pdf_url no se pudo guardar:',
            updateErr.message,
            { comprobanteId: data.id },
          );
        }
      }
    }
  }

  // El bucket `comprobantes` es privado: generamos una signed URL fresca
  // al momento de responder, así el navegador puede descargar sin depender
  // de las policies de SELECT (que están desalineadas con el JWT).
  if (pdfPath) {
    const admin = createServiceRoleClient();
    const { data: signed, error: signErr } = await admin.storage
      .from('comprobantes')
      .createSignedUrl(pdfPath, 60 * 60); // 1 hora
    if (signErr) {
      console.error(
        '[GET /api/facturacion/[id]] no se pudo firmar pdf:',
        signErr.message,
        { comprobanteId: data.id, pdfPath },
      );
    } else {
      pdfUrl = signed.signedUrl;
    }
  }

  let facturaFiscal: { id: string; tipo: string; numero: number } | null = null;
  const fid = (data as { fiscalizado_por_id?: string | null }).fiscalizado_por_id;
  if (fid) {
    const { data: fac } = await session.supabase
      .from('comprobante')
      .select('id, tipo, numero')
      .eq('id', fid)
      .maybeSingle();
    if (fac) facturaFiscal = fac;
  }

  return NextResponse.json({
    ...data,
    punto_de_venta: puntoDeVenta,
    pdf_url: pdfUrl,
    factura_fiscal: facturaFiscal,
  });
}
