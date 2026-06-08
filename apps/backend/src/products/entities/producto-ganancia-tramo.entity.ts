import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'producto_ganancia_tramo' })
export class ProductoGananciaTramo {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'producto_id', type: 'uuid' })
  productoId: string;

  @Column({ name: 'cantidad_desde', type: 'numeric', precision: 12, scale: 3 })
  cantidadDesde: string;

  @Column({ name: 'ganancia_pct', type: 'numeric', precision: 6, scale: 2 })
  gananciaPct: string;

  @Column({ type: 'integer', default: 0 })
  orden: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
