import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'radar_inflacion' })
export class RadarInflacion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  rubro: string;

  @Column({ name: 'proveedor_nombre', type: 'text' })
  proveedorNombre: string;

  @Column({ type: 'text' })
  periodo: string;

  @Column({ name: 'variacion_promedio_pct', type: 'numeric', precision: 12, scale: 6, default: 0 })
  variacionPromedioPct: string;

  @Column({ name: 'cantidad_listas', type: 'int', default: 1 })
  cantidadListas: number;

  @Column({ name: 'cantidad_items', type: 'int', default: 0 })
  cantidadItems: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
