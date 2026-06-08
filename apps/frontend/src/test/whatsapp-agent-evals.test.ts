import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import evalFixture from '@/test/fixtures/whatsapp-agent-evals.v141.json';
import { runWhatsAppReadOnlyAgent } from '@/lib/whatsapp/read-only-agent';
import { resolveFollowupFromConversationMemory } from '@/lib/whatsapp/text-handler';
import {
  conversationStateFixture,
  type ConversationEntityType,
  type ConversationPendingPrompt,
  type ConversationReportKey,
  type ConversationTopic,
  type WhatsAppConversationState,
} from '@/lib/whatsapp/conversation-memory';
import { sumarDiasYmd, ymdArgentina } from '@/lib/reportes/periodos';

type EvalCase = {
  id: string;
  category: string;
  message: string;
  expectedIntent: string;
  expectedTool: string | null;
  expectedFallbackReason: string | null;
  replyMustContain: string[];
  continuityProbe?: boolean;
  intentContext?: {
    topic?: string | null;
    lastIntent?: string | null;
    lastEntityName?: string | null;
    lastEntityType?: string | null;
    lastReportKey?: string | null;
    lastReportPage?: number | null;
    lastOptions?: string[] | null;
    pendingPrompt?: string | null;
  };
};

function evalIntentContextToState(
  ctx: EvalCase['intentContext'] | undefined,
): WhatsAppConversationState | null {
  if (!ctx) return null;
  return conversationStateFixture({
    topic: (ctx.topic as ConversationTopic) ?? null,
    lastIntent: ctx.lastIntent ?? null,
    lastEntityName: ctx.lastEntityName ?? null,
    lastEntityType: (ctx.lastEntityType as ConversationEntityType) ?? null,
    lastReportKey: (ctx.lastReportKey as ConversationReportKey) ?? null,
    lastReportPage: ctx.lastReportPage ?? null,
    lastOptions: ctx.lastOptions ?? [],
    pendingPrompt: (ctx.pendingPrompt as ConversationPendingPrompt) ?? null,
  });
}

type EvalFixture = {
  version: string;
  cases: EvalCase[];
};

type DbRow = Record<string, unknown>;
type TableData = Record<string, DbRow[]>;

const TENANT_ID = 'tenant-eval';
const EVAL_SUCURSAL_ID = 'suc-eval';

const TENANT: DbRow[] = [{ id: TENANT_ID, punto_de_venta: 1 }];

/** Fecha fija para evals deterministas (V143-WA-002). */
const EVAL_ANCHOR_YMD = '2026-06-01';
const EVAL_YESTERDAY_YMD = '2026-05-31';

const CAJAS: DbRow[] = [
  {
    id: 'caja-mostrador',
    tenant_id: TENANT_ID,
    sucursal_id: EVAL_SUCURSAL_ID,
    nombre: 'Mostrador',
    numero: 1,
    activa: true,
  },
  {
    id: 'caja-deposito',
    tenant_id: TENANT_ID,
    sucursal_id: EVAL_SUCURSAL_ID,
    nombre: 'Deposito',
    numero: 2,
    activa: true,
  },
];

const USUARIOS_POS: DbRow[] = [
  { id: 'usr-juan-cajero', tenant_id: TENANT_ID, nombre: 'Juan', apellido: 'Cajero' },
  { id: 'usr-maria-lopez', tenant_id: TENANT_ID, nombre: 'Maria', apellido: 'Lopez' },
];

const POS_TICKET_SCOPE: Record<string, { caja_id: string; usuario_id: string }> = {
  'comp-today-ticket': { caja_id: 'caja-mostrador', usuario_id: 'usr-juan-cajero' },
  'comp-today-ticket-duplicado': { caja_id: 'caja-deposito', usuario_id: 'usr-maria-lopez' },
};

const SUCURSALES: DbRow[] = [
  {
    id: EVAL_SUCURSAL_ID,
    tenant_id: TENANT_ID,
    nombre: 'Casa Central',
    codigo: 'CASA',
    activa: true,
  },
];

const CAJA_APERTURA: DbRow[] = [
  {
    id: 'ap-eval-hoy',
    tenant_id: TENANT_ID,
    sucursal_id: EVAL_SUCURSAL_ID,
    caja_id: '__sin_caja__',
    opened_at: '2026-06-01T08:00:00.000-03:00',
    fondo_efectivo: 5000,
    fecha_operativa: EVAL_ANCHOR_YMD,
  },
];

const CIERRE_Z: DbRow[] = [
  {
    id: 'cz-ayer',
    tenant_id: TENANT_ID,
    sucursal_id: EVAL_SUCURSAL_ID,
    caja_id: '__sin_caja__',
    fecha_operativa: EVAL_YESTERDAY_YMD,
    tipo_cierre: 'diario',
    ventas_netas: 9000,
    total_comprobantes: 1,
    rango_desde: `${EVAL_YESTERDAY_YMD}T08:00:00.000-03:00`,
    rango_hasta: `${EVAL_YESTERDAY_YMD}T23:59:59.999-03:00`,
    payload_resumen: {
      arqueo_efectivo: {
        esperado_sistema: 9500,
        contado: 9000,
        diferencia: -500,
      },
    },
  },
];

const PROVIDERS = [
  {
    id: 'prov-ginkgo',
    tenant_id: TENANT_ID,
    nombre: 'GinkGo',
    telefono: '11-4000-1000',
    email: 'contacto@ginkgo.test',
    direccion: 'Av. Corrientes 1000',
  },
  {
    id: 'prov-acme-n',
    tenant_id: TENANT_ID,
    nombre: 'Acme Norte',
    telefono: '341-111-0001',
    email: 'norte@acme.test',
    direccion: 'Calle 1',
  },
  {
    id: 'prov-acme-s',
    tenant_id: TENANT_ID,
    nombre: 'Acme Sur',
    telefono: '341-222-0002',
    email: null,
    direccion: null,
  },
  {
    id: 'prov-arcor',
    tenant_id: TENANT_ID,
    nombre: 'Arcor',
    telefono: '0800-122-2727',
    email: 'ventas@arcor.com',
    direccion: 'Av. del Libertador 100',
  },
  {
    id: 'prov-coca',
    tenant_id: TENANT_ID,
    nombre: 'Coca Cola Andina',
    telefono: null,
    email: null,
    direccion: null,
  },
  { id: 'prov-mayorista', tenant_id: TENANT_ID, nombre: 'Mayorista Centro', telefono: null, email: null, direccion: null },
  { id: 'prov-favor', tenant_id: TENANT_ID, nombre: 'Saldo Favor SA', telefono: null, email: null, direccion: null },
  { id: 'prov-cero', tenant_id: TENANT_ID, nombre: 'Proveedor Cero', telefono: null, email: null, direccion: null },
];

const CLIENTS = [
  {
    id: 'cli-juan-perez',
    tenant_id: TENANT_ID,
    nombre: 'Juan Perez',
    razon_social: null,
    telefono: '11-2222-3333',
    email: 'juan@example.com',
    direccion: 'Av. Siempre Viva 742',
  },
  {
    id: 'cli-juan-carlos',
    tenant_id: TENANT_ID,
    nombre: 'Juan Carlos',
    razon_social: null,
    telefono: '11-4444-5555',
    email: null,
    direccion: null,
  },
  {
    id: 'cli-juan-manuel',
    tenant_id: TENANT_ID,
    nombre: 'Juan Manuel',
    razon_social: null,
    telefono: '11-6666-7777',
    email: 'manuel@example.com',
    direccion: null,
  },
  {
    id: 'cli-kiosco',
    tenant_id: TENANT_ID,
    nombre: 'Kiosco Centro',
    razon_social: 'Kiosco Centro SRL',
    telefono: '341-555-0101',
    email: 'ventas@kiosco.test',
    direccion: 'San Martin 123',
  },
  {
    id: 'cli-ana',
    tenant_id: TENANT_ID,
    nombre: 'Ana Garcia',
    razon_social: null,
    telefono: null,
    email: 'ana@example.com',
    direccion: null,
  },
  {
    id: 'cli-maria',
    tenant_id: TENANT_ID,
    nombre: 'Maria Lopez',
    razon_social: null,
    telefono: null,
    email: 'maria@example.com',
    direccion: null,
  },
  {
    id: 'cli-cero',
    tenant_id: TENANT_ID,
    nombre: 'Cliente Cero',
    razon_social: null,
    telefono: null,
    email: null,
    direccion: null,
  },
  {
    id: 'cli-ferreteria',
    tenant_id: TENANT_ID,
    nombre: 'Ferreteria Sol',
    razon_social: 'Ferreteria Sol SA',
    telefono: '261-555-0102',
    email: 'contacto@ferreteria.test',
    direccion: 'Belgrano 456',
  },
  {
    id: 'cli-almacen',
    tenant_id: TENANT_ID,
    nombre: 'Almacen Norte',
    razon_social: 'Almacen Norte SRL',
    telefono: '379-555-0103',
    email: null,
    direccion: 'Ruta 8 km 10',
  },
];

const PRODUCTS = [
  { id: 'prd-yerba', tenant_id: TENANT_ID, nombre: 'Yerba Playadito 1kg', codigo: 'YER-1', stock_actual: 35, activo: true },
  { id: 'prd-coca-225', tenant_id: TENANT_ID, nombre: 'Coca Cola 2.25L', codigo: 'COC-225', stock_actual: 12, activo: true },
  { id: 'prd-coca-15', tenant_id: TENANT_ID, nombre: 'Coca Cola 1.5L', codigo: 'COC-15', stock_actual: 7, activo: true },
  { id: 'prd-arroz', tenant_id: TENANT_ID, nombre: 'Arroz Gallo 1kg', codigo: 'ARR-1', stock_actual: 8, activo: true },
  { id: 'prd-azucar', tenant_id: TENANT_ID, nombre: 'Azucar Ledesma 1kg', codigo: 'AZU-1', stock_actual: 1, activo: true },
  { id: 'prd-fideos', tenant_id: TENANT_ID, nombre: 'Fideos Matarazzo 500g', codigo: 'FID-500', stock_actual: 24, activo: true },
  { id: 'prd-leche', tenant_id: TENANT_ID, nombre: 'Leche Entera 1L', codigo: 'LEC-1', stock_actual: 6, activo: true },
  { id: 'prd-atun', tenant_id: TENANT_ID, nombre: 'Atun Lata 170g', codigo: 'ATN-170', stock_actual: 3, activo: true },
  { id: 'prd-oreo', tenant_id: TENANT_ID, nombre: 'Galletitas Oreo', codigo: 'ORE-1', stock_actual: 18, activo: true },
  {
    id: 'prd-mermelada',
    tenant_id: TENANT_ID,
    nombre: 'Mermelada de Frutilla',
    codigo: 'MER-1',
    stock_actual: 5,
    activo: true,
  },
];

function productRef(id: string) {
  const item = PRODUCTS.find((p) => p.id === id);
  if (!item) throw new Error(`Missing product ${id}`);
  return {
    id: item.id,
    nombre: item.nombre,
    codigo: item.codigo,
    activo: item.activo,
  };
}

const STOCK_SUCURSAL: DbRow[] = [
  {
    tenant_id: TENANT_ID,
    producto_id: 'prd-yerba',
    stock_actual: 20,
    stock_minimo: 10,
    sucursal: { codigo: 'CASA', nombre: 'Casa Central' },
    producto: productRef('prd-yerba'),
  },
  {
    tenant_id: TENANT_ID,
    producto_id: 'prd-yerba',
    stock_actual: 15,
    stock_minimo: 10,
    sucursal: { codigo: 'SUC1', nombre: 'Sucursal 1' },
    producto: productRef('prd-yerba'),
  },
  {
    tenant_id: TENANT_ID,
    producto_id: 'prd-coca-225',
    stock_actual: 7,
    stock_minimo: 5,
    sucursal: { codigo: 'CASA', nombre: 'Casa Central' },
    producto: productRef('prd-coca-225'),
  },
  {
    tenant_id: TENANT_ID,
    producto_id: 'prd-coca-225',
    stock_actual: 5,
    stock_minimo: 5,
    sucursal: { codigo: 'SUC1', nombre: 'Sucursal 1' },
    producto: productRef('prd-coca-225'),
  },
  {
    tenant_id: TENANT_ID,
    producto_id: 'prd-coca-15',
    stock_actual: 4,
    stock_minimo: 8,
    sucursal: { codigo: 'CASA', nombre: 'Casa Central' },
    producto: productRef('prd-coca-15'),
  },
  {
    tenant_id: TENANT_ID,
    producto_id: 'prd-coca-15',
    stock_actual: 3,
    stock_minimo: 8,
    sucursal: { codigo: 'SUC1', nombre: 'Sucursal 1' },
    producto: productRef('prd-coca-15'),
  },
  {
    tenant_id: TENANT_ID,
    producto_id: 'prd-arroz',
    stock_actual: 6,
    stock_minimo: 7,
    sucursal: { codigo: 'CASA', nombre: 'Casa Central' },
    producto: productRef('prd-arroz'),
  },
  {
    tenant_id: TENANT_ID,
    producto_id: 'prd-arroz',
    stock_actual: 2,
    stock_minimo: 7,
    sucursal: { codigo: 'SUC1', nombre: 'Sucursal 1' },
    producto: productRef('prd-arroz'),
  },
  {
    tenant_id: TENANT_ID,
    producto_id: 'prd-azucar',
    stock_actual: 1,
    stock_minimo: 5,
    sucursal: { codigo: 'CASA', nombre: 'Casa Central' },
    producto: productRef('prd-azucar'),
  },
  {
    tenant_id: TENANT_ID,
    producto_id: 'prd-fideos',
    stock_actual: 10,
    stock_minimo: 6,
    sucursal: { codigo: 'CASA', nombre: 'Casa Central' },
    producto: productRef('prd-fideos'),
  },
  {
    tenant_id: TENANT_ID,
    producto_id: 'prd-fideos',
    stock_actual: 14,
    stock_minimo: 6,
    sucursal: { codigo: 'SUC1', nombre: 'Sucursal 1' },
    producto: productRef('prd-fideos'),
  },
  {
    tenant_id: TENANT_ID,
    producto_id: 'prd-leche',
    stock_actual: 2,
    stock_minimo: 6,
    sucursal: { codigo: 'CASA', nombre: 'Casa Central' },
    producto: productRef('prd-leche'),
  },
  {
    tenant_id: TENANT_ID,
    producto_id: 'prd-leche',
    stock_actual: 4,
    stock_minimo: 6,
    sucursal: { codigo: 'SUC1', nombre: 'Sucursal 1' },
    producto: productRef('prd-leche'),
  },
  {
    tenant_id: TENANT_ID,
    producto_id: 'prd-atun',
    stock_actual: 1,
    stock_minimo: 4,
    sucursal: { codigo: 'CASA', nombre: 'Casa Central' },
    producto: productRef('prd-atun'),
  },
  {
    tenant_id: TENANT_ID,
    producto_id: 'prd-atun',
    stock_actual: 2,
    stock_minimo: 4,
    sucursal: { codigo: 'SUC1', nombre: 'Sucursal 1' },
    producto: productRef('prd-atun'),
  },
  {
    tenant_id: TENANT_ID,
    producto_id: 'prd-oreo',
    stock_actual: 8,
    stock_minimo: 5,
    sucursal: { codigo: 'CASA', nombre: 'Casa Central' },
    producto: productRef('prd-oreo'),
  },
  {
    tenant_id: TENANT_ID,
    producto_id: 'prd-oreo',
    stock_actual: 10,
    stock_minimo: 5,
    sucursal: { codigo: 'SUC1', nombre: 'Sucursal 1' },
    producto: productRef('prd-oreo'),
  },
];

const CUENTA_CORRIENTE: DbRow[] = [
  { tenant_id: TENANT_ID, proveedor_id: 'prov-ginkgo', cliente_id: null, saldo: 120000, proveedor: { nombre: 'GinkGo' }, cliente: null },
  { tenant_id: TENANT_ID, proveedor_id: 'prov-arcor', cliente_id: null, saldo: 56000, proveedor: { nombre: 'Arcor' }, cliente: null },
  { tenant_id: TENANT_ID, proveedor_id: 'prov-coca', cliente_id: null, saldo: 33000, proveedor: { nombre: 'Coca Cola Andina' }, cliente: null },
  { tenant_id: TENANT_ID, proveedor_id: 'prov-acme-n', cliente_id: null, saldo: 15000, proveedor: { nombre: 'Acme Norte' }, cliente: null },
  { tenant_id: TENANT_ID, proveedor_id: 'prov-acme-s', cliente_id: null, saldo: 9800, proveedor: { nombre: 'Acme Sur' }, cliente: null },
  { tenant_id: TENANT_ID, proveedor_id: 'prov-mayorista', cliente_id: null, saldo: 7800, proveedor: { nombre: 'Mayorista Centro' }, cliente: null },
  { tenant_id: TENANT_ID, proveedor_id: 'prov-favor', cliente_id: null, saldo: -4200, proveedor: { nombre: 'Saldo Favor SA' }, cliente: null },
  { tenant_id: TENANT_ID, proveedor_id: 'prov-cero', cliente_id: null, saldo: 0, proveedor: { nombre: 'Proveedor Cero' }, cliente: null },

  { tenant_id: TENANT_ID, proveedor_id: null, cliente_id: 'cli-juan-perez', saldo: 50000, proveedor: null, cliente: { nombre: 'Juan Perez', razon_social: null } },
  { tenant_id: TENANT_ID, proveedor_id: null, cliente_id: 'cli-kiosco', saldo: 22000, proveedor: null, cliente: { nombre: 'Kiosco Centro', razon_social: 'Kiosco Centro SRL' } },
  { tenant_id: TENANT_ID, proveedor_id: null, cliente_id: 'cli-juan-carlos', saldo: 15000, proveedor: null, cliente: { nombre: 'Juan Carlos', razon_social: null } },
  { tenant_id: TENANT_ID, proveedor_id: null, cliente_id: 'cli-juan-manuel', saldo: 7000, proveedor: null, cliente: { nombre: 'Juan Manuel', razon_social: null } },
  { tenant_id: TENANT_ID, proveedor_id: null, cliente_id: 'cli-ferreteria', saldo: 4500, proveedor: null, cliente: { nombre: 'Ferreteria Sol', razon_social: 'Ferreteria Sol SA' } },
  { tenant_id: TENANT_ID, proveedor_id: null, cliente_id: 'cli-almacen', saldo: 2000, proveedor: null, cliente: { nombre: 'Almacen Norte', razon_social: 'Almacen Norte SRL' } },
  { tenant_id: TENANT_ID, proveedor_id: null, cliente_id: 'cli-maria', saldo: -1000, proveedor: null, cliente: { nombre: 'Maria Lopez', razon_social: null } },
  { tenant_id: TENANT_ID, proveedor_id: null, cliente_id: 'cli-cero', saldo: 0, proveedor: null, cliente: { nombre: 'Cliente Cero', razon_social: null } },
];

const EVAL_MAY = {
  d05: '2026-05-05',
  d10: '2026-05-10',
  d15: '2026-05-15',
  d18: '2026-05-18',
  d22: '2026-05-22',
};
const EVAL_APRIL_D12 = '2026-04-12';

/** Solo para evals de extracto CC (no alteran totales de ventas del fixture). */
const EXTRACTO_CC_COMPROBANTES: DbRow[] = [
  {
    id: 'comp-cc-juan-jun',
    tenant_id: TENANT_ID,
    fecha: EVAL_ANCHOR_YMD,
    estado: 'emitido',
    tipo: 'factura_b',
    total: 12500,
    numero: 42,
    numero_caja: null,
    numero_orden: 1000,
    cliente_id: 'cli-juan-perez',
    cliente: { nombre: 'Juan Perez', razon_social: null },
    metodo_pago: 'cuenta_corriente',
    metodo_pago_detalle: null,
  },
  {
    id: 'comp-cc-juan-may',
    tenant_id: TENANT_ID,
    fecha: EVAL_MAY.d10,
    estado: 'emitido',
    tipo: 'factura_b',
    total: 8000,
    numero: 10,
    numero_caja: null,
    numero_orden: 999,
    cliente_id: 'cli-juan-perez',
    cliente: { nombre: 'Juan Perez', razon_social: null },
    metodo_pago: 'cuenta_corriente',
    metodo_pago_detalle: null,
  },
];

const COMPROBANTES: DbRow[] = [
  {
    id: 'comp-today-factura',
    tenant_id: TENANT_ID,
    fecha: EVAL_ANCHOR_YMD,
    estado: 'emitido',
    tipo: 'factura_b',
    total: 20000,
    numero_orden: 1001,
    cliente_id: 'cli-juan-perez',
    cliente: { nombre: 'Juan Perez', razon_social: null },
    metodo_pago: 'efectivo',
  },
  {
    id: 'comp-today-ticket',
    tenant_id: TENANT_ID,
    fecha: EVAL_ANCHOR_YMD,
    estado: 'emitido',
    tipo: 'ticket',
    total: 15000,
    numero_orden: 1002,
    cliente_id: null,
    cliente: null,
    metodo_pago: 'tarjeta',
  },
  {
    id: 'comp-today-ticket-duplicado',
    tenant_id: TENANT_ID,
    fecha: EVAL_ANCHOR_YMD,
    estado: 'emitido',
    tipo: 'ticket',
    total: 8000,
    numero_orden: 1003,
    cliente_id: 'cli-kiosco',
    cliente: { nombre: 'Kiosco Centro', razon_social: 'Kiosco Centro SRL' },
    metodo_pago: 'transferencia',
  },
  {
    id: 'comp-today-factura-duplicado',
    tenant_id: TENANT_ID,
    fecha: EVAL_ANCHOR_YMD,
    estado: 'emitido',
    tipo: 'factura_c',
    total: 8000,
    numero_orden: 1003,
    cliente_id: 'cli-kiosco',
    cliente: { nombre: 'Kiosco Centro', razon_social: 'Kiosco Centro SRL' },
    metodo_pago: 'transferencia',
  },
  {
    id: 'comp-today-nc',
    tenant_id: TENANT_ID,
    fecha: EVAL_ANCHOR_YMD,
    estado: 'emitido',
    tipo: 'nota_credito_b',
    total: 5000,
    numero_orden: 1004,
    cliente_id: 'cli-juan-perez',
    cliente: { nombre: 'Juan Perez', razon_social: null },
    metodo_pago: 'efectivo',
  },
  {
    id: 'comp-yesterday-factura',
    tenant_id: TENANT_ID,
    fecha: EVAL_YESTERDAY_YMD,
    estado: 'emitido',
    tipo: 'factura_b',
    total: 9000,
    numero_orden: 1005,
    cliente_id: 'cli-ferreteria',
    cliente: { nombre: 'Ferreteria Sol', razon_social: 'Ferreteria Sol SA' },
    metodo_pago: 'efectivo',
  },
  {
    id: 'comp-yesterday-borrador',
    tenant_id: TENANT_ID,
    fecha: EVAL_YESTERDAY_YMD,
    estado: 'borrador',
    tipo: 'ticket',
    total: 5000,
    numero_orden: 1006,
    cliente_id: null,
    cliente: null,
    metodo_pago: 'efectivo',
  },
  {
    id: 'comp-may-1',
    tenant_id: TENANT_ID,
    fecha: EVAL_MAY.d05,
    estado: 'emitido',
    tipo: 'factura_b',
    total: 20000,
    numero_orden: 2001,
    cliente_id: 'cli-juan-perez',
    cliente: { nombre: 'Juan Perez', razon_social: null },
    metodo_pago: 'efectivo',
  },
  {
    id: 'comp-may-2',
    tenant_id: TENANT_ID,
    fecha: EVAL_MAY.d10,
    estado: 'emitido',
    tipo: 'ticket',
    total: 15000,
    numero_orden: 2002,
    cliente_id: null,
    cliente: null,
    metodo_pago: 'tarjeta',
  },
  {
    id: 'comp-may-3',
    tenant_id: TENANT_ID,
    fecha: EVAL_MAY.d18,
    estado: 'emitido',
    tipo: 'factura_c',
    total: 7000,
    numero_orden: 2003,
    cliente_id: 'cli-kiosco',
    cliente: { nombre: 'Kiosco Centro', razon_social: 'Kiosco Centro SRL' },
    metodo_pago: 'transferencia',
  },
  {
    id: 'comp-may-4',
    tenant_id: TENANT_ID,
    fecha: EVAL_MAY.d22,
    estado: 'emitido',
    tipo: 'factura_b',
    total: 5000,
    numero_orden: 2004,
    cliente_id: 'cli-ferreteria',
    cliente: { nombre: 'Ferreteria Sol', razon_social: 'Ferreteria Sol SA' },
    metodo_pago: 'efectivo',
  },
  {
    id: 'comp-april-1',
    tenant_id: TENANT_ID,
    fecha: EVAL_APRIL_D12,
    estado: 'emitido',
    tipo: 'ticket',
    total: 8000,
    numero_orden: 3001,
    cliente_id: 'cli-almacen',
    cliente: { nombre: 'Almacen Norte', razon_social: 'Almacen Norte SRL' },
    metodo_pago: 'efectivo',
  },
];

function comprobanteRef(id: string) {
  const item = COMPROBANTES.find((c) => c.id === id);
  if (!item) throw new Error(`Missing comprobante ${id}`);
  return {
    id: item.id,
    tenant_id: item.tenant_id,
    fecha: item.fecha,
    estado: item.estado,
    tipo: item.tipo,
    fiscalizado_por_id: item.fiscalizado_por_id ?? null,
    total: item.total,
  };
}

const COMPROBANTE_ITEMS: DbRow[] = [
  {
    producto_id: 'prd-yerba',
    cantidad: 3,
    precio_costo: 1000,
    subtotal: 12000,
    comprobante: comprobanteRef('comp-today-factura'),
    producto: productRef('prd-yerba'),
  },
  {
    producto_id: 'prd-coca-225',
    cantidad: 2,
    precio_costo: 1200,
    subtotal: 8000,
    comprobante: comprobanteRef('comp-today-factura'),
    producto: productRef('prd-coca-225'),
  },
  {
    producto_id: 'prd-yerba',
    cantidad: 5,
    precio_costo: 1000,
    subtotal: 15000,
    comprobante: comprobanteRef('comp-today-ticket'),
    producto: productRef('prd-yerba'),
  },
  {
    producto_id: 'prd-yerba',
    cantidad: 1,
    precio_costo: 1000,
    subtotal: 5000,
    comprobante: comprobanteRef('comp-today-nc'),
    producto: productRef('prd-yerba'),
  },
  {
    producto_id: 'prd-arroz',
    cantidad: 4,
    precio_costo: 800,
    subtotal: 9000,
    comprobante: comprobanteRef('comp-yesterday-factura'),
    producto: productRef('prd-arroz'),
  },
  {
    producto_id: 'prd-yerba',
    cantidad: 7,
    precio_costo: 1000,
    subtotal: 20000,
    comprobante: comprobanteRef('comp-may-1'),
    producto: productRef('prd-yerba'),
  },
  {
    producto_id: 'prd-yerba',
    cantidad: 5,
    precio_costo: 1000,
    subtotal: 15000,
    comprobante: comprobanteRef('comp-may-2'),
    producto: productRef('prd-yerba'),
  },
  {
    producto_id: 'prd-arroz',
    cantidad: 4,
    precio_costo: 800,
    subtotal: 7000,
    comprobante: comprobanteRef('comp-may-3'),
    producto: productRef('prd-arroz'),
  },
  {
    producto_id: 'prd-oreo',
    cantidad: 6,
    precio_costo: 900,
    subtotal: 5000,
    comprobante: comprobanteRef('comp-may-4'),
    producto: productRef('prd-oreo'),
  },
  {
    producto_id: 'prd-oreo',
    cantidad: 6,
    precio_costo: 900,
    subtotal: 8000,
    comprobante: comprobanteRef('comp-april-1'),
    producto: productRef('prd-oreo'),
  },
];

function getNestedValue(row: DbRow, column: string): unknown {
  return column.split('.').reduce<unknown>((acc, part) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[part];
  }, row);
}

class MockQueryBuilder implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private rows: DbRow[];
  private isMaybeSingle = false;
  private isSingle = false;

  constructor(rows: DbRow[]) {
    this.rows = rows;
  }

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.rows = this.rows.filter((row) => getNestedValue(row, column) === value);
    return this;
  }

  ilike(column: string, pattern: string): this {
    const needle = pattern.replace(/^%|%$/g, '').toLowerCase();
    this.rows = this.rows.filter((row) => String(row[column] ?? '').toLowerCase().includes(needle));
    return this;
  }

  or(expression: string): this {
    const clauses = expression
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((clause) => {
        const match = clause.match(/^([a-z0-9_]+)\.ilike\.\%(.*)\%$/i);
        if (!match) return null;
        return { field: match[1], needle: match[2].toLowerCase() };
      })
      .filter((item): item is { field: string; needle: string } => Boolean(item));

    this.rows = this.rows.filter((row) =>
      clauses.some((c) => String(row[c.field] ?? '').toLowerCase().includes(c.needle)),
    );
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    if (operator === 'is' && value == null) {
      this.rows = this.rows.filter((row) => row[column] != null);
    }
    return this;
  }

  is(column: string, value: unknown): this {
    if (value === null) {
      this.rows = this.rows.filter((row) => getNestedValue(row, column) == null);
    } else {
      this.rows = this.rows.filter((row) => getNestedValue(row, column) === value);
    }
    return this;
  }

  gt(column: string, value: number): this {
    this.rows = this.rows.filter((row) => Number(getNestedValue(row, column) ?? 0) > Number(value));
    return this;
  }

  gte(column: string, value: string | number): this {
    this.rows = this.rows.filter((row) => String(getNestedValue(row, column) ?? '') >= String(value));
    return this;
  }

  lte(column: string, value: string | number): this {
    this.rows = this.rows.filter((row) => String(getNestedValue(row, column) ?? '') <= String(value));
    return this;
  }

  in(column: string, values: unknown[]): this {
    const set = new Set(values);
    this.rows = this.rows.filter((row) => set.has(getNestedValue(row, column)));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    const asc = options?.ascending ?? true;
    this.rows = [...this.rows].sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      if (typeof av === 'number' && typeof bv === 'number') return asc ? av - bv : bv - av;
      return asc
        ? String(av ?? '').localeCompare(String(bv ?? ''))
        : String(bv ?? '').localeCompare(String(av ?? ''));
    });
    return this;
  }

  limit(count: number): this {
    this.rows = this.rows.slice(0, count);
    return this;
  }

  maybeSingle() {
    this.isMaybeSingle = true;
    return this.execute();
  }

  single() {
    this.isSingle = true;
    return this.execute();
  }

  then<TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null
      | undefined,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: unknown; error: { message: string } | null }> {
    if (this.isSingle) {
      if (this.rows.length !== 1) {
        return { data: null, error: { message: `Expected single row, got ${this.rows.length}` } };
      }
      return { data: this.rows[0], error: null };
    }
    if (this.isMaybeSingle) {
      return { data: this.rows[0] ?? null, error: null };
    }
    return { data: this.rows, error: null };
  }
}

function createMockDb(data: TableData): any {
  return {
    from(table: string) {
      const source = data[table] ?? [];
      const rows = source.map((row) => ({ ...row }));
      return new MockQueryBuilder(rows);
    },
    storage: {
      from() {
        return {
          async upload() {
            return { error: { message: 'upload disabled in eval test' } };
          },
          async createSignedUrl() {
            return { data: null, error: { message: 'createSignedUrl disabled in eval test' } };
          },
        };
      },
    },
  };
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function mapComprobantesForEval(rows: DbRow[]): DbRow[] {
  return rows.map((row) => {
    const posScope = row.tipo === 'ticket' ? POS_TICKET_SCOPE[String(row.id)] : null;
    return {
      ...row,
      sucursal_id: EVAL_SUCURSAL_ID,
      caja_id: posScope?.caja_id ?? null,
      usuario_id: posScope?.usuario_id ?? null,
      created_at: `${String(row.fecha)}T14:00:00.000-03:00`,
    };
  });
}

function comprobantesForCajaEval(): DbRow[] {
  return mapComprobantesForEval(COMPROBANTES);
}

function comprobantesForFullAgentEval(): DbRow[] {
  return mapComprobantesForEval([...COMPROBANTES, ...EXTRACTO_CC_COMPROBANTES]);
}

function buildAgentEvalDb(includeExtractoCcComprobantes: boolean) {
  return createMockDb({
    modulo_config: [
      {
        tenant_id: TENANT_ID,
        stock: true,
        facturador_simple: true,
        facturador_pos: true,
        analizador_rentabilidad: true,
      },
    ],
    tenant: TENANT,
    proveedor: PROVIDERS,
    cliente: CLIENTS,
    sucursal: SUCURSALES,
    producto: PRODUCTS.map((p) => ({
      ...p,
      fecha_vencimiento: p.id === 'prd-leche' ? sumarDiasYmd(EVAL_ANCHOR_YMD, 5) : null,
    })),
    stock_sucursal: STOCK_SUCURSAL,
    cuenta_corriente: CUENTA_CORRIENTE,
    comprobante: includeExtractoCcComprobantes
      ? comprobantesForFullAgentEval()
      : comprobantesForCajaEval(),
    comprobante_item: COMPROBANTE_ITEMS,
    caja_apertura: CAJA_APERTURA,
    caja: CAJAS,
    usuario: USUARIOS_POS,
    cierre_z: CIERRE_Z,
    pago: [],
  });
}

describe('whatsapp-agent-evals v14.4', () => {
  const fixture = evalFixture as EvalFixture;
  const originalLlmFlag = process.env.WHATSAPP_AGENT_INTENT_LLM;
  const originalLlmProvider = process.env.WHATSAPP_AGENT_INTENT_LLM_PROVIDER;

  beforeAll(() => {
    vi.useFakeTimers({ now: new Date('2026-06-01T15:00:00-03:00') });
    process.env.WHATSAPP_AGENT_INTENT_LLM = 'false';
    process.env.WHATSAPP_AGENT_INTENT_LLM_PROVIDER = 'disabled';
  });

  afterAll(() => {
    vi.useRealTimers();
    process.env.WHATSAPP_AGENT_INTENT_LLM = originalLlmFlag;
    process.env.WHATSAPP_AGENT_INTENT_LLM_PROVIDER = originalLlmProvider;
  });

  it('calcula metricas de intent/tool/fallback/continuidad con 80+ casos', async () => {
    const dbDefault = buildAgentEvalDb(false);
    const dbExtractoCc = buildAgentEvalDb(true);

    const mismatches: string[] = [];
    let intentHits = 0;
    let toolHits = 0;
    let continuityHits = 0;
    let fallbackCount = 0;
    let clarificationResolved = 0;
    let clarificationTotal = 0;

    for (const testCase of fixture.cases) {
      const db =
        testCase.expectedIntent === 'cliente_extracto_cc' && testCase.expectedTool === 'getClienteExtractoCc'
          ? dbExtractoCc
          : dbDefault;
      const result = await runWhatsAppReadOnlyAgent({
        db,
        tenantId: TENANT_ID,
        message: testCase.message,
        conversationState: evalIntentContextToState(testCase.intentContext),
        enableV2: true,
        rolWhatsapp: 'operador',
        channel: 'sandbox',
      });

      const intentOk = result.intent === testCase.expectedIntent;
      const toolOk = (result.tool ?? null) === (testCase.expectedTool ?? null);
      const fallbackOk = (result.fallbackReason ?? null) === (testCase.expectedFallbackReason ?? null);
      const replyNorm = normalizeText(result.reply);
      const replyOk = testCase.replyMustContain
        .map((needle) => normalizeText(needle))
        .every((needle) => replyNorm.includes(needle));

      if (intentOk) intentHits += 1;
      if (toolOk) toolHits += 1;
      if (result.fallbackReason) fallbackCount += 1;
      if (testCase.expectedFallbackReason) {
        clarificationTotal += 1;
        if (fallbackOk && replyOk) clarificationResolved += 1;
      }

      const fullPass = intentOk && toolOk && fallbackOk && replyOk;
      if (testCase.continuityProbe && fullPass) continuityHits += 1;

      if (!fullPass) {
        mismatches.push(
          [
            `[${testCase.id}] ${testCase.message}`,
            `intent expected=${testCase.expectedIntent} actual=${result.intent}`,
            `tool expected=${testCase.expectedTool ?? 'null'} actual=${result.tool ?? 'null'}`,
            `fallback expected=${testCase.expectedFallbackReason ?? 'null'} actual=${result.fallbackReason ?? 'null'}`,
            `reply expectedIncludes=${testCase.replyMustContain.join(' | ')} actual="${result.reply}"`,
          ].join(' :: '),
        );
      }
    }

    const total = fixture.cases.length;
    const continuityTotal = fixture.cases.filter((x) => x.continuityProbe).length;

    const metrics = {
      version: fixture.version,
      totalCases: total,
      intentAccuracy: Number((intentHits / Math.max(1, total)).toFixed(4)),
      toolHitRate: Number((toolHits / Math.max(1, total)).toFixed(4)),
      fallbackRate: Number((fallbackCount / Math.max(1, total)).toFixed(4)),
      contextContinuityRate: Number((continuityHits / Math.max(1, continuityTotal)).toFixed(4)),
      followupResolutionRate: Number((continuityHits / Math.max(1, continuityTotal)).toFixed(4)),
      clarificationEfficiency: Number((clarificationResolved / Math.max(1, clarificationTotal)).toFixed(4)),
      actionConfirmationCompletionRate: 1,
      mismatches: mismatches.length,
    };

    console.info('[wa-agent-evals]', metrics);
    if (mismatches.length > 0) {
      console.info('[wa-agent-evals][mismatches]', mismatches.slice(0, 12));
    }

    expect(total).toBeGreaterThanOrEqual(80);
    expect(metrics.intentAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(metrics.toolHitRate).toBeGreaterThanOrEqual(0.9);
    expect(metrics.contextContinuityRate).toBeGreaterThanOrEqual(0.85);
    expect(metrics.clarificationEfficiency).toBeGreaterThanOrEqual(0.85);
    expect(metrics.mismatches).toBe(0);
  });

  it('devuelve toolTrace estructurado para consultas read-only exitosas', async () => {
    const db = createMockDb({
      modulo_config: [
        {
          tenant_id: TENANT_ID,
          stock: true,
          facturador_simple: true,
          facturador_pos: true,
          analizador_rentabilidad: true,
        },
      ],
      producto: PRODUCTS,
      stock_sucursal: STOCK_SUCURSAL,
      cuenta_corriente: CUENTA_CORRIENTE,
    });

    const result = await runWhatsAppReadOnlyAgent({
      db,
      tenantId: TENANT_ID,
      message: 'stock de coca cola 2.25l',
    });

    expect(result.tool).toBe('getProductStock');
    expect(result.toolTrace).toMatchObject({
      name: 'getProductStock',
      status: 'success',
      args: { targetName: 'coca cola 2.25l' },
    });
    expect(result.toolTrace?.durationMs).toBeGreaterThanOrEqual(0);
    expect(String(result.toolTrace?.result).toLowerCase()).toContain('stock total');
  });

  it('resuelve follow-ups de contacto con memoria corta', () => {
    const baseState = conversationStateFixture({
      topic: 'deuda_clientes',
      lastIntent: 'cliente_deuda',
      lastEntityType: 'cliente',
      lastEntityName: 'Juan Perez',
    });

    expect(
      resolveFollowupFromConversationMemory({
        text: 'y el telefono?',
        state: baseState,
      }),
    ).toEqual({ message: 'telefono de cliente Juan Perez', interpreted: true });

    const reportState: WhatsAppConversationState = {
      ...baseState,
      lastIntent: 'reporte_deuda_clientes',
      lastEntityName: null,
      lastOptions: ['Juan Perez', 'Kiosco Centro SRL'],
      lastReportKey: 'deuda_clientes',
      lastReportPage: 1,
    };

    expect(
      resolveFollowupFromConversationMemory({
        text: 'telefono de la primera',
        state: reportState,
      }),
    ).toEqual({ message: 'telefono de cliente Juan Perez', interpreted: true });

    expect(
      resolveFollowupFromConversationMemory({
        text: 'la primera',
        state: reportState,
      }),
    ).toEqual({ message: 'cuanto me debe Juan Perez', interpreted: true });

    expect(
      resolveFollowupFromConversationMemory({
        text: 'Kiosco Centro SRL',
        state: reportState,
      }),
    ).toEqual({ message: 'cuanto me debe Kiosco Centro SRL', interpreted: true });

    const proveedorDebtState = conversationStateFixture({
      topic: 'deuda_proveedores',
      lastIntent: 'reporte_deuda_proveedores',
      lastOptions: ['GinkGo', 'Arcor', 'Coca Cola Andina'],
      lastReportKey: 'deuda_proveedores',
      lastReportPage: 1,
    });

    expect(
      resolveFollowupFromConversationMemory({
        text: 'telefono del primero',
        state: proveedorDebtState,
      }),
    ).toEqual({ message: 'telefono de proveedor GinkGo', interpreted: true });

    const salesState: WhatsAppConversationState = {
      ...baseState,
      topic: 'ventas',
      lastIntent: 'reporte_ventas',
      lastEntityType: null,
      lastEntityName: null,
      lastOptions: [],
    };

    expect(
      resolveFollowupFromConversationMemory({
        text: 'y ayer?',
        state: salesState,
      }),
    ).toEqual({ message: 'ventas ayer', interpreted: true });

    const salesProductsState: WhatsAppConversationState = {
      ...salesState,
      lastIntent: 'reporte_ventas_productos',
    };

    expect(
      resolveFollowupFromConversationMemory({
        text: 'y del mes anterior?',
        state: salesProductsState,
      }),
    ).toEqual({ message: 'productos mas vendidos mes anterior', interpreted: true });

    expect(
      resolveFollowupFromConversationMemory({
        text: 'y de abril?',
        state: salesProductsState,
      }),
    ).toEqual({ message: 'productos mas vendidos abril', interpreted: true });

    const salesCustomersState: WhatsAppConversationState = {
      ...salesState,
      lastIntent: 'reporte_ventas_clientes',
    };

    expect(
      resolveFollowupFromConversationMemory({
        text: 'y del mes anterior?',
        state: salesCustomersState,
      }),
    ).toEqual({ message: 'clientes que mas compraron mes anterior', interpreted: true });

    const profitState: WhatsAppConversationState = {
      ...salesState,
      lastIntent: 'reporte_ganancias',
    };

    expect(
      resolveFollowupFromConversationMemory({
        text: 'y del mes anterior?',
        state: profitState,
      }),
    ).toEqual({ message: 'ganancia mes anterior', interpreted: true });

    const paymentMethodsState: WhatsAppConversationState = {
      ...salesState,
      lastIntent: 'reporte_medios_pago',
    };

    expect(
      resolveFollowupFromConversationMemory({
        text: 'y de mayo?',
        state: paymentMethodsState,
      }),
    ).toEqual({ message: 'medios de pago mayo', interpreted: true });

    expect(
      resolveFollowupFromConversationMemory({
        text: 'y proveedores?',
        state: reportState,
      }),
    ).toEqual({ message: 'reporte deuda proveedores', interpreted: true });

    expect(
      resolveFollowupFromConversationMemory({
        text: 'y stock bajo?',
        state: reportState,
      }),
    ).toEqual({ message: 'reporte stock bajo', interpreted: true });

    expect(
      resolveFollowupFromConversationMemory({
        text: 'y productos mas vendidos?',
        state: reportState,
      }),
    ).toEqual({ message: 'productos mas vendidos', interpreted: true });

    const reportPromptState: WhatsAppConversationState = {
      ...baseState,
      topic: null,
      lastIntent: 'unknown',
      pendingPrompt: 'report_scope',
      lastEntityType: null,
      lastEntityName: null,
      lastOptions: [],
    };

    expect(
      resolveFollowupFromConversationMemory({
        text: 'stock bajo',
        state: reportPromptState,
      }),
    ).toEqual({ message: 'reporte stock bajo', interpreted: true });

    expect(
      resolveFollowupFromConversationMemory({
        text: 'proveedores',
        state: reportPromptState,
      }),
    ).toEqual({ message: 'reporte deuda proveedores', interpreted: true });

    expect(
      resolveFollowupFromConversationMemory({
        text: 'facturacion mes',
        state: reportPromptState,
      }),
    ).toEqual({ message: 'ventas este mes', interpreted: true });

    expect(
      resolveFollowupFromConversationMemory({
        text: 'productos mas vendidos mes anterior',
        state: reportPromptState,
      }),
    ).toEqual({ message: 'productos mas vendidos mes anterior', interpreted: true });

    expect(
      resolveFollowupFromConversationMemory({
        text: 'clientes que mas compraron',
        state: reportPromptState,
      }),
    ).toEqual({ message: 'clientes que mas compraron', interpreted: true });

    expect(
      resolveFollowupFromConversationMemory({
        text: 'ganancia mes anterior',
        state: reportPromptState,
      }),
    ).toEqual({ message: 'ganancia mes anterior', interpreted: true });

    expect(
      resolveFollowupFromConversationMemory({
        text: 'medios de pago hoy',
        state: reportPromptState,
      }),
    ).toEqual({ message: 'medios de pago hoy', interpreted: true });

    expect(
      resolveFollowupFromConversationMemory({
        text: 'ventas mayo',
        state: reportPromptState,
      }),
    ).toEqual({ message: 'ventas mayo', interpreted: true });

    const lowestStockOfferState: WhatsAppConversationState = {
      ...baseState,
      topic: 'stock',
      lastIntent: 'stock_mas_bajo',
      lastEntityType: null,
      lastEntityName: null,
      lastOptions: [],
      lastReportKey: null,
      lastReportPage: null,
    };

    expect(
      resolveFollowupFromConversationMemory({
        text: 'dale pasame porfa',
        state: lowestStockOfferState,
      }),
    ).toEqual({ message: 'reporte stock bajo', interpreted: true });

    expect(
      resolveFollowupFromConversationMemory({
        text: 'si, mandame el reporte',
        state: lowestStockOfferState,
      }),
    ).toEqual({ message: 'reporte stock bajo', interpreted: true });

    expect(
      resolveFollowupFromConversationMemory({
        text: 'pasame stock de coca',
        state: lowestStockOfferState,
      }),
    ).toEqual({ message: 'pasame stock de coca', interpreted: false });
  });

  it('interpreta stock critico como reporte de stock bajo por minimo', async () => {
    const db = createMockDb({
      modulo_config: [{ tenant_id: TENANT_ID, stock: true, facturador_simple: true }],
      stock_sucursal: STOCK_SUCURSAL,
    });

    const result = await runWhatsAppReadOnlyAgent({
      db,
      tenantId: TENANT_ID,
      message: 'que productos tengo con stock critico',
    });

    expect(result.intent).toBe('reporte_stock_bajo');
    expect(result.tool).toBe('getReport:stock_bajo');
    expect(normalizeText(result.reply)).toContain('reporte stock bajo');
  });

  it('guarda como entidad resuelta el nombre real del cliente aunque el mensaje tenga contexto extra', async () => {
    const db = createMockDb({
      modulo_config: [{ tenant_id: TENANT_ID, stock: true, facturador_simple: true }],
      cliente: CLIENTS,
    });

    const result = await runWhatsAppReadOnlyAgent({
      db,
      tenantId: TENANT_ID,
      message: 'el numero de ana garcia, que necesito llamarla',
    });

    expect(result.reply).toContain('Ana Garcia no tiene telefono cargado');
    expect(result.resolvedEntity).toEqual({ type: 'cliente', name: 'Ana Garcia' });

    const followup = resolveFollowupFromConversationMemory({
      text: 'y su correo',
      state: conversationStateFixture({
        topic: 'deuda_clientes',
        lastIntent: result.intent,
        lastEntityType: result.resolvedEntity?.type ?? null,
        lastEntityName: result.resolvedEntity?.name ?? null,
      }),
    });

    expect(followup).toEqual({ message: 'email de cliente Ana Garcia', interpreted: true });
  });
});
