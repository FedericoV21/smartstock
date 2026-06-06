import {
  anticipacionRecordatorioSegunCondicion,
  debeMostrarEnCampanaCobranza,
  telefonoArgentinoAE164,
} from './cobranza-logic.util';

describe('cobranza-logic.util', () => {
  describe('telefonoArgentinoAE164', () => {
    it('normaliza celular 10 d├¡gitos', () => {
      expect(telefonoArgentinoAE164('3515551234')).toBe('543515551234');
    });

    it('retorna null si es muy corto', () => {
      expect(telefonoArgentinoAE164('123')).toBeNull();
    });
  });

  describe('anticipacionRecordatorioSegunCondicion', () => {
    it('periodico diario ÔåÆ 0 d├¡as', () => {
      expect(
        anticipacionRecordatorioSegunCondicion({
          cobroModalidad: 'periodico',
          cobroPeriodicidad: 'diaria',
        }),
      ).toBe(0);
    });
  });

  describe('debeMostrarEnCampanaCobranza', () => {
    it('muestra vencido si la fecha ya pas├│', () => {
      const res = debeMostrarEnCampanaCobranza({
        saldoPendiente: 100,
        vencimientoAt: new Date('2020-01-01T12:00:00Z'),
        recordatorioSnoozeUntil: null,
        now: new Date('2026-06-05T12:00:00Z'),
      });
      expect(res.mostrar).toBe(true);
      expect(res.estado).toBe('vencido');
    });

    it('oculta si hay snooze activo', () => {
      const res = debeMostrarEnCampanaCobranza({
        saldoPendiente: 100,
        vencimientoAt: new Date('2020-01-01T12:00:00Z'),
        recordatorioSnoozeUntil: new Date('2099-01-01T12:00:00Z'),
        now: new Date('2026-06-05T12:00:00Z'),
      });
      expect(res.mostrar).toBe(false);
    });
  });
});
