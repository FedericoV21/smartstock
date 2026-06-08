import { describe, expect, it } from 'vitest';

import { enriquecerLineasExtractoEditables } from '@/lib/cuenta-corriente/extracto-editabilidad';
import { armarExtractoCuentaCorriente } from '@/lib/cuenta-corriente/extracto';
import { hoyEnAR } from '@/lib/utils/formatters';

describe('extracto editabilidad', () => {
  const hoy = hoyEnAR();

  it('marca pagos editables si puedeEditar', () => {
    const base = armarExtractoCuentaCorriente({
      clienteId: 'c1',
      clienteNombre: 'Test',
      periodo: { desde: hoy, hasta: hoy, label: 'Hoy' },
      sucursalId: null,
      saldoActual: 100,
      comprobantes: [],
      pagos: [
        {
          id: 'p1',
          fecha: hoy,
          created_at: `${hoy}T12:00:00Z`,
          monto: 50,
          tipo_pago: 'efectivo',
          referencia: null,
          notas: null,
          comprobante_id: null,
        },
      ],
      puntoDeVenta: 1,
    });
    const lineas = enriquecerLineasExtractoEditables({
      lineas: base.lineas,
      comprobantes: [],
      liquidacionHabilitada: false,
      puedeEditar: true,
      fechaHoy: hoy,
    });
    expect(lineas[0].editable).toBe(true);
  });

  it('cargo del día editable con liquidación por sucursal', () => {
    const comp = {
      id: 'comp1',
      tipo: 'ticket',
      numero: null,
      numero_caja: 2,
      fecha: hoy,
      created_at: `${hoy}T10:00:00Z`,
      total: 1000,
      metodo_pago: 'cuenta_corriente',
      metodo_pago_detalle: null,
      sucursal_id: 'suc-1',
      estado: 'emitido',
      cae: null,
    };
    const base = armarExtractoCuentaCorriente({
      clienteId: 'c1',
      clienteNombre: 'Test',
      periodo: { desde: hoy, hasta: hoy, label: 'Hoy' },
      sucursalId: null,
      saldoActual: 1000,
      comprobantes: [comp],
      pagos: [],
      puntoDeVenta: 1,
    });
    const lineas = enriquecerLineasExtractoEditables({
      lineas: base.lineas,
      comprobantes: [comp],
      liquidacionHabilitada: false,
      liquidacionPorSucursal: { 'suc-1': true },
      puedeEditar: true,
      fechaHoy: hoy,
    });
    expect(lineas[0].editable).toBe(true);
    expect(lineas[0].sucursal_id).toBe('suc-1');
  });
});
