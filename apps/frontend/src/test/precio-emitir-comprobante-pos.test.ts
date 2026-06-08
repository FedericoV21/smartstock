import { describe, expect, it } from 'vitest';

import { precioUnitarioLineaEmitirConTramos } from '@/lib/facturacion/precio-unitario-linea-emitir';
import { aplicarPromociones } from '@/lib/facturacion/promociones';
import { precioUnitarioListaParaEmitirDesdePos } from '@/lib/pos/precio-emitir-comprobante';
import type { ItemConPromo, PromocionMotor } from '@/types/promociones';

const PID = '00000000-0000-4000-8000-000000000001';

describe('precioUnitarioListaParaEmitirDesdePos', () => {
  it('usa precio de lista del motor, no el efectivo con promo', () => {
    const cp: ItemConPromo = {
      producto_id: PID,
      cantidad: 2,
      precio_unitario: 14_000,
      precio_unitario_original: 14_000,
      precio_unitario_efectivo: 11_130,
      promocion_id: 'promo-1',
      promocion_descripcion: '20,5% desde 2 kg',
      descuento_promo_monto: 2_870,
      es_pesable: true,
    };
    expect(precioUnitarioListaParaEmitirDesdePos(cp, 14_000)).toBe(14_000);
    expect(precioUnitarioListaParaEmitirDesdePos(cp, 9_999)).toBe(14_000);
  });
});

describe('emitir POS: promo no se aplica dos veces', () => {
  const promo: PromocionMotor = {
    id: 'promo-vol',
    nombre: 'Picada volumen',
    tipo: 'descuento_volumen',
    cantidad_lleva: null,
    cantidad_paga: null,
    unidad_descuento: null,
    porcentaje: null,
    cantidad_minima: 2,
    rangos_volumen: [{ cantidad_desde: 2, cantidad_hasta: null, porcentaje: 20.5 }],
    precio_combo: null,
    combo_items: null,
    vigente_desde: null,
    vigente_hasta: null,
    dias_semana: null,
    activa: true,
  };

  it('enviar precio efectivo al emitir duplicaría el descuento (~17.700 en 2 u)', () => {
    const lista = 14_000;
    const promoMap = new Map([[PID, promo]]);
    const itemsConPromo = aplicarPromociones(
      [
        {
          producto_id: PID,
          cantidad: 2,
          precio_unitario: lista,
          es_pesable: true,
        },
      ],
      promoMap,
      '2026-05-30',
    );
    const cp = itemsConPromo[0]!;
    expect(cp.precio_unitario_efectivo).toBeLessThan(lista);

    const puBodyIncorrecto = cp.precio_unitario_efectivo;
    const puBodyCorrecto = precioUnitarioListaParaEmitirDesdePos(cp, lista);

    const puServidorIncorrecto = precioUnitarioLineaEmitirConTramos(
      { cantidad: 2, precio_unitario: puBodyIncorrecto },
      { precio_costo: 10_000, precio_venta: lista, porcentaje_ganancia: 40, iva_porcentaje: 0 },
      null,
      21,
    );
    const puServidorCorrecto = precioUnitarioLineaEmitirConTramos(
      { cantidad: 2, precio_unitario: puBodyCorrecto },
      { precio_costo: 10_000, precio_venta: lista, porcentaje_ganancia: 40, iva_porcentaje: 0 },
      null,
      21,
    );

    expect(puServidorIncorrecto).toBe(puBodyIncorrecto);

    const doble = aplicarPromociones(
      [
        {
          producto_id: PID,
          cantidad: 2,
          precio_unitario: puServidorIncorrecto,
          es_pesable: true,
        },
      ],
      promoMap,
      '2026-05-30',
    )[0]!;

    const unaVez = aplicarPromociones(
      [
        {
          producto_id: PID,
          cantidad: 2,
          precio_unitario: puServidorCorrecto,
          es_pesable: true,
        },
      ],
      promoMap,
      '2026-05-30',
    )[0]!;

    const totalDoble = doble.precio_unitario_efectivo * 2;
    const totalUnaVez = unaVez.precio_unitario_efectivo * 2;

    expect(totalDoble).toBeLessThan(totalUnaVez - 1);
    expect(totalUnaVez).toBeGreaterThan(22_000);
    expect(totalUnaVez).toBeLessThan(22_500);
    expect(totalDoble).toBeGreaterThan(17_600);
    expect(totalDoble).toBeLessThan(17_800);
  });
});
