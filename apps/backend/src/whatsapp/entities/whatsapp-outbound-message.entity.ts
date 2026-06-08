import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'whatsapp_outbound_message' })
export class WhatsappOutboundMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'to_wa_id', type: 'text' })
  toWaId: string;

  @Column({ name: 'phone_number_id', type: 'text', nullable: true })
  phoneNumberId: string | null;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'text', default: 'queued' })
  status: string;

  @Column({ name: 'related_job_id', type: 'uuid', nullable: true })
  relatedJobId: string | null;

  @Column({ name: 'external_message_id', type: 'text', nullable: true })
  externalMessageId: string | null;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'last_error_at', type: 'timestamptz', nullable: true })
  lastErrorAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;
}
