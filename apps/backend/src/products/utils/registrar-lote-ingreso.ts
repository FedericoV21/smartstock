import type { Repository } from 'typeorm';

import type { ProductoLoteIngreso } from '../entities/producto-lote-ingreso.entity';
import { LoteIngresoOrigen } from '../enums/lote-ingreso-origen.enum';

export type RegistrarLoteIngresoParams = {
  tenantId: string;
  productoId: string;
  sucursalId: string;
  proveedorId?: string | null;
  productoVarianteId?: string | null;
  productoVarianteEtiqueta?: string | null;
  cantidad: number;
  fechaVencimiento?: string | null;
  precioCosto?: number | null;
  origen: LoteIngresoOrigen;
  importacionLogId?: string | null;
  lectorFacturaLogId?: string | null;
  movimientoId?: string | null;
  creadoPor?: string | null;
};

/**
 * Inserta lote si aporta informaci├│n (cantidad > 0 o hay vencimiento).
 */
export async function registrarLoteIngreso(
  repo: Repository<ProductoLoteIngreso>,
  params: RegistrarLoteIngresoParams,
): Promise<{ id: string | null }> {
  const cantidad = Number(params.cantidad);
  if (!Number.isFinite(cantidad)) {
    return { id: null };
  }
  if (cantidad <= 0 && !params.fechaVencimiento) {
    return { id: null };
  }

  const entity = repo.create({
    tenantId: params.tenantId,
    productoId: params.productoId,
    sucursalId: params.sucursalId,
    proveedorId: params.proveedorId ?? null,
    productoVarianteId: params.productoVarianteId ?? null,
    productoVarianteEtiqueta: params.productoVarianteEtiqueta ?? null,
    cantidad: cantidad.toFixed(3),
    fechaVencimiento: params.fechaVencimiento ?? null,
    precioCosto:
      params.precioCosto != null && Number.isFinite(params.precioCosto)
        ? params.precioCosto.toFixed(6)
        : null,
    origen: params.origen,
    importacionLogId: params.importacionLogId ?? null,
    lectorFacturaLogId: params.lectorFacturaLogId ?? null,
    movimientoId: params.movimientoId ?? null,
    creadoPor: params.creadoPor ?? null,
  });

  const saved = await repo.save(entity);
  return { id: saved.id };
}
