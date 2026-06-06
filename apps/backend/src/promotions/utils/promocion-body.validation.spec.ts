import { PromocionTipo } from '../enums/promocion-tipo.enum';
import { validarCuerpoPromocion } from './promocion-body.validation';
import { promocionVigenteParaYmd } from './promocion-vigencia';

describe('validarCuerpoPromocion', () => {
  it('accepts porcentaje_off with camelCase fields', () => {
    const res = validarCuerpoPromocion({
      nombre: 'Promo verano',
      tipo: PromocionTipo.porcentaje_off,
      porcentaje: 15,
      productoIds: ['b0000001-0001-4001-8001-000000000002'],
      siempreVigente: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.porcentaje).toBe(15);
      expect(res.data.producto_targets).toHaveLength(1);
    }
  });

  it('rejects invalid tipo', () => {
    const res = validarCuerpoPromocion({ nombre: 'X promo', tipo: 'invalido' });
    expect(res.ok).toBe(false);
  });
});

describe('promocionVigenteParaYmd', () => {
  it('returns false when promo is inactive', () => {
    expect(
      promocionVigenteParaYmd(
        {
          id: 'p1',
          nombre: 'Off',
          tipo: PromocionTipo.porcentaje_off,
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
          activa: false,
        },
        '2026-06-05',
      ),
    ).toBe(false);
  });
});
