import { describe, expect, it } from 'vitest';

import {
  hashImpactoLectorFactura,
  prepararConfirmacionLectorFactura,
} from './confirmacion-chatbot';
import { numeroComprobanteImportado } from './numero-importado';
import type { LectorFacturaPreviewPayload } from './procesar-factura-ia';

type Row = Record<string, any>;

class MockQuery implements PromiseLike<{ data: any; error: any }> {
  constructor(
    private tables: Record<string, Row[]>,
    private table: string,
    private rows: Row[],
  ) {}

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.rows = this.rows.filter((row) => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.rows = this.rows.filter((row) => values.includes(row[column]));
    return this;
  }

  maybeSingle() {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected);
  }
}

function createDb(overrides?: Partial<Record<string, Row[]>>) {
  const tables: Record<string, Row[]> = {
    tenant: [{ id: 'tenant-1', iva_porcentaje_default: 21, business_prefs: { precioCostoSoloSube: false } }],
    sucursal: [{ id: 'suc-1', tenant_id: 'tenant-1', business_prefs: null }],
    producto: [
      {
        id: 'prod-1',
        tenant_id: 'tenant-1',
        codigo: 'ABC',
        nombre: 'Yerba 1kg',
        precio_costo: 100,
        precio_venta: 160,
        iva_porcentaje: 21,
        unidad: 'unidad',
        unidad_compra: null,
        contenido_unidad_compra: null,
      },
    ],
    comprobante: [],
    ...overrides,
  };
  return {
    tables,
    from(table: string) {
      return new MockQuery(tables, table, [...(tables[table] ?? [])]);
    },
  };
}

function preview(): LectorFacturaPreviewPayload {
  return {
    log_id: 'log-1',
    iva_default: 21,
    direccion: 'recibida',
    cabecera: {
      tipo_comprobante: 'factura',
      letra: 'A',
      punto_venta: 1,
      numero: 2,
      fecha_emision: '2026-05-10',
      fecha_vencimiento: null,
      cae: null,
      cae_vencimiento: null,
    },
    emisor: {
      razon_social: 'Proveedor SA',
      cuit: '30111111118',
      domicilio: null,
      condicion_iva: null,
      ingresos_brutos: null,
      inicio_actividades: null,
    },
    receptor: {
      razon_social: 'Mi negocio',
      cuit_dni: '20111111112',
      domicilio: null,
      condicion_iva: null,
    },
    proveedor: { id: 'prov-1', nombre: 'Proveedor SA' },
    cliente: null,
    crear_proveedor: null,
    crear_cliente: null,
    items: [
      {
        indice: 0,
        codigo: 'ABC',
        descripcion: 'Yerba 1kg',
        cantidad: 2,
        unidad: 'unidad',
        precio_unitario: 120,
        bonificacion: null,
        subtotal: 240,
        iva_porcentaje: 21,
        producto_unidad: 'unidad',
        producto_unidad_compra: null,
        producto_contenido_unidad_compra: null,
        match: {
          producto_id: 'prod-1',
          producto_nombre: 'Yerba 1kg',
          confidence: 1,
          metodo: 'codigo_exacto',
          requires_review: false,
        },
      },
      {
        indice: 1,
        codigo: 'NEW',
        descripcion: 'Producto nuevo',
        cantidad: 1,
        unidad: 'unidad',
        precio_unitario: 50,
        bonificacion: null,
        subtotal: 50,
        iva_porcentaje: 21,
        producto_unidad: null,
        producto_unidad_compra: null,
        producto_contenido_unidad_compra: null,
        match: {
          producto_id: null,
          producto_nombre: null,
          confidence: 0,
          metodo: 'sin_match',
          requires_review: true,
        },
      },
    ],
    totales: {
      subtotal: 290,
      iva_21: 60.9,
      iva_10_5: null,
      iva_27: null,
      percepcion_iibb: null,
      percepcion_iva: null,
      impuesto_interno: null,
      otros_impuestos: null,
      total: 350.9,
    },
    condicion_pago: null,
    observaciones: null,
    validacion: {
      totales_cuadran: true,
      advertencias: [],
      items_cuadran: true,
      suma_items: 290,
      referencia_items: 290,
      diferencia_items: 0,
    },
    multipagina: { total_archivos: 1, total_hojas: 1 },
    archivo_nombre: 'factura.pdf',
    extracciones_restantes: null,
  } as LectorFacturaPreviewPayload;
}

describe('confirmacion chatbot lector factura', () => {
  it('arma payload de compra, reporta productos nuevos/revision y todos los cambios de costo', async () => {
    const prepared = await prepararConfirmacionLectorFactura({
      db: createDb(),
      tenantId: 'tenant-1',
      sucursalId: 'suc-1',
      preview: preview(),
    });

    expect(prepared.confirmPayload.tipo_comprobante).toBe('factura_a');
    expect(prepared.confirmPayload.actualizar_costos).toBe(true);
    expect(prepared.impacto.resumen.productos_vinculados).toBe(1);
    expect(prepared.impacto.resumen.productos_nuevos).toBe(1);
    expect(prepared.impacto.resumen.productos_para_revisar).toBe(1);
    expect(prepared.impacto.cambios_costos).toHaveLength(1);
    expect(prepared.impacto.cambios_costos[0]).toMatchObject({
      producto_id: 'prod-1',
      precio_costo_anterior: 100,
      precio_costo_nuevo: 120,
    });
    expect(prepared.impacto.bloqueantes).toHaveLength(0);
    expect(hashImpactoLectorFactura(prepared.impacto)).toBe(prepared.impactHash);
  });

  it('marca duplicado probable como bloqueante', async () => {
    const p = preview();
    const prepared = await prepararConfirmacionLectorFactura({
      db: createDb({
        comprobante: [
          {
            id: 'comp-1',
            tenant_id: 'tenant-1',
            estado: 'importado',
            tipo_operacion: 'compra',
            tipo: 'factura_a',
            proveedor_id: 'prov-1',
            numero: numeroComprobanteImportado(1, 2),
          },
        ],
      }),
      tenantId: 'tenant-1',
      sucursalId: 'suc-1',
      preview: p,
    });

    expect(prepared.impacto.bloqueantes.join(' ')).toContain('Ya existe');
  });
});
