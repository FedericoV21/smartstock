import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ImportacionBorradorArchivo } from './importacion-borrador-archivo.entity';
import { ImportacionBorradorChunk } from './importacion-borrador-chunk.entity';

@Entity({ name: 'importacion_borrador' })
export class ImportacionBorrador {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ name: 'proveedor_id', type: 'uuid', nullable: true })
  proveedorId: string | null;

  @Column({ name: 'sucursal_id', type: 'uuid', nullable: true })
  sucursalId: string | null;

  @Column({ type: 'text' })
  flujo: string;

  @Column({ type: 'text' })
  paso: string;

  @Column({ type: 'enum', enumName: 'origen_precio' })
  origen: string;

  @Column({ type: 'text', default: 'activo' })
  estado: string;

  @Column({ name: 'archivo_nombre', type: 'text' })
  archivoNombre: string;

  @Column({ name: 'archivo_mime', type: 'text', nullable: true })
  archivoMime: string | null;

  @Column({ name: 'archivo_tamano', type: 'bigint', nullable: true })
  archivoTamano: string | null;

  @Column({ name: 'total_filas', type: 'int', default: 0 })
  totalFilas: number;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => ImportacionBorradorChunk, (chunk) => chunk.borrador)
  chunks?: ImportacionBorradorChunk[];

  @OneToOne(() => ImportacionBorradorArchivo, (archivo) => archivo.borrador)
  archivo?: ImportacionBorradorArchivo | null;
}
