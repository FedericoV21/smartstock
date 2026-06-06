import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { LoteIngresoOrigen } from '../enums/lote-ingreso-origen.enum';

@Entity({ name: 'producto_lote_ingreso' })
export class ProductoLoteIngreso {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'producto_id', type: 'uuid' })
  productoId: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ name: 'proveedor_id', type: 'uuid', nullable: true })
  proveedorId: string | null;

  @Column({ name: 'producto_variante_id', type: 'uuid', nullable: true })
  productoVarianteId: string | null;

  @Column({ name: 'producto_variante_etiqueta', type: 'text', nullable: true })
  productoVarianteEtiqueta: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 3 })
  cantidad: string;

  @Column({ name: 'fecha_vencimiento', type: 'date', nullable: true })
  fechaVencimiento: string | null;

  @Column({ name: 'precio_costo', type: 'numeric', precision: 18, scale: 6, nullable: true })
  precioCosto: string | null;

  @Column({ type: 'text' })
  origen: LoteIngresoOrigen;

  @Column({ name: 'importacion_log_id', type: 'uuid', nullable: true })
  importacionLogId: string | null;

  @Column({ name: 'lector_factura_log_id', type: 'uuid', nullable: true })
  lectorFacturaLogId: string | null;

  @Column({ name: 'movimiento_id', type: 'uuid', nullable: true })
  movimientoId: string | null;

  @Column({ name: 'creado_por', type: 'uuid', nullable: true })
  creadoPor: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
