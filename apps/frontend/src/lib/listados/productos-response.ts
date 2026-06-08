export type ProductosListadoResponse = {
  productos?: unknown[];
  total_paginas?: number;
  total?: number;
  sucursal_id?: string;
  error?: string;
};

type NormalizadoOk = {
  ok: true;
  productos: unknown[];
  total_paginas: number;
  total?: number;
  sucursal_id?: string;
};

type NormalizadoError = { ok: false; error: string };

/**
 * Distingue explícitamente "error de carga" de "sin resultados".
 * Si el backend responde 200 con `productos: []`, se considera éxito vacío.
 */
export function normalizarRespuestaListadoProductos(
  statusOk: boolean,
  payload: ProductosListadoResponse | null,
): NormalizadoOk | NormalizadoError {
  if (!statusOk) {
    const msg =
      typeof payload?.error === 'string' && payload.error.trim() !== ''
        ? payload.error.trim()
        : 'No se pudo cargar el listado. Reintentá en unos segundos.';
    return { ok: false, error: msg };
  }

  if (!payload) {
    return { ok: false, error: 'Respuesta inválida del servidor al cargar el listado.' };
  }

  return {
    ok: true,
    productos: Array.isArray(payload.productos) ? payload.productos : [],
    total_paginas: Number.isFinite(payload.total_paginas) ? Number(payload.total_paginas) : 1,
    ...(typeof payload.total === 'number' ? { total: payload.total } : {}),
    ...(typeof payload.sucursal_id === 'string' ? { sucursal_id: payload.sucursal_id } : {}),
  };
}

