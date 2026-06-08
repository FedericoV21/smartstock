/**
 * Validación entre `proveedor.mapeo_excel` y los encabezados del archivo actual.
 * Las coincidencias usan igualdad exacta de string (mismo criterio que `aplicarPerfilProveedor`).
 */

export type ProveedorPerfilExcel = {
  mapeo?: Record<string, string | null>;
  columnas_ignoradas?: string[];
};

export type FaltaColumnaPerfil = { campo: string; headerEsperado: string };

export type AnalisisCompatibilidadPerfilImport = {
  compatible: boolean;
  faltantes: FaltaColumnaPerfil[];
  /** Encabezados del archivo que no estaban guardados en el perfil (ni mapeados ni marcados como ignorados). */
  columnasNuevasEnArchivo: string[];
};

const ETIQUETA_CAMPO: Record<string, string> = {
  codigo: 'Código',
  nombre: 'Nombre / Descripción',
  precio_costo: 'Precio de costo',
  precio_venta: 'Precio de venta',
  stock_actual: 'Stock actual',
  stock_minimo: 'Stock mínimo',
  categoria: 'Categoría',
  proveedor: 'Proveedor',
  fecha_vencimiento: 'Fecha de vencimiento',
  unidad: 'Unidad de medida',
  rubro: 'Rubro',
  subrubro: 'Subrubro',
  iva_porcentaje: 'IVA %',
  porcentaje_ganancia: 'Ganancia %',
  descuento_costo_pct: 'Descuento costo %',
  ubicacion: 'Ubicación',
  moneda: 'Moneda',
  codigo_barras: 'Código de barras',
};

export function etiquetaCampoImportador(campo: string): string {
  return ETIQUETA_CAMPO[campo] ?? campo;
}

export function analizarCompatibilidadPerfilImport(
  headersArchivo: string[],
  perfil: ProveedorPerfilExcel | null | undefined,
): AnalisisCompatibilidadPerfilImport {
  const mapeo = perfil?.mapeo;
  if (!mapeo || typeof mapeo !== 'object') {
    return { compatible: true, faltantes: [], columnasNuevasEnArchivo: [] };
  }

  const setArchivo = new Set(headersArchivo);
  const faltantes: FaltaColumnaPerfil[] = [];

  for (const [campo, headerGuardado] of Object.entries(mapeo)) {
    if (headerGuardado == null) continue;
    const esperado = String(headerGuardado);
    if (!esperado.trim()) continue;
    if (!setArchivo.has(esperado)) {
      faltantes.push({ campo, headerEsperado: esperado });
    }
  }

  const conocidos = new Set<string>();
  for (const v of Object.values(mapeo)) {
    if (v != null && String(v).trim()) conocidos.add(String(v));
  }
  for (const ign of perfil.columnas_ignoradas ?? []) {
    const s = String(ign ?? '');
    if (s.trim()) conocidos.add(s);
  }

  const columnasNuevasEnArchivo = headersArchivo.filter((h) => !conocidos.has(h));

  return {
    compatible: faltantes.length === 0,
    faltantes,
    columnasNuevasEnArchivo,
  };
}

/** True si el perfil tiene al menos una columna Excel asignada a un campo (no sirve un objeto vacío o solo valores nulos). */
export function perfilTieneMapeoDeColumnas(
  perfil: ProveedorPerfilExcel | null | undefined,
): boolean {
  const m = perfil?.mapeo;
  if (!m || typeof m !== 'object') return false;
  return Object.values(m).some((v) => v != null && String(v).trim() !== '');
}
