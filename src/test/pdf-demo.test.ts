import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { generarPDF } from '@/lib/facturacion/pdf-generator';

/**
 * No toca Supabase ni emite comprobantes: solo genera un PDF de muestra en disco.
 *
 * Ejecutar: pnpm pdf:demo  (o: npx vitest run src/test/pdf-demo.test.ts)
 */
describe('PDF demo (solo archivo local)', () => {
  it('escribe tmp/factura-demo.pdf', () => {
    const outDir = path.join(process.cwd(), 'tmp');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'factura-demo.pdf');

    const emisor = {
      nombre: 'Mi negocio',
      razon_social: 'ALONSO BULACIO NICOLAS ENRIQUE',
      cuit: '20419506665',
      domicilio: 'Catamarca 1600 - Yerba Buena, Tucumán',
      condicion_iva: 'monotributista' as const,
      punto_de_venta: 3,
      ingresos_brutos: '20432026737',
      fecha_inicio_actividades: '2020-06-01',
    };

    const cliente = {
      nombre: 'Consumidor Final',
      razon_social: 'CARROCERIAS SALDIVIA SA',
      cuit_dni: '30717190854',
      condicion_iva: 'responsable_inscripto' as const,
      direccion: 'Ruta Pcial 21 Km 7 Lote 0004 0 - Alvear, Santa Fe',
    };

    const comprobanteBase = {
      tipo: 'factura_c',
      numero: 9,
      fecha: '2026-04-20',
      notas: 'Fiscaliza ticket n.º 19.',
      cae: '86162345699675',
      cae_vencimiento: '2026-04-30',
      condicion_venta: 'Transferencia Bancaria',
      importe_otros_tributos: null as number | null,
    };

    const items = [
      {
        cantidad: 1,
        descripcion: 'BULON REDONDA ZN 1/4X1 c/tcas. (cj x1100un)',
        codigo: 'GBR1/4X1',
        unidad_medida: 'unidades',
        precio_unitario: 142.54,
        subtotal: 142.54,
      },
    ];

    // Caso A: Factura C simple (sin descuento financiero)
    const docSimple = generarPDF(
      emisor,
      cliente,
      {
        ...comprobanteBase,
        subtotal: 142.54,
        iva_monto: 0,
        iva_porcentaje: 0,
        total: 142.54,
        total_mercaderia: null,
        financiacion_monto: null,
        financiacion_porcentaje: null,
        financiacion_descripcion: null,
      },
      items,
    );

    // Caso B: con descuento por efectivo (misma data que el PDF “desprolijo”)
    const totalMercaderia = 142.54;
    const descuento = -14.25;
    const totalFinal = totalMercaderia + descuento;

    const docConFin = generarPDF(
      emisor,
      { ...cliente, razon_social: null, nombre: 'Consumidor Final', cuit_dni: null, direccion: null },
      {
        ...comprobanteBase,
        subtotal: 128.29,
        iva_monto: 0,
        iva_porcentaje: 0,
        total: totalFinal,
        total_mercaderia: totalMercaderia,
        financiacion_monto: descuento,
        financiacion_porcentaje: -10,
        financiacion_descripcion: 'Efectivo (contado, 10% desc.)',
      },
      items,
    );

    const buf = Buffer.from(docConFin.output('arraybuffer'));
    fs.writeFileSync(outPath, buf);

    expect(buf.byteLength).toBeGreaterThan(2000);
    expect(fs.existsSync(outPath)).toBe(true);

    // Segundo archivo opcional para comparar layout sin financiación
    fs.writeFileSync(
      path.join(outDir, 'factura-demo-sin-financiacion.pdf'),
      Buffer.from(docSimple.output('arraybuffer')),
    );
  });
});
