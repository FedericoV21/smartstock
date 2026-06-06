import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'precio_sucursal' })
export class PrecioSucursal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'producto_id', type: 'uuid' })
  productoId: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ name: 'precio_costo', type: 'numeric', precision: 12, scale: 2, nullable: true })
  precioCosto: string | null;

  @Column({ name: 'precio_venta', type: 'numeric', precision: 12, scale: 2, nullable: true })
  precioVenta: string | null;

  @Column({ name: 'porcentaje_ganancia', type: 'numeric', precision: 5, scale: 2, nullable: true })
  porcentajeGanancia: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
