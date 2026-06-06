import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'importacion_producto_snapshot' })
export class ImportacionProductoSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'importacion_log_id', type: 'uuid' })
  importacionLogId: string;

  @Column({ name: 'producto_id', type: 'uuid' })
  productoId: string;

  @Column({ type: 'text' })
  accion: 'created' | 'updated';

  @Column({ name: 'fila_original', type: 'int', nullable: true })
  filaOriginal: number | null;

  @Column({ name: 'producto_before', type: 'jsonb', nullable: true })
  productoBefore: Record<string, unknown> | null;

  @Column({ name: 'producto_after', type: 'jsonb' })
  productoAfter: Record<string, unknown>;

  @Column({ name: 'precio_sucursal_before', type: 'jsonb', nullable: true })
  precioSucursalBefore: unknown;

  @Column({ name: 'precio_sucursal_after', type: 'jsonb', nullable: true })
  precioSucursalAfter: unknown;

  @Column({ name: 'movimiento_id', type: 'uuid', nullable: true })
  movimientoId: string | null;

  @Column({ name: 'producto_variante_id', type: 'uuid', nullable: true })
  productoVarianteId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
