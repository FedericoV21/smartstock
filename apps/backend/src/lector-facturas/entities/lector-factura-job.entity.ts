import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Comprobante } from '../../facturacion/entities/comprobante.entity';
import { WhatsappProcessingJob } from '../../whatsapp/entities/whatsapp-processing-job.entity';
import { ApiIntegracionKey } from './api-integracion-key.entity';
import { LectorFacturaLog } from './lector-factura-log.entity';

@Entity({ name: 'lector_factura_job' })
export class LectorFacturaJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'sucursal_id', type: 'uuid', nullable: true })
  sucursalId: string | null;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ name: 'api_key_id', type: 'uuid', nullable: true })
  apiKeyId: string | null;

  @Column({ name: 'whatsapp_processing_job_id', type: 'uuid', nullable: true })
  whatsappProcessingJobId: string | null;

  @Column({ type: 'text', default: 'api_publica' })
  source: string;

  @Column({ type: 'text', default: 'queued' })
  status: string;

  @Column({ name: 'external_id', type: 'text', nullable: true })
  externalId: string | null;

  @Column({ name: 'idempotency_key', type: 'text', nullable: true })
  idempotencyKey: string | null;

  @Column({ name: 'callback_url', type: 'text', nullable: true })
  callbackUrl: string | null;

  @Column({ name: 'callback_status', type: 'text', nullable: true })
  callbackStatus: string | null;

  @Column({ name: 'callback_error', type: 'text', nullable: true })
  callbackError: string | null;

  @Column({ name: 'callback_sent_at', type: 'timestamptz', nullable: true })
  callbackSentAt: Date | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  archivos: unknown[];

  @Column({ name: 'lector_factura_log_id', type: 'uuid', nullable: true })
  lectorFacturaLogId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  resultado: Record<string, unknown> | null;

  @Column({ name: 'error_code', type: 'text', nullable: true })
  errorCode: string | null;

  @Column({ name: 'error_detail', type: 'text', nullable: true })
  errorDetail: string | null;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount: number;

  @Column({ name: 'application_status', type: 'text', default: 'pending' })
  applicationStatus: string;

  @Column({ name: 'impacto_preview', type: 'jsonb', nullable: true })
  impactoPreview: Record<string, unknown> | null;

  @Column({ name: 'impact_hash', type: 'text', nullable: true })
  impactHash: string | null;

  @Column({ name: 'confirm_payload', type: 'jsonb', nullable: true })
  confirmPayload: Record<string, unknown> | null;

  @Column({ name: 'applied_comprobante_id', type: 'uuid', nullable: true })
  appliedComprobanteId: string | null;

  @Column({ name: 'applied_at', type: 'timestamptz', nullable: true })
  appliedAt: Date | null;

  @Column({ name: 'applied_error', type: 'text', nullable: true })
  appliedError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => ApiIntegracionKey, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'api_key_id' })
  apiKey?: ApiIntegracionKey | null;

  @ManyToOne(() => WhatsappProcessingJob, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'whatsapp_processing_job_id' })
  whatsappProcessingJob?: WhatsappProcessingJob | null;

  @ManyToOne(() => LectorFacturaLog, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'lector_factura_log_id' })
  lectorFacturaLog?: LectorFacturaLog | null;

  @ManyToOne(() => Comprobante, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'applied_comprobante_id' })
  appliedComprobante?: Comprobante | null;
}
