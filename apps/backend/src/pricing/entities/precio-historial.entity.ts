import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { OrigenPrecio } from '../enums/origen-precio.enum';

@Entity({ name: 'precio_historial' })
export class PrecioHistorial {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'producto_id', type: 'uuid' })
  productoId: string;

  @Column({ name: 'precio_costo_anterior', type: 'numeric', precision: 18, scale: 6, nullable: true })
  precioCostoAnterior: string | null;

  @Column({ name: 'precio_costo_nuevo', type: 'numeric', precision: 18, scale: 6, nullable: true })
  precioCostoNuevo: string | null;

  @Column({ name: 'precio_venta_anterior', type: 'numeric', precision: 18, scale: 6, nullable: true })
  precioVentaAnterior: string | null;

  @Column({ name: 'precio_venta_nuevo', type: 'numeric', precision: 18, scale: 6, nullable: true })
  precioVentaNuevo: string | null;

  @Column({ name: 'margen_anterior', type: 'numeric', precision: 12, scale: 6, nullable: true })
  margenAnterior: string | null;

  @Column({ name: 'margen_nuevo', type: 'numeric', precision: 12, scale: 6, nullable: true })
  margenNuevo: string | null;

  @Column({
    type: 'enum',
    enum: OrigenPrecio,
    enumName: 'origen_precio',
  })
  origen: OrigenPrecio;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
