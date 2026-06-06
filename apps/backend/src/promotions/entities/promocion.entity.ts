import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { PromocionTipo } from '../enums/promocion-tipo.enum';

@Entity({ name: 'promocion' })
export class Promocion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'enum', enum: PromocionTipo, enumName: 'promocion_tipo' })
  tipo: PromocionTipo;

  @Column({ name: 'cantidad_lleva', type: 'integer', nullable: true })
  cantidadLleva: number | null;

  @Column({ name: 'cantidad_paga', type: 'integer', nullable: true })
  cantidadPaga: number | null;

  @Column({ name: 'unidad_descuento', type: 'integer', nullable: true })
  unidadDescuento: number | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  porcentaje: string | null;

  @Column({ name: 'cantidad_minima', type: 'integer', nullable: true })
  cantidadMinima: number | null;

  @Column({ name: 'rangos_volumen', type: 'jsonb', nullable: true })
  rangosVolumen: unknown | null;

  @Column({ name: 'precio_combo', type: 'numeric', precision: 14, scale: 2, nullable: true })
  precioCombo: string | null;

  @Column({ name: 'vigente_desde', type: 'date', nullable: true })
  vigenteDesde: string | null;

  @Column({ name: 'vigente_hasta', type: 'date', nullable: true })
  vigenteHasta: string | null;

  @Column({ name: 'dias_semana', type: 'integer', array: true, nullable: true })
  diasSemana: number[] | null;

  @Column({ type: 'boolean', default: true })
  activa: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
