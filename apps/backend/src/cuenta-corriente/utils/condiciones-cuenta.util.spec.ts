import {
  applyCondicionesCuentaPatch,
  CUENTA_CORRIENTE_CONDICIONES_DEFAULTS,
} from './condiciones-cuenta.util';
import { CobroModalidad } from '../enums/cobro-modalidad.enum';
import { CobroPeriodicidad } from '../enums/cobro-periodicidad.enum';

describe('applyCondicionesCuentaPatch', () => {
  it('valida modalidad periodica con periodicidad', () => {
    const res = applyCondicionesCuentaPatch(CUENTA_CORRIENTE_CONDICIONES_DEFAULTS, {
      cobro_modalidad: CobroModalidad.periodico,
      cobro_periodicidad: CobroPeriodicidad.mensual,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.cobro_modalidad).toBe(CobroModalidad.periodico);
      expect(res.state.cobro_periodicidad).toBe(CobroPeriodicidad.mensual);
    }
  });

  it('rechaza periodico sin periodicidad', () => {
    const res = applyCondicionesCuentaPatch(CUENTA_CORRIENTE_CONDICIONES_DEFAULTS, {
      cobro_modalidad: CobroModalidad.periodico,
    });
    expect(res.ok).toBe(false);
  });
});
