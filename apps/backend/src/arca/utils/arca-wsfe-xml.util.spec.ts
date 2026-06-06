import { parsearCbteNroFeCompUltimoAutorizado } from './arca-wsfe-xml.util';

describe('arca-wsfe-xml.util', () => {
  it('parsearCbteNroFeCompUltimoAutorizado lee CbteNro con namespace', () => {
    const xml = `<FECompUltimoAutorizadoResult><ar:CbteNro>42</ar:CbteNro></FECompUltimoAutorizadoResult>`;
    expect(parsearCbteNroFeCompUltimoAutorizado(xml)).toBe(42);
  });

  it('parsearCbteNroFeCompUltimoAutorizado devuelve 0 sin match', () => {
    expect(parsearCbteNroFeCompUltimoAutorizado('<empty/>')).toBe(0);
  });
});
