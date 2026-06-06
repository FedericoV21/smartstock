import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'importacion_archivo' })
export class ImportacionArchivo {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'carga_id', type: 'uuid' })
  cargaId: string;

  @Column({ name: 'archivo_nombre', type: 'text' })
  archivoNombre: string;

  @Column({ name: 'archivo_mime', type: 'text', nullable: true })
  archivoMime: string | null;

  @Column({ name: 'archivo_bytes', type: 'bytea' })
  archivoBytes: Buffer;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
