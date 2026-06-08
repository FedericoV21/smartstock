import { describe, expect, it } from 'vitest';

import {
  proximoVencimientoDiaFijoMes,
  resolverVencimientoCobranza,
} from '@/lib/cobranza/dias-vencimiento-cuenta';

describe('proximoVencimientoDiaFijoMes', () => {
  it('misma mes si el día de emisión es anterior al día fijo', () => {
    const em = new Date(2026, 2, 10, 10, 0, 0);
    const v = proximoVencimientoDiaFijoMes(em, 22);
    expect(v.getFullYear()).toBe(2026);
    expect(v.getMonth()).toBe(2);
    expect(v.getDate()).toBe(22);
  });

  it('mes siguiente si el día fijo ya pasó en el mes', () => {
    const em = new Date(2026, 2, 25, 10, 0, 0);
    const v = proximoVencimientoDiaFijoMes(em, 22);
    expect(v.getFullYear()).toBe(2026);
    expect(v.getMonth()).toBe(3);
    expect(v.getDate()).toBe(22);
  });

  it('ajusta al último día si el mes no tiene día 31', () => {
    const em = new Date(2026, 1, 5, 10, 0, 0);
    const v = proximoVencimientoDiaFijoMes(em, 31);
    expect(v.getMonth()).toBe(1);
    expect(v.getDate()).toBe(28);
  });
});

describe('resolverVencimientoCobranza', () => {
  it('prioriza fecha explícita', () => {
    const v = resolverVencimientoCobranza({
      fechaEmisionYmd: '2026-03-10',
      fechaExplicitaYmd: '2026-04-15',
      cuenta: {
        cobro_modalidad: 'por_comprobante',
        cobro_dias_plazo: 7,
        cobro_periodicidad: null,
        cobro_dia_vencimiento_mes: null,
      },
    });
    expect(v.getFullYear()).toBe(2026);
    expect(v.getMonth()).toBe(3);
    expect(v.getDate()).toBe(15);
  });

  it('modalidad periódica diaria suma un día desde la emisión', () => {
    const v = resolverVencimientoCobranza({
      fechaEmisionYmd: '2026-03-10',
      fechaExplicitaYmd: null,
      cuenta: {
        cobro_modalidad: 'periodico',
        cobro_dias_plazo: 7,
        cobro_periodicidad: 'diaria',
        cobro_dia_vencimiento_mes: null,
      },
    });
    expect(v.getFullYear()).toBe(2026);
    expect(v.getMonth()).toBe(2);
    expect(v.getDate()).toBe(11);
  });
});
