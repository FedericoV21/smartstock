import { describe, expect, it } from 'vitest';

import {
  aplicarPromociones,
  diaSemanaDesdeLunes,
  fechaLocalYmd,
  promocionVigente,
  round2,
} from '@/lib/facturacion/promociones';
import {
  textoDiasHabilesPromocion,
  textoDiasHabilesPromocionCorto,
} from '@/lib/promociones/dias-semana-ui';
import { subtotalLineaMercaderia2Dec } from '@/lib/productos/calcular-precio-venta';
import type { PromocionMotor } from '@/types/promociones';

const PID = '00000000-0000-4000-8000-000000000001';

function basePromo(over: Partial<PromocionMotor>): PromocionMotor {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    nombre: 'Test',
    tipo: 'porcentaje_off',
    cantidad_lleva: null,
    cantidad_paga: null,
    unidad_descuento: null,
    porcentaje: 10,
    cantidad_minima: null,
    rangos_volumen: null,
    precio_combo: null,
    combo_items: null,
    vigente_desde: null,
    vigente_hasta: null,
    dias_semana: null,
    activa: true,
    ...over,
  };
}

const PID_B = '00000000-0000-4000-8000-000000000002';

describe('promocionVigente', () => {
  it('rechaza si activa = false', () => {
    const p = basePromo({ activa: false });
    expect(promocionVigente(p, new Date('2026-04-21T12:00:00'))).toBe(false);
  });

  it('respeta vigente_desde y vigente_hasta', () => {
    const p = basePromo({ vigente_desde: '2026-04-20', vigente_hasta: '2026-04-22' });
    expect(promocionVigente(p, new Date('2026-04-19T12:00:00'))).toBe(false);
    expect(promocionVigente(p, new Date('2026-04-21T12:00:00'))).toBe(true);
    expect(promocionVigente(p, new Date('2026-04-23T12:00:00'))).toBe(false);
  });

  it('dias_semana: solo martes (2 en escala Lun=1…Dom=7)', () => {
    const p = basePromo({ dias_semana: [2] });
    const lunes = new Date('2026-04-20T12:00:00');
    expect(diaSemanaDesdeLunes(lunes)).toBe(1);
    expect(promocionVigente(p, lunes)).toBe(false);
    const martes = new Date('2026-04-21T12:00:00');
    expect(diaSemanaDesdeLunes(martes)).toBe(2);
    expect(promocionVigente(p, martes)).toBe(true);
  });
});

describe('aplicarPromociones — porcentaje_off', () => {
  it('aplica % sobre precio unitario', () => {
    const promo = basePromo({ porcentaje: 20 });
    const map = new Map([[PID, promo]]);
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad: 2, precio_unitario: 100 }],
      map,
      '2026-04-21',
    );
    expect(out[0].precio_unitario_efectivo).toBe(80);
    expect(out[0].precio_unitario_original).toBe(100);
    expect(out[0].descuento_promo_monto).toBe(40);
  });

  it('aplica sobre precio editado manualmente en el carrito', () => {
    const promo = basePromo({ porcentaje: 10 });
    const map = new Map([[PID, promo]]);
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad: 1, precio_unitario: 50 }],
      map,
      '2026-04-21',
    );
    expect(out[0].precio_unitario_efectivo).toBe(45);
    expect(out[0].descuento_promo_monto).toBe(5);
  });
});

describe('aplicarPromociones — n_x_m', () => {
  it('2x1: 5 unidades → paga 3 unidades de precio (ejemplo del plan)', () => {
    const promo = basePromo({
      tipo: 'n_x_m',
      porcentaje: null,
      cantidad_lleva: 2,
      cantidad_paga: 1,
    });
    const map = new Map([[PID, promo]]);
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad: 5, precio_unitario: 100, es_pesable: false }],
      map,
      '2026-04-21',
    );
    expect(out[0].descuento_promo_monto).toBe(200);
    expect(out[0].precio_unitario_efectivo).toBe(60);
  });

  it('3x2: cantidad no múltiplo', () => {
    const promo = basePromo({
      tipo: 'n_x_m',
      porcentaje: null,
      cantidad_lleva: 3,
      cantidad_paga: 2,
    });
    const map = new Map([[PID, promo]]);
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad: 10, precio_unitario: 30 }],
      map,
      '2026-04-21',
    );
    // groups=3, remainder=1 → pay 3*2+1=7 units
    expect(out[0].descuento_promo_monto).toBe(90);
  });

  it('no aplica a producto pesable', () => {
    const promo = basePromo({
      tipo: 'n_x_m',
      porcentaje: null,
      cantidad_lleva: 2,
      cantidad_paga: 1,
    });
    const map = new Map([[PID, promo]]);
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad: 4, precio_unitario: 100, es_pesable: true }],
      map,
      '2026-04-21',
    );
    expect(out[0].promocion_id).toBeNull();
  });

  it('no aplica con cantidad decimal', () => {
    const promo = basePromo({
      tipo: 'n_x_m',
      porcentaje: null,
      cantidad_lleva: 2,
      cantidad_paga: 1,
    });
    const map = new Map([[PID, promo]]);
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad: 2.5, precio_unitario: 100 }],
      map,
      '2026-04-21',
    );
    expect(out[0].promocion_id).toBeNull();
  });

  it('coherencia subtotal línea vs total promocional (2x1, cantidad que no divide bien el PU)', () => {
    const promo = basePromo({
      tipo: 'n_x_m',
      porcentaje: null,
      cantidad_lleva: 2,
      cantidad_paga: 1,
    });
    const map = new Map([[PID, promo]]);
    const cantidad = 3;
    const precio_unitario = 10;
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad, precio_unitario, es_pesable: false }],
      map,
      '2026-04-21',
    );
    expect(out[0].descuento_promo_monto).toBe(10);
    const lineNet = precio_unitario * cantidad - (out[0].descuento_promo_monto ?? 0);
    expect(subtotalLineaMercaderia2Dec(cantidad, out[0].precio_unitario_efectivo)).toBe(lineNet);
  });

  it('múltiplos grandes: 2x1 con cantidad par mantiene total = Q×P_efectivo (redondeo línea)', () => {
    const promo = basePromo({
      tipo: 'n_x_m',
      porcentaje: null,
      cantidad_lleva: 2,
      cantidad_paga: 1,
    });
    const map = new Map([[PID, promo]]);
    const cantidad = 100;
    const precio_unitario = 49.99;
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad, precio_unitario, es_pesable: false }],
      map,
      '2026-04-21',
    );
    const esperadoNeto =
      Math.round(((cantidad / 2) * precio_unitario) * 100) / 100;
    expect(subtotalLineaMercaderia2Dec(cantidad, out[0].precio_unitario_efectivo)).toBe(esperadoNeto);
    expect(round2(esperadoNeto + (out[0].descuento_promo_monto ?? 0))).toBe(
      round2(cantidad * precio_unitario),
    );
  });
});

describe('aplicarPromociones — porcentaje_unidad_n', () => {
  it('30% cada 2.ª unidad (2ª, 4ª…): 5 unidades a $100 → 3 enteras + 2 con desc.', () => {
    const promo = basePromo({
      tipo: 'porcentaje_unidad_n',
      porcentaje: 30,
      unidad_descuento: 2,
    });
    const map = new Map([[PID, promo]]);
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad: 5, precio_unitario: 100 }],
      map,
      '2026-04-21',
    );
    // floor(5/2)=2 unidades al 70%, 3 al precio lista → 300+140=440; ahorro 60
    expect(out[0].descuento_promo_monto).toBe(60);
    expect(out[0].precio_unitario_efectivo).toBe(88);
  });

  it('50% cada 2.ª: 4 unidades duplica el ahorro de 2 (caso POS “2º 50%”)', () => {
    const promo = basePromo({
      tipo: 'porcentaje_unidad_n',
      porcentaje: 50,
      unidad_descuento: 2,
    });
    const map = new Map([[PID, promo]]);
    const precio_unitario = 77.94;
    const cantidad = 4;
    const dos = aplicarPromociones(
      [{ producto_id: PID, cantidad: 2, precio_unitario, es_pesable: false }],
      map,
      '2026-04-21',
    );
    const cuatro = aplicarPromociones(
      [{ producto_id: PID, cantidad: 4, precio_unitario, es_pesable: false }],
      map,
      '2026-04-21',
    );
    const ahorro2 = dos[0].descuento_promo_monto ?? 0;
    const ahorro4 = cuatro[0].descuento_promo_monto ?? 0;
    expect(ahorro2).toBeCloseTo(precio_unitario / 2, 2);
    expect(ahorro4).toBeCloseTo(ahorro2 * 2, 2);
    expect(subtotalLineaMercaderia2Dec(cantidad, cuatro[0].precio_unitario_efectivo)).toBeCloseTo(
      precio_unitario * cantidad - ahorro4,
      2,
    );
  });

  it('una sola unidad: sin descuento (no llega a unidad N)', () => {
    const promo = basePromo({
      tipo: 'porcentaje_unidad_n',
      porcentaje: 50,
      unidad_descuento: 2,
    });
    const map = new Map([[PID, promo]]);
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad: 1, precio_unitario: 80 }],
      map,
      '2026-04-21',
    );
    expect(out[0].promocion_id).toBeNull();
  });

  it('no aplica con cantidad no entera', () => {
    const promo = basePromo({
      tipo: 'porcentaje_unidad_n',
      porcentaje: 30,
      unidad_descuento: 2,
    });
    const map = new Map([[PID, promo]]);
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad: 2.5, precio_unitario: 100 }],
      map,
      '2026-04-21',
    );
    expect(out[0].promocion_id).toBeNull();
  });

  it('coherencia subtotal vs ahorro con PVP con decimales y % desde unidad 2', () => {
    const promo = basePromo({
      tipo: 'porcentaje_unidad_n',
      porcentaje: 10,
      unidad_descuento: 2,
    });
    const map = new Map([[PID, promo]]);
    const cantidad = 5;
    const precio_unitario = 33.33;
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad, precio_unitario, es_pesable: false }],
      map,
      '2026-04-21',
    );
    const bruto = round2(cantidad * precio_unitario);
    const lineNet = round2(bruto - (out[0].descuento_promo_monto ?? 0));
    expect(subtotalLineaMercaderia2Dec(cantidad, out[0].precio_unitario_efectivo)).toBe(lineNet);
  });

  it('múltiplos: cada 4.ª unidad al 25 %, 48 unidades → 36 enteras + 12 con desc.', () => {
    const promo = basePromo({
      tipo: 'porcentaje_unidad_n',
      porcentaje: 25,
      unidad_descuento: 4,
    });
    const map = new Map([[PID, promo]]);
    const cantidad = 48;
    const precio_unitario = 10;
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad, precio_unitario, es_pesable: false }],
      map,
      '2026-04-21',
    );
    const bruto = cantidad * precio_unitario;
    const precioDesc = round2(precio_unitario * 0.75);
    const totalPago = round2(36 * precio_unitario + 12 * precioDesc);
    expect(out[0].descuento_promo_monto).toBe(round2(bruto - totalPago));
    expect(subtotalLineaMercaderia2Dec(cantidad, out[0].precio_unitario_efectivo)).toBe(totalPago);
  });
});

describe('aplicarPromociones — descuento_volumen', () => {
  it('15% si lleva ≥ 3', () => {
    const promo = basePromo({
      tipo: 'descuento_volumen',
      porcentaje: 15,
      cantidad_minima: 3,
    });
    const map = new Map([[PID, promo]]);
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad: 3, precio_unitario: 100 }],
      map,
      '2026-04-21',
    );
    expect(out[0].precio_unitario_efectivo).toBe(85);
    expect(out[0].descuento_promo_monto).toBe(45);
  });

  it('cantidad 4 con mínimo 5 → no aplica', () => {
    const promo = basePromo({
      tipo: 'descuento_volumen',
      porcentaje: 10,
      cantidad_minima: 5,
    });
    const map = new Map([[PID, promo]]);
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad: 4, precio_unitario: 50 }],
      map,
      '2026-04-21',
    );
    expect(out[0].promocion_id).toBeNull();
  });

  it('cantidad 5 con mínimo 5 → aplica', () => {
    const promo = basePromo({
      tipo: 'descuento_volumen',
      porcentaje: 10,
      cantidad_minima: 5,
    });
    const map = new Map([[PID, promo]]);
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad: 5, precio_unitario: 100 }],
      map,
      '2026-04-21',
    );
    expect(out[0].promocion_id).not.toBeNull();
  });

  it('tramos: 4 unidades en 1–6 → 10%', () => {
    const promo = basePromo({
      tipo: 'descuento_volumen',
      porcentaje: null,
      cantidad_minima: null,
      rangos_volumen: [
        { cantidad_desde: 1, cantidad_hasta: 6, porcentaje: 10 },
        { cantidad_desde: 7, cantidad_hasta: null, porcentaje: 20 },
      ],
    });
    const map = new Map([[PID, promo]]);
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad: 4, precio_unitario: 100 }],
      map,
      '2026-04-21',
    );
    expect(out[0].precio_unitario_efectivo).toBe(90);
    expect(out[0].descuento_promo_monto).toBe(40);
  });

  it('tramos: 8 unidades → segundo tramo 20%', () => {
    const promo = basePromo({
      tipo: 'descuento_volumen',
      porcentaje: null,
      cantidad_minima: null,
      rangos_volumen: [
        { cantidad_desde: 1, cantidad_hasta: 6, porcentaje: 10 },
        { cantidad_desde: 7, cantidad_hasta: null, porcentaje: 20 },
      ],
    });
    const map = new Map([[PID, promo]]);
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad: 8, precio_unitario: 100 }],
      map,
      '2026-04-21',
    );
    expect(out[0].precio_unitario_efectivo).toBe(80);
  });
});

describe('aplicarPromociones — combo_precio_fijo', () => {
  it('1 A + 2 B a precio combo menor que lista', () => {
    const promo = basePromo({
      tipo: 'combo_precio_fijo',
      porcentaje: null,
      precio_combo: 100,
      combo_items: [
        { producto_id: PID, cantidad: 1 },
        { producto_id: PID_B, cantidad: 2 },
      ],
    });
    const map = new Map([
      [PID, promo],
      [PID_B, promo],
    ]);
    const out = aplicarPromociones(
      [
        { producto_id: PID, cantidad: 1, precio_unitario: 50, es_pesable: false },
        { producto_id: PID_B, cantidad: 2, precio_unitario: 50, es_pesable: false },
      ],
      map,
      '2026-04-21',
    );
    expect(out[0].descuento_promo_monto).toBeCloseTo(16.67, 1);
    expect(out[1].descuento_promo_monto).toBeCloseTo(33.33, 1);
    expect(out[0].promocion_id).toBe(promo.id);
    expect(out[1].promocion_id).toBe(promo.id);
  });

  it('incluye línea pesable si cantidades cumplen el paquete', () => {
    const promo = basePromo({
      tipo: 'combo_precio_fijo',
      porcentaje: null,
      precio_combo: 80,
      combo_items: [
        { producto_id: PID, cantidad: 1 },
        { producto_id: PID_B, cantidad: 2 },
      ],
    });
    const map = new Map([
      [PID, promo],
      [PID_B, promo],
    ]);
    const out = aplicarPromociones(
      [
        { producto_id: PID, cantidad: 1, precio_unitario: 20, es_pesable: false },
        { producto_id: PID_B, cantidad: 2.5, precio_unitario: 40, es_pesable: true },
      ],
      map,
      '2026-04-21',
    );
    expect(out[1].promocion_id).toBe(promo.id);
    expect(out[1].descuento_promo_monto).toBeGreaterThan(0);
    expect(out[1].es_pesable).toBe(true);
  });
});

describe('aplicarPromociones — bordes', () => {
  it('cantidad 0 → sin promo', () => {
    const promo = basePromo({});
    const map = new Map([[PID, promo]]);
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad: 0, precio_unitario: 100 }],
      map,
      '2026-04-21',
    );
    expect(out[0].promocion_id).toBeNull();
  });

  it('sin entrada en el mapa → sin promo', () => {
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad: 2, precio_unitario: 100 }],
      new Map(),
      '2026-04-21',
    );
    expect(out[0].precio_unitario_efectivo).toBe(100);
  });

  it('promo vencida → sin promo', () => {
    const promo = basePromo({ vigente_hasta: '2026-01-01' });
    const map = new Map([[PID, promo]]);
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad: 2, precio_unitario: 100 }],
      map,
      '2026-04-21',
    );
    expect(out[0].promocion_id).toBeNull();
  });

  it('producto pesable con porcentaje_off → aplica', () => {
    const promo = basePromo({ porcentaje: 10 });
    const map = new Map([[PID, promo]]);
    const out = aplicarPromociones(
      [{ producto_id: PID, cantidad: 1.25, precio_unitario: 400, es_pesable: true }],
      map,
      '2026-04-21',
    );
    expect(out[0].precio_unitario_efectivo).toBe(360);
    expect(out[0].descuento_promo_monto).toBe(50);
  });
});

describe('dias-semana-ui', () => {
  it('textoDiasHabilesPromocion: null o todos = frase completa', () => {
    expect(textoDiasHabilesPromocion(null)).toBe('Todos los días de la semana');
    expect(textoDiasHabilesPromocion([])).toBe('Todos los días de la semana');
    expect(textoDiasHabilesPromocion([1, 2, 3, 4, 5, 6, 7])).toBe('Todos los días de la semana');
  });

  it('atajos lun–vie y fin de semana', () => {
    expect(textoDiasHabilesPromocion([1, 2, 3, 4, 5])).toBe('Lunes a viernes');
    expect(textoDiasHabilesPromocion([6, 7])).toBe('Sábados y domingos');
  });

  it('lista días sueltos', () => {
    expect(textoDiasHabilesPromocion([1, 3, 5])).toBe('Lunes, Miércoles, Viernes');
  });

  it('textoDiasHabilesPromocionCorto', () => {
    expect(textoDiasHabilesPromocionCorto(null)).toBe('Todos los días');
    expect(textoDiasHabilesPromocionCorto([1, 2, 3, 4, 5])).toBe('Lun–vie');
    expect(textoDiasHabilesPromocionCorto([2, 4])).toBe('Mar, Jue');
  });
});

describe('helpers', () => {
  it('round2', () => {
    expect(round2(1.234)).toBe(1.23);
    expect(round2(1.236)).toBe(1.24);
  });

  it('fechaLocalYmd estable', () => {
    const d = new Date(2026, 3, 21, 15, 30);
    expect(fechaLocalYmd(d)).toMatch(/2026-04-21/);
  });
});
