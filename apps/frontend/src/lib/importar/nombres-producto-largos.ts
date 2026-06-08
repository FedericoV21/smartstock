import type { FilaValidada } from '@/lib/normalizador/validar';
import {
  mensajeErrorNombreProductoMuyLargo,
  nombreProductoExcedeMaximo,
} from '@/lib/productos/nombre-producto';

export function filasConNombreProductoExcesivo(filas: FilaValidada[]): FilaValidada[] {
  return filas.filter((f) => {
    const nombre = String(f.datos.nombre ?? '').trim();
    return nombre.length > 0 && nombreProductoExcedeMaximo(nombre);
  });
}

export function mensajeBloqueoImportacionNombresLargos(filas: FilaValidada[]): string {
  const n = filas.length;
  const ejemplos = filas
    .slice(0, 5)
    .map((f) => {
      const nombre = String(f.datos.nombre ?? '').trim();
      const preview =
        nombre.length > 60 ? `${nombre.slice(0, 57)}…` : nombre;
      return `Fila ${f.filaOriginal}: ${preview} (${nombre.length} caracteres)`;
    })
    .join('\n');
  const mas = n > 5 ? `\n…y ${n - 5} fila(s) más.` : '';
  const primera = filas[0];
  const hint = primera
    ? mensajeErrorNombreProductoMuyLargo(String(primera.datos.nombre ?? '').trim().length)
    : '';
  return `${n} fila(s) tienen un nombre demasiado largo (máximo permitido: ver detalle abajo).\n\n${ejemplos}${mas}\n\n${hint}`;
}
