import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ImportacionBorrador } from './importacion-borrador.entity';

@Entity({ name: 'importacion_borrador_chunk' })
export class ImportacionBorradorChunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'borrador_id', type: 'uuid' })
  borradorId: string;

  @Column({ name: 'chunk_index', type: 'int' })
  chunkIndex: number;

  @Column({ name: 'row_count', type: 'int', default: 0 })
  rowCount: number;

  @Column({ type: 'jsonb', default: [] })
  filas: Array<Record<string, string | number | null>>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => ImportacionBorrador, (borrador) => borrador.chunks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'borrador_id' })
  borrador?: ImportacionBorrador;
}
