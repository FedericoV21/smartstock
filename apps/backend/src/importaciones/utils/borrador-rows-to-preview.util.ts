import { UnidadMedida } from '../../products/enums/unidad-medida.enum';
import { ImportPreviewRowDto } from '../dto/import-preview-row.dto';
import {
  ImportDraftColumnMapping,
  ImportDraftRow,
  validateDraftPayload,
} from './import-draft-payload.util';

function parseArgentineNumber(raw: unknown): number | null {
  if (raw == null || String(raw).trim() === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const normalized = String(raw)
    .trim()
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(raw: unknown): number | null {
  if (raw == null || String(raw).trim() === '') return null;
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw;
  const parsed = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapCampoToPreviewField(
  campo: string,
  value: string | number | null,
): Partial<ImportPreviewRowDto> {
  const str = value != null ? String(value).trim() : '';
  switch (campo) {
    case 'codigo':
      return { codigo: str || null };
    case 'nombre':
      return { nombre: str || null };
    case 'precio_costo': {
      const n = parseArgentineNumber(value);
      return n == null ? {} : { precioCosto: n };
    }
    case 'precio_venta': {
      const n = parseArgentineNumber(value);
      return n == null ? {} : { precioVenta: n };
    }
    case 'stock_actual': {
      const n = parseInteger(value);
      return n == null ? {} : { stockActual: n };
    }
    case 'stock_minimo': {
      const n = parseInteger(value);
      return n == null ? {} : { stockMinimo: n };
    }
    case 'categoria':
      return { categoria: str || null };
    case 'fecha_vencimiento':
      return { fechaVencimiento: str || null };
    case 'unidad': {
      const unit = str.toLowerCase();
      const allowed = new Set<string>(Object.values(UnidadMedida));
      return allowed.has(unit) ? { unidad: unit as UnidadMedida } : {};
    }
    case 'codigo_barras':
      return { codigoBarras: str || null };
    default:
      return {};
  }
}

function applyMappingToRow(
  rawRow: ImportDraftRow,
  mapeo: ImportDraftColumnMapping[],
  filaOriginal: number,
): ImportPreviewRowDto | null {
  const preview: ImportPreviewRowDto = {};
  let hasNombre = false;

  for (const col of mapeo) {
    if (col.ignorar || !col.campoDetectado) continue;
    const value = rawRow[col.headerOriginal];
    const mapped = mapCampoToPreviewField(col.campoDetectado, value ?? null);
    Object.assign(preview, mapped);
    if (col.campoDetectado === 'nombre' && preview.nombre) {
      hasNombre = true;
    }
  }

  if (!hasNombre) return null;
  (preview as ImportPreviewRowDto & { filaOriginal?: number }).filaOriginal = filaOriginal;
  return preview;
}

export function draftRowsToImportPreviewRows(
  rawRows: ImportDraftRow[],
  mapeo: ImportDraftColumnMapping[],
  filasIncluidas?: ReadonlySet<number>,
  rowOffset = 0,
): ImportPreviewRowDto[] {
  const out: ImportPreviewRowDto[] = [];
  for (let i = 0; i < rawRows.length; i += 1) {
    const filaOriginal = rowOffset + i + 1;
    if (filasIncluidas && filasIncluidas.size > 0 && !filasIncluidas.has(filaOriginal)) {
      continue;
    }
    const mapped = applyMappingToRow(rawRows[i], mapeo, filaOriginal);
    if (mapped) out.push(mapped);
  }
  return out;
}

export function resolveDraftPayloadMapeo(payload: unknown): ImportDraftColumnMapping[] {
  return validateDraftPayload(payload).mapeo;
}
