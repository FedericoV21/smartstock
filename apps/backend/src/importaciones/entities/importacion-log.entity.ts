import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'importacion_log' })
export class ImportacionLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'proveedor_id', type: 'uuid', nullable: true })
  proveedorId: string | null;

  @Column({ name: 'sucursal_id', type: 'uuid', nullable: true })
  sucursalId: string | null;

  @Column({ name: 'carga_id', type: 'uuid', nullable: true })
  cargaId: string | null;

  @Column({ name: 'archivo_nombre', type: 'text' })
  archivoNombre: string;

  @Column({ name: 'archivo_storage_path', type: 'text', nullable: true })
  archivoStoragePath: string | null;

  @Column({ name: 'archivo_mime', type: 'text', nullable: true })
  archivoMime: string | null;

  @Column({ name: 'archivo_tamano', type: 'bigint', nullable: true })
  archivoTamano: string | null;

  @Column({ type: 'enum', enumName: 'origen_precio' })
  origen: string;

  @Column({ type: 'text', default: 'aplicada' })
  estado: string;

  @Column({ name: 'total_filas', type: 'int', default: 0 })
  totalFilas: number;

  @Column({ name: 'filas_exitosas', type: 'int', default: 0 })
  filasExitosas: number;

  @Column({ name: 'filas_con_error', type: 'int', default: 0 })
  filasConError: number;

  @Column({ name: 'productos_creados', type: 'int', default: 0 })
  productosCreados: number;

  @Column({ name: 'productos_actualizados', type: 'int', default: 0 })
  productosActualizados: number;

  @Column({ name: 'detalle_errores', type: 'jsonb', nullable: true })
  detalleErrores: unknown;

  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @Column({ name: 'revertida_at', type: 'timestamptz', nullable: true })
  revertidaAt: Date | null;

  @Column({ name: 'revertida_por', type: 'uuid', nullable: true })
  revertidaPor: string | null;

  @Column({ name: 'motivo_reversion', type: 'text', nullable: true })
  motivoReversion: string | null;

  @Column({ name: 'resumen_reversion', type: 'jsonb', nullable: true })
  resumenReversion: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
