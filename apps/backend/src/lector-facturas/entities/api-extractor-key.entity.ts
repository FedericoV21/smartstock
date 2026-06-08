import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'api_extractor_key' })
export class ApiExtractorKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ name: 'key_hash', type: 'text', unique: true })
  keyHash: string;

  @Column({ name: 'key_preview', type: 'text', nullable: true })
  keyPreview: string | null;

  @Column({ type: 'text', array: true, default: () => "ARRAY['invoice:extract']::text[]" })
  scopes: string[];

  @Column({ type: 'text', default: 'activa' })
  estado: string;

  @Column({ name: 'rate_limit_por_minuto', type: 'int', default: 10 })
  rateLimitPorMinuto: number;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
