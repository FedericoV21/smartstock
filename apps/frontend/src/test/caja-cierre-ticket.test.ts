import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as cierreZPost } from '@/app/api/caja/cierre-z/route';
import { POST as turnoCerrarPost } from '@/app/api/caja/turno/cerrar/route';
import {
  crearTicketResumenCierreCaja,
  type ArqueoEfectivoCierre,
  type CierreCajaTicketResumen,
} from '@/lib/caja/cierre-ticket-resumen';
import { buildCierreCajaTicketHTML } from '@/lib/caja/ticket-cierre-caja';
import type { SnapshotCierreZ } from '@/lib/caja/cierre-z-calculo';

const mockGetTenantSession = vi.fn();
const mockRejectIfVisor = vi.fn();
const mockResolveAndValidateSucursalScope = vi.fn();
const mockObtenerAperturaVigente = vi.fn();
const mockPersistCierreZDiarioSesion = vi.fn();
const mockModuloGuard = vi.fn();

vi.mock('@/lib/api/tenant-session', () => ({
  getTenantSession: (...args: unknown[]) => mockGetTenantSession(...args),
  rejectIfVisor: (...args: unknown[]) => mockRejectIfVisor(...args),
}));

vi.mock('@/lib/api/sucursal-scope', () => ({
  resolveAndValidateSucursalScope: (...args: unknown[]) => mockResolveAndValidateSucursalScope(...args),
}));

vi.mock('@/lib/caja/sesion-caja', () => ({
  obtenerAperturaVigente: (...args: unknown[]) => mockObtenerAperturaVigente(...args),
  cajaAperturaIdDesdePayloadResumen: () => null,
  cierreDiarioMismaVentana: () => false,
  cierreDiarioMismoRangoDesde: () => false,
}));

vi.mock('@/lib/caja/persist-cierre-z-diario-sesion', () => ({
  persistCierreZDiarioSesion: (...args: unknown[]) => mockPersistCierreZDiarioSesion(...args),
}));

vi.mock('@/lib/modulos/guard', () => ({
  moduloGuard: (...args: unknown[]) => mockModuloGuard(...args),
}));

const snapshot: SnapshotCierreZ = {
  total_comprobantes: 3,
  ventas_brutas: 3500,
  notas_credito_total: 500,
  ventas_netas: 3000,
  pagos_cta_cte_total: 200,
  efectivo_cobros_cc_manual: 100,
  fondo_apertura: 1000,
  efectivo_ventas_periodo: 1500,
  efectivo_esperado: 2600,
  modo_periodo: 'sesion_apertura',
  sesion_apertura_id: 'ap-1',
  medios: [
    { metodo_pago: 'efectivo', monto_neto: 1500, cantidad_comprobantes: 2 },
    { metodo_pago: 'transferencia', monto_neto: 1500, cantidad_comprobantes: 1 },
  ],
};

const arqueo: ArqueoEfectivoCierre = {
  fondo_apertura: 1000,
  efectivo_ventas_periodo: 1500,
  esperado_sistema: 2600,
  gastos_monto: 120,
  gastos_detalle: 'Bolsa: 120',
  esperado_ajustado: 2480,
  contado: 2500,
  diferencia: 20,
  esperado: 2480,
};

function resumenFixture(): CierreCajaTicketResumen {
  return crearTicketResumenCierreCaja({
    cierreId: 'cz-1',
    fechaOperativa: '2026-05-18',
    cajaIdNormalizada: 'caja-1',
    rangoDesde: '2026-05-18T12:00:00.000Z',
    rangoHasta: '2026-05-18T20:00:00.000Z',
    createdAt: '2026-05-18T20:01:00.000Z',
    snapshot,
    arqueo,
    gastosItems: [{ concepto: 'Bolsa <test>', monto: 120 }],
  });
}

function createCierreZSupabaseMock() {
  const selectBuilder = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { id: 'turno-1', caja_id: 'caja-1' },
      error: null,
    }),
  };

  let updateEqCalls = 0;
  const updateBuilder = {
    eq: vi.fn(() => {
      updateEqCalls += 1;
      return updateEqCalls === 1 ? updateBuilder : Promise.resolve({ error: null });
    }),
  };

  return {
    from: vi.fn((table: string) => {
      if (table !== 'caja_turno') throw new Error(`Tabla inesperada: ${table}`);
      return {
        select: vi.fn().mockReturnValue(selectBuilder),
        update: vi.fn().mockReturnValue(updateBuilder),
      };
    }),
  };
}

function createTurnoSupabaseMock() {
  const turnoSelectBuilder = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { id: 'turno-1', caja_id: 'caja-1', tenant_id: 'tenant-1', abierto_at: '2026-05-18T12:00:00.000Z' },
      error: null,
    }),
  };
  const cajaSelectBuilder = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { id: 'caja-1', sucursal_id: 'suc-1', nombre: 'Mostrador', numero: 1, auto_cierre_horas: null },
      error: null,
    }),
  };

  let updateEqCalls = 0;
  const updateBuilder = {
    eq: vi.fn(() => {
      updateEqCalls += 1;
      return updateEqCalls === 1 ? updateBuilder : Promise.resolve({ error: null });
    }),
  };

  return {
    from: vi.fn((table: string) => {
      if (table === 'caja_turno') {
        return {
          select: vi.fn().mockReturnValue(turnoSelectBuilder),
          update: vi.fn().mockReturnValue(updateBuilder),
        };
      }
      if (table === 'caja') {
        return { select: vi.fn().mockReturnValue(cajaSelectBuilder) };
      }
      throw new Error(`Tabla inesperada: ${table}`);
    }),
  };
}

describe('ticket de cierre de caja', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRejectIfVisor.mockReturnValue(null);
    mockResolveAndValidateSucursalScope.mockResolvedValue({ ok: true, sucursalId: 'suc-1' });
    mockObtenerAperturaVigente.mockResolvedValue({
      id: 'ap-1',
      fecha_operativa: '2026-05-18',
      opened_at: '2026-05-18T12:00:00.000Z',
      fondo_efectivo: 1000,
    });
    mockPersistCierreZDiarioSesion.mockResolvedValue({
      ok: true,
      cierre_id: 'cz-1',
      snapshot,
      arqueo_efectivo: arqueo,
      ticket_resumen: resumenFixture(),
    });
    mockModuloGuard.mockResolvedValue({ allowed: true });
  });

  it('arma HTML compacto, escapado y con totales clave', () => {
    const html = buildCierreCajaTicketHTML(
      resumenFixture(),
      {
        tenantNombre: 'Tienda & Demo',
        tenantCuit: '20-123',
        tenantDomicilio: 'Calle 1',
        cajaEtiqueta: 'Caja 01 - Mostrador',
        cajeroNombre: 'Nico <script>',
      },
      '80mm',
    );

    expect(html).toContain('CIERRE DE CAJA');
    expect(html).toContain('Tienda &amp; Demo');
    expect(html).toContain('Nico &lt;script&gt;');
    expect(html).not.toContain('Nico <script>');
    expect(html).toContain('Comprobantes');
    expect(html).toContain('MEDIOS DE PAGO');
    expect(html).toContain('Fondo inicial');
    expect(html).toContain('Contado');
    expect(html).toContain('Diferencia');
    expect(html).toContain('Bolsa &lt;test&gt;');
  });

  it('POST /api/caja/cierre-z devuelve ticket_resumen para cierre rapido POS', async () => {
    const supabase = createCierreZSupabaseMock();
    mockGetTenantSession.mockResolvedValue({
      rol: 'admin',
      tenantId: 'tenant-1',
      userId: 'user-1',
      supabase,
    });

    const res = await cierreZPost(
      new Request('http://localhost/api/caja/cierre-z', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caja_id: 'caja-1',
          modo_periodo: 'sesion_apertura',
          tipo_cierre: 'diario',
          efectivo_contado: 2500,
          gastos_items: [{ concepto: 'Bolsa', monto: 120 }],
        }),
      }),
    );
    const json = (await res.json()) as { ticket_resumen?: CierreCajaTicketResumen };

    expect(res.status).toBe(201);
    expect(json.ticket_resumen).toMatchObject({
      cierre_id: 'cz-1',
      fecha_operativa: '2026-05-18',
      caja_id: 'caja-1',
      snapshot: expect.objectContaining({ total_comprobantes: 3 }),
      arqueo_efectivo: expect.objectContaining({ contado: 2500 }),
      gastos_items: [{ concepto: 'Bolsa <test>', monto: 120 }],
    });
  });

  it('POST /api/caja/turno/cerrar tambien devuelve ticket_resumen', async () => {
    const supabase = createTurnoSupabaseMock();
    mockGetTenantSession.mockResolvedValue({
      rol: 'admin',
      tenantId: 'tenant-1',
      userId: 'user-1',
      supabase,
    });

    const res = await turnoCerrarPost(
      new Request('http://localhost/api/caja/turno/cerrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ efectivo_contado: 2500 }),
      }),
    );
    const json = (await res.json()) as { ticket_resumen?: CierreCajaTicketResumen };

    expect(res.status).toBe(201);
    expect(json.ticket_resumen?.cierre_id).toBe('cz-1');
    expect(json.ticket_resumen?.arqueo_efectivo?.diferencia).toBe(20);
  });
});
