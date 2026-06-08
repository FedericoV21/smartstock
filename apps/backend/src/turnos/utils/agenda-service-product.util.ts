import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { UnidadMedida } from '../../products/enums/unidad-medida.enum';
import { Producto } from '../../products/entities/producto.entity';

function agendaProductName(nombre: string): string {
  const n = nombre.trim() || 'Agenda';
  return `Turno - ${n}`.slice(0, 200);
}

export async function ensureAgendaServiceProduct(
  productoRepo: Repository<Producto>,
  opts: {
    tenantId: string;
    sucursalId: string;
    agendaId: string;
    productoId?: string | null;
    nombre: string;
    precio: number;
    ivaPorcentaje?: number | null;
  },
): Promise<string> {
  const precio = Number.isFinite(opts.precio) && opts.precio >= 0 ? Math.round(opts.precio * 100) / 100 : 0;
  const iva = opts.ivaPorcentaje ?? 21;

  if (opts.productoId) {
    const updated = await productoRepo.update(
      { id: opts.productoId, tenantId: opts.tenantId },
      {
        sucursalId: opts.sucursalId,
        codigo: `TURNO-${opts.agendaId.slice(0, 8).toUpperCase()}`,
        nombre: agendaProductName(opts.nombre),
        descripcion: 'Servicio interno generado por el modulo de turnos',
        unidad: UnidadMedida.unidad,
        precioCosto: '0',
        precioVenta: precio.toFixed(2),
        stockActual: '0',
        stockMinimo: '0',
        ivaPorcentaje: iva.toFixed(2),
        porcentajeGanancia: '0',
        activo: true,
        esServicio: true,
      },
    );
    if (updated.affected) {
      return opts.productoId;
    }
  }

  const producto = productoRepo.create({
    tenantId: opts.tenantId,
    sucursalId: opts.sucursalId,
    codigo: `TURNO-${opts.agendaId.slice(0, 8).toUpperCase()}`,
    nombre: agendaProductName(opts.nombre),
    descripcion: 'Servicio interno generado por el modulo de turnos',
    unidad: UnidadMedida.unidad,
    precioCosto: '0',
    precioVenta: precio.toFixed(2),
    stockActual: '0',
    stockMinimo: '0',
    ivaPorcentaje: iva.toFixed(2),
    porcentajeGanancia: '0',
    activo: true,
    esServicio: true,
  });
  const saved = await productoRepo.save(producto);
  if (!saved?.id) {
    throw new BadRequestException('No se pudo crear el servicio de la agenda');
  }
  return saved.id;
}
