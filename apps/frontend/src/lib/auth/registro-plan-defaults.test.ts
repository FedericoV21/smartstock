import { describe, expect, it } from 'vitest';

import {
  BUSINESS_PREFS_NUEVO_TENANT,
  MODULOS_PLAN_0_NUEVO_TENANT,
  PLAN_INICIAL_NUEVO_TENANT,
  POS_PREFS_NUEVO_TENANT,
} from './registro-plan-defaults';
import { normalizeBusinessPrefs } from '@/lib/business-prefs/prefs';
import { normalizePosPrefs } from '@/lib/pos/prefs';

describe('defaults de registro de tenant', () => {
  it('crea nuevos tenants en Plan 0 con facturador bloqueado', () => {
    expect(PLAN_INICIAL_NUEVO_TENANT).toBe('plan0');
    expect(MODULOS_PLAN_0_NUEVO_TENANT).toMatchObject({
      stock: true,
      importador_excel: true,
      facturador_simple: false,
      facturador_arca: false,
      facturador_pos: false,
      pedidos: false,
      presupuestos: false,
      ia_precios: false,
      analizador_rentabilidad: false,
      lector_facturas: false,
      despiece_carniceria: false,
      turnos: false,
    });
  });

  it('crea nuevos tenants con costo-solo-sube y redondeo apagados', () => {
    expect(normalizeBusinessPrefs(BUSINESS_PREFS_NUEVO_TENANT).precioCostoSoloSube).toBe(false);
    expect(normalizePosPrefs(POS_PREFS_NUEVO_TENANT)).toMatchObject({
      pvpRedondeoCentenasArriba: false,
      pvpRedondeoMenores100ADecenas: false,
    });
  });
});
