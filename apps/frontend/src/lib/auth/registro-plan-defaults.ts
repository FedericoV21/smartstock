import type { Database } from '@/types/database';
import type { BusinessPrefs } from '@/lib/business-prefs/prefs';
import type { PosPrefs } from '@/lib/pos/prefs';

type PlanTipo = Database['public']['Enums']['plan_tipo'];
type ModuloConfigInsert = Database['public']['Tables']['modulo_config']['Insert'];

export const PLAN_INICIAL_NUEVO_TENANT = 'plan0' satisfies PlanTipo;

export const MODULOS_PLAN_0_NUEVO_TENANT = {
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
} satisfies Omit<ModuloConfigInsert, 'tenant_id'>;

export const BUSINESS_PREFS_NUEVO_TENANT = {
  precioCostoSoloSube: false,
} satisfies Partial<BusinessPrefs>;

export const POS_PREFS_NUEVO_TENANT = {
  pvpRedondeoCentenasArriba: false,
  pvpRedondeoMenores100ADecenas: false,
} satisfies Partial<PosPrefs>;
