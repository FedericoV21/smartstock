import { describe, expect, it, vi } from 'vitest';

import type { NextResponse } from 'next/server';

vi.mock('@/lib/modulos/guard', () => ({
  moduloGuard: async () => ({ allowed: true, response: null }),
}));

vi.mock('@/lib/api/sucursal-scope', () => ({
  resolveAndValidateSucursalScope: async () => ({ ok: true, sucursalId: 's1' }),
}));

const { obtenerStockComprometidoPorProducto } = vi.hoisted(() => ({
  obtenerStockComprometidoPorProducto: vi.fn(async () => new Map<string, number>()),
}));
vi.mock('@/lib/stock/comprometido', () => ({
  obtenerStockComprometidoPorProducto,
}));

type EstadoPedido = 'borrador' | 'confirmado' | 'entregado' | 'cancelado';
type WorkflowEstado = { id: string; slug: string; nombre: string; color: null; fase: EstadoPedido; activo: boolean };

function makeSupabaseMock(opts: {
  pedidoEstado: EstadoPedido;
  pedidoWorkflowId: string;
  items: { producto_id: string; cantidad: number }[];
  wfActual: WorkflowEstado;
  wfDestino: WorkflowEstado;
  transitionAllowed: boolean;
}) {
  const updateArgs: any[] = [];
  const rpcCalls: any[] = [];

  const from = (table: string) => {
    if (table === 'pedido') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'p1',
                    estado: opts.pedidoEstado,
                    workflow_estado_id: opts.pedidoWorkflowId,
                    items: opts.items,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
        update: (patch: any) => {
          updateArgs.push(patch);
          return {
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    single: async () => ({ data: { id: 'p1', ...patch }, error: null }),
                  }),
                }),
              }),
            }),
          };
        },
      };
    }

    if (table === 'pedido_estado_workflow') {
      // Se usa para:
      // - resolver destino por id
      // - resolver actual por id
      // - fallback por slug
      return {
        select: () => ({
          eq: (k: string, v: string) => {
            if (k === 'tenant_id') {
              return {
                limit: () => ({
                  eq: (k2: string, v2: string) => ({
                    maybeSingle: async () => ({
                      data: k2 === 'id' && v2 === opts.wfDestino.id ? opts.wfDestino : null,
                      error: null,
                    }),
                  }),
                }),
                eq: (k2: string, v2: string) => ({
                  maybeSingle: async () => ({
                    data: k2 === 'id' && v2 === opts.wfActual.id ? opts.wfActual : null,
                    error: null,
                  }),
                }),
                ilike: (_: string, slug: string) => ({
                  maybeSingle: async () => ({
                    data:
                      slug.toLowerCase() === opts.pedidoEstado
                        ? { ...opts.wfActual, slug: opts.pedidoEstado }
                        : null,
                    error: null,
                  }),
                }),
              };
            }
            return {
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            };
          },
          ilike: (_: string, slug: string) => ({
            maybeSingle: async () => ({
              data: slug.toLowerCase() === opts.pedidoEstado ? opts.wfActual : null,
              error: null,
            }),
          }),
          limit: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    }

    if (table === 'pedido_estado_workflow_transicion') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: opts.transitionAllowed ? { tenant_id: 't1' } : null,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };
    }

    if (table === 'producto') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { nombre: 'Prod', stock_actual: 999 },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };
    }

    throw new Error(`unexpected table ${table}`);
  };

  const rpc = async (fn: string, args: any) => {
    rpcCalls.push({ fn, args });
    return { error: null };
  };

  return {
    supabase: { from, rpc },
    updateArgs,
    rpcCalls,
  };
}

vi.mock('@/lib/api/tenant-session', async () => {
  let current: any = null;
  return {
    __setTenantSessionForTest: (s: any) => {
      current = s;
    },
    getTenantSession: async () => current,
    rejectIfVisor: () => null,
  };
});

async function runPatch(body: any, tenantSession: any) {
  const tenantSessionMod = await import('@/lib/api/tenant-session');
  (tenantSessionMod as any).__setTenantSessionForTest(tenantSession);

  const mod = await import('@/app/api/pedidos/[id]/estado/route');
  const { PATCH } = mod;
  const req = new Request('http://localhost/api/pedidos/p1/estado?sucursal_id=s1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const res = (await PATCH(req, { params: Promise.resolve({ id: 'p1' }) })) as unknown as NextResponse;
  return res;
}

describe('PATCH /api/pedidos/[id]/estado (workflow)', () => {
  it('cambiar workflow dentro de la misma fase no toca stock', async () => {
    obtenerStockComprometidoPorProducto.mockClear();

    const wfActual: WorkflowEstado = {
      id: 'w1',
      slug: 'confirmado',
      nombre: 'Confirmado',
      color: null,
      fase: 'confirmado',
      activo: true,
    };
    const wfDestino: WorkflowEstado = {
      id: 'w2',
      slug: 'transferido_sucursal',
      nombre: 'Transferido a sucursal',
      color: null,
      fase: 'confirmado',
      activo: true,
    };

    const db = makeSupabaseMock({
      pedidoEstado: 'confirmado',
      pedidoWorkflowId: 'w1',
      items: [{ producto_id: 'prod1', cantidad: 1 }],
      wfActual,
      wfDestino,
      transitionAllowed: true,
    });

    const res = await runPatch(
      { workflow_estado_id: 'w2' },
      {
        tenantId: 't1',
        userId: 'u1',
        rol: 'admin',
        isSuperAdmin: false,
        supabase: db.supabase,
      },
    );

    expect(res.status).toBe(200);
    expect(obtenerStockComprometidoPorProducto).not.toHaveBeenCalled();
    expect(db.rpcCalls.length).toBe(0);
    expect(db.updateArgs[0]).toEqual({ workflow_estado_id: 'w2' });
  });

  it('cambiar a fase entregado dispara movimientos de stock', async () => {
    obtenerStockComprometidoPorProducto.mockClear();

    const wfActual: WorkflowEstado = {
      id: 'w1',
      slug: 'confirmado',
      nombre: 'Confirmado',
      color: null,
      fase: 'confirmado',
      activo: true,
    };
    const wfDestino: WorkflowEstado = {
      id: 'w3',
      slug: 'entregado',
      nombre: 'Enviado',
      color: null,
      fase: 'entregado',
      activo: true,
    };

    const db = makeSupabaseMock({
      pedidoEstado: 'confirmado',
      pedidoWorkflowId: 'w1',
      items: [
        { producto_id: 'prod1', cantidad: 2 },
        { producto_id: 'prod2', cantidad: 1 },
      ],
      wfActual,
      wfDestino,
      transitionAllowed: true,
    });

    const res = await runPatch(
      { workflow_estado_id: 'w3', stock_bloqueante: true },
      {
        tenantId: 't1',
        userId: 'u1',
        rol: 'admin',
        isSuperAdmin: false,
        supabase: db.supabase,
      },
    );

    expect(res.status).toBe(200);
    expect(db.rpcCalls.length).toBe(2);
    expect(db.rpcCalls[0]?.fn).toBe('registrar_movimiento');
    expect(db.updateArgs[0]).toEqual({ workflow_estado_id: 'w3', estado: 'entregado' });
  });

  it('guarda notas junto con el cambio de workflow cuando vienen en el body', async () => {
    const wfActual: WorkflowEstado = {
      id: 'w1',
      slug: 'confirmado',
      nombre: 'Confirmado',
      color: null,
      fase: 'confirmado',
      activo: true,
    };
    const wfDestino: WorkflowEstado = {
      id: 'w2',
      slug: 'transferido_sucursal',
      nombre: 'Transferido a sucursal',
      color: null,
      fase: 'confirmado',
      activo: true,
    };

    const db = makeSupabaseMock({
      pedidoEstado: 'confirmado',
      pedidoWorkflowId: 'w1',
      items: [{ producto_id: 'prod1', cantidad: 1 }],
      wfActual,
      wfDestino,
      transitionAllowed: true,
    });

    const res = await runPatch(
      { workflow_estado_id: 'w2', notas: '  Coordinar entrega por la tarde  ' },
      {
        tenantId: 't1',
        userId: 'u1',
        rol: 'admin',
        isSuperAdmin: false,
        supabase: db.supabase,
      },
    );

    expect(res.status).toBe(200);
    expect(db.updateArgs[0]).toEqual({
      workflow_estado_id: 'w2',
      notas: 'Coordinar entrega por la tarde',
    });
  });
});
