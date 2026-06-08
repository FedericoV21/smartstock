import {
  fusionarGastosCierre,
  parseGastosItemsCierre,
  sumarGastosRows,
} from './caja-gastos.util';

describe('caja-gastos.util', () => {
  it('parseGastosItemsCierre ignora filas inválidas', () => {
    const r = parseGastosItemsCierre([
      { concepto: '  Café  ', monto: 10.5 },
      { concepto: '', monto: 5 },
      { concepto: 'x', monto: -1 },
    ]);
    expect(r.items).toEqual([{ concepto: 'Café', monto: 10.5 }]);
    expect(r.total).toBe(10.5);
  });

  it('fusionarGastosCierre une sesión y extras respetando máximo', () => {
    const sesion = Array.from({ length: 24 }, (_, i) => ({
      id: String(i),
      concepto: `g${i}`,
      monto: 1,
      created_at: new Date().toISOString(),
      usuario_id: null,
    }));
    const ok = fusionarGastosCierre(sesion, [{ concepto: 'extra', monto: 2 }]);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.items).toHaveLength(25);
      expect(ok.total).toBe(26);
    }

    const fail = fusionarGastosCierre(sesion, [
      { concepto: 'a', monto: 1 },
      { concepto: 'b', monto: 1 },
    ]);
    expect(fail.ok).toBe(false);
  });

  it('sumarGastosRows redondea a 2 decimales', () => {
    expect(
      sumarGastosRows([
        {
          id: '1',
          concepto: 'a',
          monto: 10.005,
          created_at: '',
          usuario_id: null,
        },
        {
          id: '2',
          concepto: 'b',
          monto: 5.004,
          created_at: '',
          usuario_id: null,
        },
      ]),
    ).toBe(15.01);
  });
});
