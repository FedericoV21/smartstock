import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ImportacionBorrador } from './importacion-borrador.entity';

@Entity({ name: 'importacion_borrador_archivo' })
export class ImportacionBorradorArchivo {
  @PrimaryColumn({ name: 'borrador_id', type: 'uuid' })
  borradorId: string;

  @Column({ name: 'archivo_nombre', type: 'text' })
  archivoNombre: string;

  @Column({ name: 'archivo_mime', type: 'text', nullable: true })
  archivoMime: string | null;

  @Column({ name: 'archivo_tamano', type: 'bigint', default: 0 })
  archivoTamano: string;

  @Column({ name: 'archivo_bytes', type: 'bytea' })
  archivoBytes: Buffer;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => ImportacionBorrador, (borrador) => borrador.archivo, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'borrador_id' })
  borrador?: ImportacionBorrador;
}
