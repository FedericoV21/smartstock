import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ApiExtractorKey } from './api-extractor-key.entity';

@Entity({ name: 'factura_extractor_log' })
export class FacturaExtractorLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'api_key_id', type: 'uuid', nullable: true })
  apiKeyId: string | null;

  @Column({ name: 'archivo_nombre', type: 'text', nullable: true })
  archivoNombre: string | null;

  @Column({ name: 'archivo_mime', type: 'text', nullable: true })
  archivoMime: string | null;

  @Column({ name: 'archivo_tamano', type: 'bigint', nullable: true })
  archivoTamano: string | null;

  @Column({ type: 'text' })
  estado: 'extraido' | 'error';

  @Column({ name: 'error_code', type: 'text', nullable: true })
  errorCode: string | null;

  @Column({ name: 'error_detail', type: 'text', nullable: true })
  errorDetail: string | null;

  @Column({ name: 'duracion_ms', type: 'int', nullable: true })
  duracionMs: number | null;

  @Column({ type: 'jsonb', nullable: true })
  meta: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => ApiExtractorKey, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'api_key_id' })
  apiKey?: ApiExtractorKey | null;
}
