import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { EstadoListaPrecios } from '../enums/estado-lista-precios.enum';

@Entity({ name: 'lista_precios' })
export class ListaPrecios {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'sucursal_id', type: 'uuid', nullable: true })
  sucursalId: string | null;

  @Column({ name: 'proveedor_id', type: 'uuid' })
  proveedorId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({
    type: 'enum',
    enum: EstadoListaPrecios,
    enumName: 'estado_lista_precios',
    default: EstadoListaPrecios.Pendiente,
  })
  estado: EstadoListaPrecios;

  @Column({
    name: 'descuento_proveedor_pct_carga',
    type: 'numeric',
    precision: 8,
    scale: 4,
    default: 0,
  })
  descuentoProveedorPctCarga: string;

  @Column({ name: 'archivo_url', type: 'text', nullable: true })
  archivoUrl: string | null;

  @Column({ name: 'total_items', type: 'int', default: 0 })
  totalItems: number;

  @Column({ name: 'items_matcheados', type: 'int', default: 0 })
  itemsMatcheados: number;

  @Column({ name: 'variacion_promedio_pct', type: 'numeric', precision: 12, scale: 4, nullable: true })
  variacionPromedioPct: string | null;

  @Column({ name: 'items_con_aumento', type: 'int', default: 0 })
  itemsConAumento: number;

  @Column({ name: 'margen_global_anterior_pct', type: 'numeric', precision: 12, scale: 4, nullable: true })
  margenGlobalAnteriorPct: string | null;

  @Column({ name: 'margen_global_nuevo_pct', type: 'numeric', precision: 12, scale: 4, nullable: true })
  margenGlobalNuevoPct: string | null;

  @Column({ name: 'aplicada_at', type: 'timestamptz', nullable: true })
  aplicadaAt: Date | null;

  @Column({ name: 'resumen_ia', type: 'jsonb', nullable: true })
  resumenIa: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
