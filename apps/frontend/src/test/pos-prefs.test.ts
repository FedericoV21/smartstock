import { describe, expect, it } from 'vitest';

import { parseBarcode } from '@/lib/pos/barcode-parser';
import {
  effectivePosPrefsFromRows,
  finalizePosPrefsForStorage,
  normalizeBalanzaImporteTemplate,
  normalizeBalanzaTemplates,
  normalizePosPrefs,
  posPrefsSucursalDiffForStorage,
  sucursalTieneOverrideBalanza,
  tenantPermiteBalanzaPorSucursal,
} from '@/lib/pos/prefs';

describe('pos prefs - plantillas de balanza', () => {
  it('normaliza la preferencia de decenas para menores a 100', () => {
    expect(normalizePosPrefs({}).pvpRedondeoMenores100ADecenas).toBe(false);
    expect(normalizePosPrefs({ pvpRedondeoMenores100ADecenas: true }).pvpRedondeoMenores100ADecenas).toBe(true);
    expect(
      normalizePosPrefs({ pvpRedondeoMenores100ADecenas: 'si' as unknown as boolean })
        .pvpRedondeoMenores100ADecenas,
    ).toBe(false);
  });

  it('normaliza la preferencia para mostrar stock en POS', () => {
    expect(normalizePosPrefs({}).posMostrarStock).toBe(true);
    expect(normalizePosPrefs({ posMostrarStock: false }).posMostrarStock).toBe(false);
    expect(normalizePosPrefs({ posMostrarStock: 'no' as unknown as boolean }).posMostrarStock).toBe(true);
  });

  it('normaliza la preferencia para mostrar codigo de barras en POS', () => {
    expect(normalizePosPrefs({}).posMostrarCodigoBarras).toBe(false);
    expect(normalizePosPrefs({ posMostrarCodigoBarras: true }).posMostrarCodigoBarras).toBe(true);
    expect(
      normalizePosPrefs({ posMostrarCodigoBarras: 'si' as unknown as boolean })
        .posMostrarCodigoBarras,
    ).toBe(false);
  });

  it('migra balanzaTemplate legacy a balanzaTemplates', () => {
    const prefs = normalizePosPrefs({ balanzaTemplate: '20XXX00AAAAA?' });

    expect(prefs.balanzaTemplate).toBe('20XXX00AAAAA?');
    expect(prefs.balanzaTemplates).toEqual(['20XXX00AAAAA?']);
  });

  it('persiste hasta dos plantillas validas y sincroniza la primera con balanzaTemplate', () => {
    const prefs = finalizePosPrefsForStorage(
      normalizePosPrefs({
        balanzaTemplates: ['20XXX00AAAAA?', '2?XXXXXAAAAA?'],
      }),
    );

    expect(prefs.balanzaTemplate).toBe('20XXX00AAAAA?');
    expect(prefs.balanzaTemplates).toEqual(['20XXX00AAAAA?', '2?XXXXXAAAAA?']);
  });

  it('descarta plantillas invalidas al normalizar para runtime', () => {
    expect(normalizeBalanzaTemplates(['20XXX00AAAAA?', '20XX'])).toEqual(['20XXX00AAAAA?']);
  });

  it('normaliza y persiste plantilla de balanza por importe', () => {
    const prefs = finalizePosPrefsForStorage(
      normalizePosPrefs({
        balanzaImporteTemplate: ' 2XXXXX?IIIII? ',
      }),
    );

    expect(prefs.balanzaImporteTemplate).toBe('2XXXXX?IIIII?');
  });

  it('rechaza plantilla de importe sin PLU o importe', () => {
    expect(normalizeBalanzaImporteTemplate('2XXXXX??????')).toBeNull();
    expect(normalizeBalanzaImporteTemplate('2??????IIIII')).toBeNull();
    expect(normalizeBalanzaImporteTemplate('2XXXXX?AAAAA?')).toBeNull();
  });
});

describe('pos prefs - balanza por sucursal (opt-in + legacy)', () => {
  const tenantBase = {
    balanzaTemplates: ['2?XXXXXAAAAA?'],
    balanzaConfigPorSucursal: false,
  };

  it('default: opt-in desactivado y sin override legacy usa plantillas del tenant', () => {
    const effective = effectivePosPrefsFromRows(tenantBase, {
      sonidos: false,
      balanzaTemplates: ['2?XXXXXAAAAA?'],
    });

    expect(effective.balanzaTemplates).toEqual(['2?XXXXXAAAAA?']);
    expect(effective.sonidos).toBe(false);
    expect(tenantPermiteBalanzaPorSucursal(tenantBase)).toBe(false);
  });

  it('detecta override legacy de plantillas aunque el flag siga en false', () => {
    const sucursalPrefs = finalizePosPrefsForStorage(
      normalizePosPrefs({
        ...tenantBase,
        balanzaTemplates: ['20XXX00AAAAA?'],
      }),
    );

    expect(sucursalTieneOverrideBalanza(normalizePosPrefs(tenantBase), sucursalPrefs)).toBe(true);

    const effective = effectivePosPrefsFromRows(tenantBase, sucursalPrefs);
    expect(effective.balanzaTemplates).toEqual(['20XXX00AAAAA?']);
  });

  it('con opt-in activo aplica plantillas de sucursal normalmente', () => {
    const tenant = { ...tenantBase, balanzaConfigPorSucursal: true };
    const effective = effectivePosPrefsFromRows(tenant, {
      balanzaTemplates: ['20XXX00AAAAA?'],
    });

    expect(effective.balanzaTemplates).toEqual(['20XXX00AAAAA?']);
    expect(tenantPermiteBalanzaPorSucursal(tenant)).toBe(true);
  });

  it('persiste diff con importe null para sucursal solo peso cuando el negocio tiene importe', () => {
    const tenant = finalizePosPrefsForStorage(
      normalizePosPrefs({
        balanzaConfigPorSucursal: true,
        balanzaImporteTemplate: '2XXXXX?IIIII?',
      }),
    );
    const sucursalSoloPeso = finalizePosPrefsForStorage(
      normalizePosPrefs({
        ...tenant,
        balanzaImporteTemplate: null,
        balanzaTemplates: [],
      }),
    );

    const diff = posPrefsSucursalDiffForStorage(tenant, sucursalSoloPeso);

    expect(diff).not.toBeNull();
    expect(diff?.balanzaImporteTemplate).toBeNull();
    expect(diff?.balanzaTemplates).toEqual([]);

    const effective = effectivePosPrefsFromRows(tenant, diff);
    expect(effective.balanzaImporteTemplate).toBeNull();
    expect(effective.balanzaTemplates).toEqual([]);
  });

  it('persiste diff con plantilla de importe para sucursal solo importe', () => {
    const tenant = finalizePosPrefsForStorage(
      normalizePosPrefs({
        balanzaConfigPorSucursal: true,
        balanzaTemplates: [],
        balanzaImporteTemplate: null,
      }),
    );
    const sucursalSoloImporte = finalizePosPrefsForStorage(
      normalizePosPrefs({
        ...tenant,
        balanzaTemplates: [],
        balanzaImporteTemplate: '2XXXXX?IIIII?',
      }),
    );

    const diff = posPrefsSucursalDiffForStorage(tenant, sucursalSoloImporte);

    expect(diff?.balanzaImporteTemplate).toBe('2XXXXX?IIIII?');
    expect(diff?.balanzaTemplates).toEqual([]);

    const effective = effectivePosPrefsFromRows(tenant, diff);
    expect(effective.balanzaImporteTemplate).toBe('2XXXXX?IIIII?');
  });

  it('aplica balanza con opt-in solo si sucursal tiene claves de balanza en JSON', () => {
    const tenant = finalizePosPrefsForStorage(
      normalizePosPrefs({
        balanzaConfigPorSucursal: true,
        balanzaTemplates: ['2?XXXXXAAAAA?'],
      }),
    );
    const sinClaves = effectivePosPrefsFromRows(tenant, { sonidos: false });
    expect(sinClaves.balanzaTemplates).toEqual(['2?XXXXXAAAAA?']);

    const conPlantilla = effectivePosPrefsFromRows(tenant, { balanzaTemplates: ['2XXXXX0AAAAA?'] });
    expect(conPlantilla.balanzaTemplates).toEqual(['2XXXXX0AAAAA?']);
  });

  it('con opt-in aplica plantilla de sucursal aunque el diff solo traiga balanzaTemplates', () => {
    const tenant = finalizePosPrefsForStorage(
      normalizePosPrefs({
        balanzaConfigPorSucursal: true,
        balanzaTemplates: [],
        balanzaImporteTemplate: '2XXXXX?IIIII?',
      }),
    );
    const sucursalDb = { balanzaTemplates: ['2XXXXX0AAAAA?'], balanzaImporteTemplate: null };
    const effective = effectivePosPrefsFromRows(tenant, sucursalDb);

    expect(effective.balanzaTemplates).toEqual(['2XXXXX0AAAAA?']);
    expect(effective.balanzaImporteTemplate).toBeNull();

    const parsed = parseBarcode('2001680002556', {
      templates: normalizeBalanzaTemplates(effective.balanzaTemplates),
      importeTemplate: effective.balanzaImporteTemplate,
    });
    expect(parsed.tipo).toBe('balanza_peso');
    expect(parsed.codigoLookup).toBe('00168');
    expect(parsed.pesoKg).toBeCloseTo(0.256);
  });

  it('sin opt-in ignora balanza en sucursal si solo cambia sonidos (sin override de plantillas)', () => {
    const tenant = finalizePosPrefsForStorage(
      normalizePosPrefs({
        balanzaConfigPorSucursal: false,
        balanzaTemplates: ['2?XXXXXAAAAA?'],
      }),
    );
    const effective = effectivePosPrefsFromRows(tenant, { sonidos: false });

    expect(effective.balanzaTemplates).toEqual(['2?XXXXXAAAAA?']);
    expect(effective.sonidos).toBe(false);
  });
});
