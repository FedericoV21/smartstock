import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { emitirComprobante } from '@/lib/facturacion/emitir-comprobante';
import { generarPDF } from '@/lib/facturacion/pdf-generator';
import type { Database } from '@/types/database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const integrationConfigured = Boolean(supabaseUrl && anonKey && serviceRoleKey);

function userClient(accessToken: string): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl!, anonKey!, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

describe.skipIf(!integrationConfigured)('Integración — facturación (Supabase)', () => {
  const admin = createClient<Database>(supabaseUrl!, serviceRoleKey!);

  const runId = crypto.randomUUID().slice(0, 8);
  const email = `fac-int-${runId}@smartstock-integration.test`;
  const password = 'test-pass-fac-01';

  let tenantId: string;
  let userId: string;
  let token: string;
  let clienteId: string;
  let productoId: string;
  let productoStockBajoId: string;

  beforeAll(async () => {
    const { data: t, error: te } = await admin
      .from('tenant')
      .insert({
        nombre: `FAC Int ${runId}`,
        plan: 'base',
        condicion_iva: 'monotributista',
        punto_de_venta: 1,
      })
      .select('id')
      .single();
    if (te || !t) throw te ?? new Error('tenant');
    tenantId = t.id;

    const { error: mcErr } = await admin.from('modulo_config').insert({
      tenant_id: tenantId,
      stock: true,
      importador_excel: true,
      facturador_simple: true,
      facturador_arca: false,
      pedidos: false,
      presupuestos: false,
      ia_precios: false,
    });
    if (mcErr) throw mcErr;

    const { data: auth, error: ae } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (ae || !auth.user) throw ae ?? new Error('auth');
    userId = auth.user.id;

    const { error: ue } = await admin.from('usuario').insert({
      id: userId,
      tenant_id: tenantId,
      nombre: 'Test',
      apellido: 'Facturacion',
      email,
      rol: 'admin',
    });
    if (ue) throw ue;

    const signIn = createClient<Database>(supabaseUrl!, anonKey!);
    const { data: sess, error: se } = await signIn.auth.signInWithPassword({ email, password });
    if (se || !sess.session) throw se ?? new Error('session');
    token = sess.session.access_token;

    const sb = userClient(token);

    const { data: cl, error: cle } = await sb
      .from('cliente')
      .insert({
        tenant_id: tenantId,
        nombre: 'Cliente CF',
        condicion_iva: 'consumidor_final',
        activo: true,
      })
      .select('id')
      .single();
    if (cle || !cl) throw cle ?? new Error('cliente');
    clienteId = cl.id;

    const codigo = `FAC-${runId}`;
    const { data: p, error: pe } = await sb
      .from('producto')
      .insert({
        tenant_id: tenantId,
        codigo,
        nombre: 'Producto test',
        precio_costo: 10,
        precio_venta: 20,
        unidad: 'unidad',
        stock_actual: 100,
        stock_minimo: 0,
        activo: true,
      })
      .select('id')
      .single();
    if (pe || !p) throw pe ?? new Error('producto');
    productoId = p.id;

    const { data: pb, error: pbe } = await sb
      .from('producto')
      .insert({
        tenant_id: tenantId,
        codigo: `LOW-${runId}`,
        nombre: 'Stock bajo',
        precio_costo: 1,
        precio_venta: 2,
        unidad: 'unidad',
        stock_actual: 2,
        stock_minimo: 0,
        activo: true,
      })
      .select('id')
      .single();
    if (pbe || !pb) throw pbe ?? new Error('producto bajo');
    productoStockBajoId = pb.id;
  }, 120_000);

  afterAll(async () => {
    try {
      if (tenantId) await admin.from('tenant').delete().eq('id', tenantId);
    } catch {
      /* best-effort */
    }
    try {
      if (userId) await admin.auth.admin.deleteUser(userId);
    } catch {
      /* best-effort */
    }
  });

  it('emitir Factura C descuenta stock correctamente', async () => {
    const sb = userClient(token);
    const antes = (await sb.from('producto').select('stock_actual').eq('id', productoId).single())
      .data!.stock_actual;

    const r = await emitirComprobante(
      sb,
      { tenantId, userId },
      {
        tipo: 'factura_c',
        cliente_id: clienteId,
        items: [{ producto_id: productoId, cantidad: 7, precio_unitario: 20 }],
      },
      { generarPdfYSubir: false },
    );

    expect(r.ok).toBe(true);
    const despues = (await sb.from('producto').select('stock_actual').eq('id', productoId).single())
      .data!.stock_actual;
    expect(despues).toBe(antes - 7);
  });

  it('normaliza tipo "factura" a Factura C para monotributista', async () => {
    const sb = userClient(token);

    const r = await emitirComprobante(
      sb,
      { tenantId, userId },
      {
        tipo: 'factura',
        cliente_id: clienteId,
        items: [{ producto_id: productoId, cantidad: 1, precio_unitario: 20 }],
      },
      { generarPdfYSubir: false },
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.comprobante.tipo).toBe('factura_c');
  });

  it('emitir Nota de Crédito C devuelve stock', async () => {
    const sb = userClient(token);
    const antes = (await sb.from('producto').select('stock_actual').eq('id', productoId).single())
      .data!.stock_actual;

    const r = await emitirComprobante(
      sb,
      { tenantId, userId },
      {
        tipo: 'nota_credito_c',
        cliente_id: clienteId,
        items: [{ producto_id: productoId, cantidad: 4, precio_unitario: 20 }],
      },
      { generarPdfYSubir: false },
    );

    expect(r.ok).toBe(true);
    const despues = (await sb.from('producto').select('stock_actual').eq('id', productoId).single())
      .data!.stock_actual;
    expect(despues).toBe(antes + 4);
  });

  it('presupuesto no afecta stock', async () => {
    const sb = userClient(token);
    const antes = (await sb.from('producto').select('stock_actual').eq('id', productoId).single())
      .data!.stock_actual;

    const r = await emitirComprobante(
      sb,
      { tenantId, userId },
      {
        tipo: 'presupuesto',
        cliente_id: clienteId,
        items: [{ producto_id: productoId, cantidad: 50, precio_unitario: 20 }],
      },
      { generarPdfYSubir: false },
    );

    expect(r.ok).toBe(true);
    const despues = (await sb.from('producto').select('stock_actual').eq('id', productoId).single())
      .data!.stock_actual;
    expect(despues).toBe(antes);
  });

  it('numeración secuencial sin huecos (mismo tipo)', async () => {
    const sb = userClient(token);

    const r1 = await emitirComprobante(
      sb,
      { tenantId, userId },
      {
        tipo: 'remito',
        cliente_id: clienteId,
        items: [{ producto_id: productoId, cantidad: 1, precio_unitario: 10 }],
      },
      { generarPdfYSubir: false },
    );
    const r2 = await emitirComprobante(
      sb,
      { tenantId, userId },
      {
        tipo: 'remito',
        cliente_id: clienteId,
        items: [{ producto_id: productoId, cantidad: 1, precio_unitario: 10 }],
      },
      { generarPdfYSubir: false },
    );

    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    const n1 = r1.data.comprobante.numero;
    const n2 = r2.data.comprobante.numero;
    expect(n2).toBe(n1 + 1);
  });

  it('stock insuficiente rechaza la emisión', async () => {
    const sb = userClient(token);
    const r = await emitirComprobante(
      sb,
      { tenantId, userId },
      {
        tipo: 'factura_c',
        cliente_id: clienteId,
        items: [{ producto_id: productoStockBajoId, cantidad: 500, precio_unitario: 2 }],
      },
      { generarPdfYSubir: false },
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/Stock insuficiente/i);
  });

  it('generarPDF produce un PDF no vacío', () => {
    const pdf = generarPDF(
      {
        nombre: 'Negocio',
        razon_social: null,
        cuit: null,
        domicilio: null,
        condicion_iva: 'monotributista',
        punto_de_venta: 1,
      },
      {
        nombre: 'Cliente',
        razon_social: null,
        cuit_dni: null,
        condicion_iva: 'consumidor_final',
        direccion: null,
      },
      {
        tipo: 'factura_c',
        numero: 1,
        fecha: '2026-01-15',
        subtotal: 100,
        iva_monto: 0,
        iva_porcentaje: 21,
        total: 100,
        notas: null,
        cae: null,
        cae_vencimiento: null,
      },
      [{ cantidad: 1, descripcion: 'Item', precio_unitario: 100, subtotal: 100 }],
    );
    const buf = pdf.output('arraybuffer');
    expect(buf.byteLength).toBeGreaterThan(500);
  });
});
