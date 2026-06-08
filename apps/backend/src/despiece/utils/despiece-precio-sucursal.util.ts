import type { Repository } from 'typeorm';

import { PrecioSucursal } from '../../branches/entities/precio-sucursal.entity';
import { Sucursal } from '../../branches/entities/sucursal.entity';
import { Tenant } from '../../config/entities/tenant.entity';
import { effectivePosPrefsFromRows } from '../../config/utils/pos-prefs.util';
import { Producto } from '../../products/entities/producto.entity';
import { calcularPrecioVenta, IVA_DEFAULT_PCT } from '../../products/utils/calcular-precio-venta';

type ProductoBaseRecalculoSucursal = {
  precioCosto: string;
  ivaPorcentaje: string | null;
  descuentoCostoPct: string | null;
};

export async function recalcularPreciosSucursalConGanancia(params: {
  productoRepo: Repository<Producto>;
  precioRepo: Repository<PrecioSucursal>;
  tenantRepo: Repository<Tenant>;
  sucursalRepo: Repository<Sucursal>;
  tenantId: string;
  productoId: string;
  producto?: ProductoBaseRecalculoSucursal | null;
}): Promise<void> {
  const { productoRepo, precioRepo, tenantRepo, sucursalRepo, tenantId, productoId } = params;

  let producto = params.producto ?? null;
  if (!producto) {
    producto = await productoRepo.findOne({
      where: { id: productoId, tenantId },
      select: ['precioCosto', 'ivaPorcentaje', 'descuentoCostoPct'],
    });
  }
  if (!producto) return;

  const rows = await precioRepo
    .createQueryBuilder('ps')
    .where('ps.tenant_id = :tenantId', { tenantId })
    .andWhere('ps.producto_id = :productoId', { productoId })
    .andWhere('ps.porcentaje_ganancia IS NOT NULL')
    .getMany();
  if (rows.length === 0) return;

  const tenantRow = await tenantRepo.findOne({
    where: { id: tenantId },
    select: ['ivaPorcentajeDefault', 'posPrefs'],
  });
  const sucursalIds = [...new Set(rows.map((r) => r.sucursalId))];
  const sucRows =
    sucursalIds.length > 0
      ? await sucursalRepo.find({
          where: sucursalIds.map((id) => ({ id, tenantId })),
          select: ['id', 'posPrefs'],
        })
      : [];

  const ivaDefault = Number(tenantRow?.ivaPorcentajeDefault ?? 21) || 21;
  const sucPrefs = new Map(sucRows.map((s) => [s.id, s.posPrefs] as const));

  for (const row of rows) {
    const costo =
      row.precioCosto != null ? Number(row.precioCosto) : Number(producto.precioCosto ?? 0);
    const prefs = effectivePosPrefsFromRows(
      tenantRow?.posPrefs,
      sucPrefs.get(row.sucursalId) ?? null,
    );
    const precioVenta = calcularPrecioVenta(
      costo,
      row.porcentajeGanancia != null ? Number(row.porcentajeGanancia) : 0,
      producto.ivaPorcentaje != null ? Number(producto.ivaPorcentaje) : null,
      ivaDefault,
      {
        redondearPreciosCentenas: prefs.pvpRedondeoCentenasArriba,
        redondearMenores100ADecenas: prefs.pvpRedondeoMenores100ADecenas,
        descuentoCostoPct:
          producto.descuentoCostoPct != null ? Number(producto.descuentoCostoPct) : null,
      },
    );
    row.precioVenta = precioVenta.toFixed(2);
    await precioRepo.save(row);
  }
}
