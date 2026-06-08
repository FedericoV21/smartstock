import type { Repository } from 'typeorm';

import { PrecioSucursal } from '../../branches/entities/precio-sucursal.entity';

export async function upsertPrecioSucursalDespiece(
  precioRepo: Repository<PrecioSucursal>,
  params: {
    tenantId: string;
    productoId: string;
    sucursalId: string | null | undefined;
    precioCosto: number;
    precioVenta: number;
  },
): Promise<void> {
  if (!params.sucursalId) return;

  let row = await precioRepo.findOne({
    where: {
      tenantId: params.tenantId,
      productoId: params.productoId,
      sucursalId: params.sucursalId,
    },
  });

  if (!row) {
    row = precioRepo.create({
      tenantId: params.tenantId,
      productoId: params.productoId,
      sucursalId: params.sucursalId,
    });
  }

  row.precioCosto = params.precioCosto.toFixed(2);
  row.precioVenta = params.precioVenta.toFixed(2);
  row.porcentajeGanancia = null;
  await precioRepo.save(row);
}
