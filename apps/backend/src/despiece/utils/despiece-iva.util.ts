import type { Repository } from 'typeorm';

import { Producto } from '../../products/entities/producto.entity';
import { IVA_DESPIECE } from './constantes';
import { recalcularPreciosSucursalConGanancia } from './despiece-precio-sucursal.util';

export async function forzarIvaDespiece(
  productoRepo: Repository<Producto>,
  precioRepo: Parameters<typeof recalcularPreciosSucursalConGanancia>[0]['precioRepo'],
  tenantRepo: Parameters<typeof recalcularPreciosSucursalConGanancia>[0]['tenantRepo'],
  sucursalRepo: Parameters<typeof recalcularPreciosSucursalConGanancia>[0]['sucursalRepo'],
  tenantId: string,
  productoIds: Array<string | null | undefined>,
  opciones: { recalcularPrecios?: boolean } = {},
): Promise<void> {
  const ids = Array.from(
    new Set(productoIds.filter((id): id is string => typeof id === 'string' && id.length > 0)),
  );
  if (ids.length === 0) return;

  await productoRepo
    .createQueryBuilder()
    .update(Producto)
    .set({ ivaPorcentaje: IVA_DESPIECE.toFixed(2) })
    .where('tenant_id = :tenantId', { tenantId })
    .andWhere('id IN (:...ids)', { ids })
    .execute();

  if (opciones.recalcularPrecios) {
    for (const id of ids) {
      await recalcularPreciosSucursalConGanancia({
        productoRepo,
        precioRepo,
        tenantRepo,
        sucursalRepo,
        tenantId,
        productoId: id,
      });
    }
  }
}
