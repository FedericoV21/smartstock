export const MIME_EXCEL_LISTA = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
] as const;

export const MIME_IA_LISTA = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const MIME_TODOS_LISTA = [...MIME_EXCEL_LISTA, ...MIME_IA_LISTA] as const;

export const MAX_ARCHIVO_LISTA_BYTES = 20 * 1024 * 1024;
