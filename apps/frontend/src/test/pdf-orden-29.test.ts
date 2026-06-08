import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { generarPDF } from '@/lib/facturacion/pdf-generator';
import type { Database } from '@/types/database';

/**
 * Genera un PDF local con datos reales de la BD (comprobante con numero_orden = 29).
 * No emite ni modifica comprobantes.
 *
 * Requiere .env.local con NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.
 *
 *   npx vitest run src/test/pdf-orden-29.test.ts
 */
describe('PDF desde orden de venta', () => {
  it('escribe tmp/factura-orden-29.pdf desde Supabase', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.',
      );
    }

    const supabase = createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: comp, error } = await supabase
      .from('comprobante')
      .select(
        `
        *,
        cliente:cliente_id(nombre, razon_social, cuit_dni, condicion_iva, direccion),
        items:comprobante_item(
          cantidad, precio_unitario, subtotal,
          producto:producto_id(nombre, codigo, iva_porcentaje)
        )
      `,
      )
      .eq('numero_orden', 29)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }
    if (!comp) {
      throw new Error(
        'No hay comprobante con número de orden 29 en la base de datos.',
      );
    }

    const { data: tenant, error: te } = await supabase
      .from('tenant')
      .select('nombre, razon_social, cuit, domicilio, condicion_iva, punto_de_venta')
      .eq('id', comp.tenant_id)
      .single();

    if (te || !tenant) {
      throw new Error(te?.message ?? 'Tenant no encontrado');
    }

    const { data: arca } = await supabase
      .from('arca_config')
      .select('punto_de_venta')
      .eq('tenant_id', comp.tenant_id)
      .eq('sucursal_id', comp.sucursal_id)
      .maybeSingle();

    const puntoDeVenta = arca?.punto_de_venta ?? tenant.punto_de_venta ?? 1;

    let condicionVenta: string | null = null;
    if (comp.medio_pago_opcion_id) {
      const { data: mop } = await supabase
        .from('medio_pago_opcion')
        .select('medio_pago(nombre)')
        .eq('id', comp.medio_pago_opcion_id)
        .maybeSingle();
      const mp = mop?.medio_pago as { nombre: string } | null | undefined;
      condicionVenta = mp?.nombre ?? null;
    }
    if (!condicionVenta && comp.metodo_pago === 'mixto') {
      condicionVenta = 'Pago mixto';
    }

    const itemsPdf = (comp.items ?? []).map((item) => {
      const rate = item.producto?.iva_porcentaje ?? comp.iva_porcentaje;
      const ivaMonto =
        comp.iva_monto > 0 && rate != null
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
        punto_de_venta: puntoDeVenta,
        ingresos_brutos: null,
        fecha_inicio_actividades: null,
      },
      {
        nombre: comp.cliente?.nombre ?? 'Consumidor Final',
        razon_social: comp.cliente?.razon_social ?? null,
        cuit_dni: comp.cliente?.cuit_dni ?? null,
        condicion_iva: comp.cliente?.condicion_iva ?? 'consumidor_final',
        direccion: comp.cliente?.direccion ?? null,
      },
      {
        tipo: comp.tipo,
        numero: comp.numero ?? 0,
        fecha: comp.fecha,
        subtotal: comp.subtotal,
        iva_monto: comp.iva_monto,
        iva_porcentaje: comp.iva_porcentaje,
        total: comp.total,
        notas: comp.notas,
        cae: comp.cae,
        cae_vencimiento: comp.cae_vencimiento,
        total_mercaderia: comp.total_mercaderia,
        financiacion_monto: comp.financiacion_monto,
        financiacion_porcentaje: comp.financiacion_porcentaje,
        financiacion_descripcion: comp.financiacion_descripcion,
        condicion_venta: condicionVenta,
        importe_otros_tributos: null,
      },
      itemsPdf,
    );

    const outDir = path.join(process.cwd(), 'tmp');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'factura-orden-29.pdf');
    fs.writeFileSync(outPath, Buffer.from(pdf.output('arraybuffer')));

    expect(fs.existsSync(outPath)).toBe(true);

    const fileUrl = pathToFileURL(path.resolve(outPath)).href;
    // Log explícito para copiar el enlace local (file://)
    console.log('\nPDF generado:', fileUrl, '\n');
  });
});
