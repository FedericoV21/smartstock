import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  mpTransferenciaHabilitadaEnConfig,
  verificarTransferenciaMp,
} from '@/lib/mp-transferencia/service';

function applyFilters(rows: Record<string, unknown>[], filters: Array<{ op: 'eq' | 'in'; key: string; value: unknown }>) {
  return rows.filter((row) =>
    filters.every((filter) => {
      if (filter.op === 'eq') return row[filter.key] === filter.value;
      return Array.isArray(filter.value) && filter.value.includes(row[filter.key]);
    }),
  );
}

function queryBuilder(rows: Record<string, unknown>[]) {
  const filters: Array<{ op: 'eq' | 'in'; key: string; value: unknown }> = [];
  const run = () => ({ data: applyFilters(rows, filters), error: null });
  return {
    eq(key: string, value: unknown) {
      filters.push({ op: 'eq', key, value });
      return this;
    },
    in(key: string, value: unknown[]) {
      filters.push({ op: 'in', key, value });
      return this;
    },
    order() {
      return Promise.resolve(run());
    },
    then(resolve: (value: ReturnType<typeof run>) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(run()).then(resolve, reject);
    },
  };
}

function dbMemoria() {
  const movimientos: Record<string, unknown>[] = [];
  const verificaciones: Record<string, unknown>[] = [];
  return {
    movimientos,
    from(table: string) {
      if (table === 'mp_transferencia_movimiento') {
        return {
          upsert: async (rows: Record<string, unknown>[]) => {
            for (const row of rows) {
              const idx = movimientos.findIndex(
                (m) => m.tenant_id === row.tenant_id && m.mp_movimiento_id === row.mp_movimiento_id,
              );
              const next = { id: `mov-${idx >= 0 ? idx + 1 : movimientos.length + 1}`, ...row };
              if (idx >= 0) movimientos[idx] = { ...movimientos[idx], ...next };
              else movimientos.push(next);
            }
            return { error: null };
          },
          select: () => queryBuilder(movimientos),
        };
      }
      if (table === 'mp_transferencia_verificacion') {
        return {
          select: () => queryBuilder(verificaciones),
        };
      }
      throw new Error(`Tabla inesperada: ${table}`);
    },
  };
}

describe('mp-transferencia service payments search', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('importa pagos aprobados y matchea por fecha e importe exacto', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            paging: { total: 1, limit: 100, offset: 0 },
            results: [
              {
                id: 987654,
                date_created: '2026-05-26T10:10:00.000-03:00',
                date_approved: '2026-05-26T10:10:01.000-03:00',
                status: 'approved',
                status_detail: 'accredited',
                transaction_amount: 1500,
                currency_id: 'ARS',
                payment_method_id: 'account_money',
                payment_type_id: 'account_money',
                description: 'Transferencia CVU',
                payer: { email: 'cliente@example.com' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const db = dbMemoria();

    const result = await verificarTransferenciaMp(db as never, {
      tenantId: 'tenant-1',
      sucursalId: 'suc-1',
      comprobanteId: 'comp-1',
      total: 1500,
      accessToken: 'mp-token',
      fecha: '2026-05-26',
    });

    expect(result.estado).toBe('una_coincidencia');
    if (result.estado !== 'una_coincidencia') throw new Error('estado inesperado');
    expect(result.movimientos[0]).toMatchObject({
      mp_movimiento_id: '987654',
      monto: 1500,
      moneda: 'ARS',
      payment_type: 'account_money',
      contraparte: 'cliente@example.com',
    });
    expect(db.movimientos[0]?.raw).toMatchObject({ source: 'payments_search' });
  });

  it('acepta flags legacy/string para habilitar Transferencia MP', () => {
    expect(mpTransferenciaHabilitadaEnConfig({ mp_transferencia_habilitada: true })).toBe(true);
    expect(mpTransferenciaHabilitadaEnConfig({ mp_transferencia_habilitada: 'true' })).toBe(true);
    expect(mpTransferenciaHabilitadaEnConfig({ mp_transferencia_habilitada: '1' })).toBe(true);
    expect(mpTransferenciaHabilitadaEnConfig({ mp_transferencia_habilitada: false })).toBe(false);
  });
});
