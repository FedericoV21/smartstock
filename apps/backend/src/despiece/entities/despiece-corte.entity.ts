import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Producto } from '../../products/entities/producto.entity';
import { DespiecePlantilla } from './despiece-plantilla.entity';

@Entity({ name: 'despiece_corte' })
export class DespieceCorte {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'plantilla_id', type: 'uuid' })
  plantillaId: string;

  @Column({ name: 'producto_hijo_id', type: 'uuid' })
  productoHijoId: string;

  @Column({ name: 'kg_rendimiento', type: 'numeric', precision: 10, scale: 3 })
  kgRendimiento: string;

  @Column({ name: 'factor_ajuste_pct', type: 'numeric', precision: 12, scale: 10, default: '0' })
  factorAjustePct: string;

  @Column({ name: 'precio_anclado', type: 'numeric', precision: 12, scale: 2, nullable: true })
  precioAnclado: string | null;

  @Column({ name: 'nombre_en_plantilla', type: 'text', nullable: true })
  nombreEnPlantilla: string | null;

  @Column({ name: 'plu_sugerido', type: 'varchar', length: 5, nullable: true })
  pluSugerido: string | null;

  @Column({ name: 'peso_promedio_unidad_kg', type: 'numeric', precision: 10, scale: 3, nullable: true })
  pesoPromedioUnidadKg: string | null;

  @Column({ type: 'int', default: 0 })
  orden: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => DespiecePlantilla, (plantilla) => plantilla.cortes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plantilla_id' })
  plantilla?: DespiecePlantilla;

  @ManyToOne(() => Producto)
  @JoinColumn({ name: 'producto_hijo_id' })
  productoHijo?: Producto;
}
