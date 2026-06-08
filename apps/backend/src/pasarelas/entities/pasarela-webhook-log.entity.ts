import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'pasarela_webhook_log' })
export class PasarelaWebhookLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId: string | null;

  @Column({ name: 'integracion_id', type: 'uuid', nullable: true })
  integracionId: string | null;

  @Column({ type: 'text' })
  proveedor: string;

  @Column({ name: 'webhook_public_id', type: 'uuid', nullable: true })
  webhookPublicId: string | null;

  @Column({ name: 'event_id', type: 'text', nullable: true })
  eventId: string | null;

  @Column({ type: 'text', nullable: true })
  topic: string | null;

  @Column({ name: 'payload_snippet', type: 'text', nullable: true })
  payloadSnippet: string | null;

  @Column({ type: 'jsonb', nullable: true })
  headers: Record<string, unknown> | null;

  @Column({ type: 'boolean', default: false })
  procesado: boolean;

  @Column({ type: 'text', nullable: true })
  resultado: string | null;

  @Column({ name: 'error_mensaje', type: 'text', nullable: true })
  errorMensaje: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
