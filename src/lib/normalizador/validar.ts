import { type CampoProducto } from './aliases';

export interface FilaValidada {
  filaOriginal: number;
  datos: Partial<Record<CampoProducto, string | number | null>>;
  errores: { campo: CampoProducto; mensaje: string; valorOriginal: unknown }[];
  valida: boolean;
}

type FilaRaw = Record<string, string | number | null>;
type MapeoValidacion = {
  headerOriginal: string;
  campoDetectado: CampoProducto | null;
  ignorar: boolean;
};

export function validarFila(
  fila: FilaRaw,
  index: number,
  mapeo: MapeoValidacion[]
): FilaValidada {
  const datos: Partial<Record<CampoProducto, string | number | null>> = {};
  const errores: FilaValidada['errores'] = [];

  for (const col of mapeo) {
    if (col.ignorar || !col.campoDetectado) continue;

    const valorRaw = fila[col.headerOriginal];
    const campo = col.campoDetectado;
    const vacio = valorRaw == null || String(valorRaw).trim() === '';

    if (campo !== 'nombre' && vacio) {
      continue;
    }

    switch (campo) {
      case 'codigo':
        datos[campo] = valorRaw != null ? String(valorRaw).trim() : null;
        break;

      case 'nombre':
        if (vacio) {
          continue;
        }
        datos[campo] = String(valorRaw).trim();
        break;

      case 'precio_costo':
      case 'precio_venta': {
        const precio = parsearPrecioArgentino(valorRaw);
        if (valorRaw != null && String(valorRaw).trim() !== '' && precio === null) {
          errores.push({
            campo,
            mensaje: 'El precio debe ser un número válido',
            valorOriginal: valorRaw,
          });
          datos[campo] = null;
        } else if (precio !== null && precio < 0) {
          errores.push({
            campo,
            mensaje: 'El precio no puede ser negativo',
            valorOriginal: valorRaw,
          });
          datos[campo] = null;
        } else {
          datos[campo] = precio;
        }
        break;
      }

      case 'stock_actual':
      case 'stock_minimo': {
        const num = parsearEntero(valorRaw);
        if (valorRaw != null && String(valorRaw).trim() !== '' && num === null) {
          errores.push({
            campo,
            mensaje: 'Debe ser un número entero',
            valorOriginal: valorRaw,
          });
          datos[campo] = null;
        } else if (num !== null && num < 0) {
          errores.push({
            campo,
            mensaje: 'No puede ser negativo',
            valorOriginal: valorRaw,
          });
          datos[campo] = null;
        } else {
          datos[campo] = num;
        }
        break;
      }

      case 'fecha_vencimiento': {
        if (valorRaw != null && String(valorRaw).trim() !== '') {
          const fecha = parsearFecha(String(valorRaw));
          if (!fecha) {
            errores.push({
              campo,
              mensaje: 'Formato de fecha no reconocido',
              valorOriginal: valorRaw,
            });
            datos[campo] = null;
          } else {
            datos[campo] = fecha;
          }
        } else {
          datos[campo] = null;
        }
        break;
      }

      case 'categoria':
      case 'proveedor':
      case 'unidad':
      case 'codigo_barras':
      case 'rubro':
      case 'subrubro':
      case 'ubicacion':
      case 'moneda':
        datos[campo] = valorRaw != null ? String(valorRaw).trim() : null;
        break;

      case 'iva_porcentaje':
      case 'porcentaje_ganancia': {
        const pct = parsearPrecioArgentino(valorRaw);
        if (valorRaw != null && String(valorRaw).trim() !== '' && pct === null) {
          errores.push({
            campo,
            mensaje: 'Debe ser un número válido',
            valorOriginal: valorRaw,
          });
          datos[campo] = null;
        } else if (pct !== null && pct < 0) {
          errores.push({
            campo,
            mensaje: 'No puede ser negativo',
            valorOriginal: valorRaw,
          });
          datos[campo] = null;
        } else {
          datos[campo] = pct;
        }
        break;
      }
    }
  }

  if (!datos.nombre || String(datos.nombre).trim() === '') {
    errores.push({
      campo: 'nombre',
      mensaje: 'El nombre del producto no puede estar vacío',
      valorOriginal: null,
    });
    datos.nombre = null;
  }

  return {
    filaOriginal: index + 1,
    datos,
    errores,
    valida: errores.length === 0,
  };
}

export function validarFilas(
  filas: FilaRaw[],
  mapeo: MapeoValidacion[]
): FilaValidada[] {
  return filas.map((fila, index) => validarFila(fila, index, mapeo));
}

/**
 * Montos con separadores locales habituales en listas:
 * - AR: $1.234,56 o 5.200 (miles con punto)
 * - US/EN: $5,200.00 (miles con coma, decimales con punto)
 */
export function parsearPrecioArgentino(valor: unknown): number | null {
  if (valor == null || String(valor).trim() === '') return null;

  let s = String(valor).trim().replace(/[^\d.,\-]/g, '');
  if (s === '' || s === '-') return null;

  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  s = s.replace(/-/g, '');
  if (s === '') return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  let normalized: string;

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastDot > lastComma) {
      normalized = s.replace(/,/g, '');
    } else {
      normalized = s.replace(/\./g, '').replace(',', '.');
    }
  } else if (lastComma >= 0) {
    const after = s.slice(lastComma + 1);
    if (/^\d{1,2}$/.test(after)) {
      normalized = s.slice(0, lastComma).replace(/\./g, '') + '.' + after;
    } else if (/^\d{3}$/.test(after)) {
      normalized = s.replace(/,/g, '');
    } else {
      const parts = s.split(',');
      if (parts.length > 1 && parts.every((p) => /^\d+$/.test(p))) {
        normalized = parts.join('');
      } else {
        normalized = s.slice(0, lastComma).replace(/\./g, '') + '.' + after;
      }
    }
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    if (!parts.every((p) => /^\d+$/.test(p)) || parts.length < 2) {
      normalized = s;
    } else {
      const last = parts[parts.length - 1]!;
      if (last.length <= 2) {
        normalized = parts.slice(0, -1).join('') + '.' + last;
      } else if (last.length > 3) {
        normalized = parts.slice(0, -1).join('') + '.' + last;
      } else {
        normalized = parts.join('');
      }
    }
  } else {
    normalized = s;
  }

  const num = parseFloat(normalized);
  if (Number.isNaN(num)) return null;
  const rounded = Math.round(num * 100) / 100;
  return neg ? -rounded : rounded;
}

function parsearEntero(valor: unknown): number | null {
  if (valor == null || String(valor).trim() === '') return null;
  const num = parseInt(String(valor).replace(/\s/g, ''), 10);
  return Number.isNaN(num) ? null : num;
}

function parsearFecha(valor: string): string | null {
  const patrones = [
    /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/,
    /^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})$/,
  ];

  const match1 = valor.match(patrones[0]);
  if (match1) {
    const [, d, m, y] = match1;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const match2 = valor.match(patrones[1]);
  if (match2) {
    const [, y, m, d] = match2;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const parsed = new Date(valor);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return null;
}
