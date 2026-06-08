import { describe, expect, it } from 'vitest';

import {
  inferirPresentacionDesdeTexto,
  inferirPresentacionPesoEnvaseDesdeTexto,
} from './inferir-presentacion-desde-texto';

describe('inferirPresentacionDesdeTexto', () => {
  it('detecta caja x 500 en unidad base', () => {
    const r = inferirPresentacionDesdeTexto('Clavo caja x 500', 'unidad');
    expect(r).not.toBeNull();
    expect(r?.contenido_unidad_compra).toBe(500);
  });

  it('caja 20kg a gramos con base gramo', () => {
    const r = inferirPresentacionDesdeTexto('Queso caja 20 kg', 'gramo');
    expect(r?.contenido_unidad_compra).toBe(20000);
  });

  it('no aplica cantidad si la base es gramo (solo peso)', () => {
    const r = inferirPresentacionDesdeTexto('Tornillo x 100', 'gramo');
    expect(r).toBeNull();
  });

  it('detecta caja(500 unidades) con paréntesis (Excel)', () => {
    const r = inferirPresentacionDesdeTexto('Caja(500 unidades)', 'unidad');
    expect(r).not.toBeNull();
    expect(r?.unidad_compra).toBe('caja');
    expect(r?.contenido_unidad_compra).toBe(500);
  });

  it('detecta pack(20 kg) y conserva unidad_compra=pack', () => {
    const r = inferirPresentacionDesdeTexto('Pack(20 kg)', 'kg');
    expect(r).not.toBeNull();
    expect(r?.unidad_compra).toBe('pack');
    expect(r?.contenido_unidad_compra).toBe(20);
  });

  it('detecta x 300 u como caja de 300 unidades', () => {
    const r = inferirPresentacionDesdeTexto('Lápiz x 300 u', 'unidad');
    expect(r).not.toBeNull();
    expect(r?.unidad_compra).toBe('caja');
    expect(r?.contenido_unidad_compra).toBe(300);
  });

  it('no interpreta presentaciones por peso como cantidad de unidades', () => {
    const r = inferirPresentacionDesdeTexto('NUEZ MARIPOSA X 100 GR (P)', 'unidad');
    expect(r).toBeNull();
  });

  it('detecta x300u compacto', () => {
    const r = inferirPresentacionDesdeTexto('Clavo x300u', 'unidad');
    expect(r).not.toBeNull();
    expect(r?.unidad_compra).toBe('caja');
    expect(r?.contenido_unidad_compra).toBe(300);
  });

  it('detecta 12x400 gr como 12 unidades por caja cuando base es unidad', () => {
    const r = inferirPresentacionDesdeTexto('DULCE DE LECHE REPO.12X400 GRS.', 'unidad');
    expect(r).not.toBeNull();
    expect(r?.unidad_compra).toBe('caja');
    expect(r?.contenido_unidad_compra).toBe(12);
  });

  it('detecta 12x400 gr como 4800 gramos cuando base es gramo', () => {
    const r = inferirPresentacionDesdeTexto('DULCE DE LECHE REPO.12X400 GRS.', 'gramo');
    expect(r).not.toBeNull();
    expect(r?.unidad_compra).toBe('caja');
    expect(r?.contenido_unidad_compra).toBe(4800);
  });
});

describe('inferirPresentacionPesoEnvaseDesdeTexto', () => {
  it('detecta x500gr como envase de 0,5 kg cuando la base es kg', () => {
    const r = inferirPresentacionPesoEnvaseDesdeTexto('Jamón cocido x500gr', 'kg');
    expect(r).not.toBeNull();
    expect(r?.contenido_unidad_compra).toBe(0.5);
    expect(r?.unidad_compra).toBe('unidad');
  });

  it('detecta x 500 gr con espacios', () => {
    const r = inferirPresentacionPesoEnvaseDesdeTexto('Queso x 500 gr', 'kg');
    expect(r?.contenido_unidad_compra).toBe(0.5);
  });

  it('convierte costo de lista: 3500 por 500 g → 7000/kg vía contenido 0,5', () => {
    const r = inferirPresentacionPesoEnvaseDesdeTexto('Producto x500gr', 'kg');
    expect(r?.contenido_unidad_compra).toBe(0.5);
    expect(3500 / (r!.contenido_unidad_compra)).toBe(7000);
  });

  it('no interpreta caja x 500 unidades como peso', () => {
    expect(inferirPresentacionPesoEnvaseDesdeTexto('Clavo caja x 500', 'kg')).toBeNull();
  });

  it('detecta x 1 kg', () => {
    const r = inferirPresentacionPesoEnvaseDesdeTexto('Fiambre x 1 kg', 'kg');
    expect(r?.contenido_unidad_compra).toBe(1);
  });
});
