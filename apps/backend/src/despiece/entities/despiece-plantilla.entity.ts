import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { DespieceCorte } from './despiece-corte.entity';

@Entity({ name: 'despiece_plantilla' })
export class DespiecePlantilla {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ name: 'producto_padre_id', type: 'uuid', nullable: true })
  productoPadreId: string | null;

  @Column({ name: 'peso_total_kg', type: 'numeric', precision: 10, scale: 3 })
  pesoTotalKg: string;

  @Column({ name: 'unidad_base_tipo', type: 'text', default: 'kg' })
  unidadBaseTipo: string;

  @Column({ name: 'unidad_base_nombre', type: 'text', nullable: true })
  unidadBaseNombre: string | null;

  @Column({ name: 'unidad_base_cantidad', type: 'numeric', precision: 10, scale: 3, default: '1' })
  unidadBaseCantidad: string;

  @Column({ name: 'unidad_contenedor_nombre', type: 'text', nullable: true })
  unidadContenedorNombre: string | null;

  @Column({ name: 'unidad_contenedor_cantidad', type: 'numeric', precision: 10, scale: 3, nullable: true })
  unidadContenedorCantidad: string | null;

  @Column({ name: 'rentabilidad_objetivo_pct', type: 'numeric', precision: 6, scale: 2, nullable: true })
  rentabilidadObjetivoPct: string | null;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @Column({ type: 'text', nullable: true })
  notas: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => DespieceCorte, (corte) => corte.plantilla)
  cortes?: DespieceCorte[];
}
