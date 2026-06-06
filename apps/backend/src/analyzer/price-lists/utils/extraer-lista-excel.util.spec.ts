import * as XLSX from 'xlsx';

import { extraerItemsExcel } from './extraer-lista-excel.util';

describe('extraerItemsExcel', () => {
  it('extrae filas con columnas nombre y precio', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Codigo', 'Nombre', 'Precio'],
      ['A1', 'Producto demo', '1.500,00'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

    const items = extraerItemsExcel(buffer, 'lista.xlsx');
    expect(items).toHaveLength(1);
    expect(items[0]?.codigo_proveedor).toBe('A1');
    expect(items[0]?.nombre_raw).toBe('Producto demo');
    expect(items[0]?.precio_lista).toBe(1500);
  });
});
