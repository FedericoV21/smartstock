import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'lector_factura_log' })
export class LectorFacturaLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @Column({ name: 'archivo_url', type: 'text' })
  archivoUrl: string;

  @Column({ name: 'archivo_nombre', type: 'text' })
  archivoNombre: string;

  @Column({ name: 'archivo_mime', type: 'text' })
  archivoMime: string;

  @Column({ name: 'archivo_tamano', type: 'int' })
  archivoTamano: number;

  @Column({ name: 'gemini_raw', type: 'jsonb', nullable: true })
  geminiRaw: Record<string, unknown> | null;

  @Column({ name: 'datos_extraidos', type: 'jsonb', nullable: true })
  datosExtraidos: Record<string, unknown> | null;

  @Column({ type: 'text', default: 'desconocida' })
  direccion: string;

  @Column({ type: 'text', default: 'extraido' })
  estado: string;

  @Column({ name: 'comprobante_id', type: 'uuid', nullable: true })
  comprobanteId: string | null;

  @Column({ name: 'proveedor_id', type: 'uuid', nullable: true })
  proveedorId: string | null;

  @Column({ name: 'cliente_id', type: 'uuid', nullable: true })
  clienteId: string | null;

  @Column({ name: 'error_mensaje', type: 'text', nullable: true })
  errorMensaje: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
