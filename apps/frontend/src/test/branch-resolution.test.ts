import { describe, expect, it } from 'vitest';

import { buildBranchPromptMessage, resolveBranchByRules } from '@/lib/whatsapp/branch-resolution';

type SucursalRow = {
  id: string;
  nombre: string;
  codigo: string | null;
  es_principal?: boolean | null;
};

function mockBranchDb(params: {
  sucursales: SucursalRow[];
  reglas?: Array<{ sucursal_id: string; prioridad: number }>;
}) {
  const { sucursales, reglas = [] } = params;
  return {
    from(table: string) {
      if (table === 'sucursal') {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: sucursales, error: null }),
            }),
          }),
        };
      }
      if (table === 'whatsapp_branch_rule') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                or: () => ({
                  or: () => ({
                    order: async () => ({ data: reglas, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

const INPUT = {
  tenantId: 'tenant-1',
  fromWaId: '5493816285231',
  phoneNumberId: 'phone-1',
};

describe('resolveBranchByRules', () => {
  it('resuelve una sola sucursal activa', async () => {
    const result = await resolveBranchByRules(
      mockBranchDb({
        sucursales: [{ id: 's1', nombre: 'Casa', codigo: 'CASA', es_principal: true }],
      }),
      INPUT,
    );
    expect(result).toMatchObject({
      type: 'resolved_auto',
      branchId: 's1',
      reason: 'single_active_branch',
    });
  });

  it('usa sucursal principal cuando hay varias sin regla', async () => {
    const result = await resolveBranchByRules(
      mockBranchDb({
        sucursales: [
          { id: 'principal', nombre: 'Sucursal Principal', codigo: 'CASA', es_principal: true },
          { id: 'depo', nombre: 'Depósito Norte', codigo: 'NORTE', es_principal: false },
        ],
      }),
      INPUT,
    );
    expect(result).toMatchObject({
      type: 'resolved_auto',
      branchId: 'principal',
      reason: 'principal_branch_default',
    });
  });

  it('sigue ambiguo si hay varias principales o ninguna', async () => {
    const sinPrincipal = await resolveBranchByRules(
      mockBranchDb({
        sucursales: [
          { id: 'a', nombre: 'A', codigo: null, es_principal: false },
          { id: 'b', nombre: 'B', codigo: null, es_principal: false },
        ],
      }),
      INPUT,
    );
    expect(sinPrincipal.reason).toBe('multiple_active_branches_without_rule');

    const dosPrincipales = await resolveBranchByRules(
      mockBranchDb({
        sucursales: [
          { id: 'a', nombre: 'A', codigo: null, es_principal: true },
          { id: 'b', nombre: 'B', codigo: null, es_principal: true },
        ],
      }),
      INPUT,
    );
    expect(dosPrincipales.reason).toBe('multiple_active_branches_without_rule');
  });

  it('prioriza regla explicita sobre principal', async () => {
    const result = await resolveBranchByRules(
      mockBranchDb({
        sucursales: [
          { id: 'principal', nombre: 'Principal', codigo: 'P', es_principal: true },
          { id: 'rule', nombre: 'Rule', codigo: 'R', es_principal: false },
        ],
        reglas: [{ sucursal_id: 'rule', prioridad: 10 }],
      }),
      INPUT,
    );
    expect(result).toMatchObject({
      type: 'resolved_auto',
      branchId: 'rule',
      reason: 'matched_branch_rule',
    });
  });
});

describe('buildBranchPromptMessage', () => {
  it('menciona factura y comandos de ticket', () => {
    const body = buildBranchPromptMessage([{ nombre: 'Centro', codigo: 'CEN' }]);
    expect(body).toContain('factura');
    expect(body).toContain('revisar');
    expect(body).toContain('1) Centro (CEN)');
  });
});
