export type ItemExtraidoLista = {
  orden: number;
  codigo_proveedor: string | null;
  nombre_raw: string;
  nombre_normalizado: string;
  precio_lista: number;
  unidad: string | null;
  presentacion_inferida: null;
};

export type ResultadoExtraccionLista = {
  items: ItemExtraidoLista[];
  storage_path: string | null;
  nombre_archivo: string;
  mime_type: string;
  origen: 'importacion_excel' | 'ia_pdf';
  ia_usada: boolean;
  descuento_proveedor_default: number;
};
