import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { WhatsappInboundMessage } from './whatsapp-inbound-message.entity';

@Entity({ name: 'whatsapp_inbound_attachment' })
export class WhatsappInboundAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'inbound_message_id', type: 'uuid' })
  inboundMessageId: string;

  @Column({ name: 'wa_media_id', type: 'text', nullable: true })
  waMediaId: string | null;

  @Column({ name: 'mime_type', type: 'text', nullable: true })
  mimeType: string | null;

  @Column({ type: 'text', nullable: true })
  filename: string | null;

  @Column({ type: 'text' })
  sha256: string;

  @Column({ name: 'raw_payload', type: 'jsonb', nullable: true })
  rawPayload: Record<string, unknown> | null;

  @Column({ name: 'storage_bucket', type: 'text', nullable: true })
  storageBucket: string | null;

  @Column({ name: 'storage_path', type: 'text', nullable: true })
  storagePath: string | null;

  @Column({ name: 'archivo_tamano', type: 'bigint', nullable: true })
  archivoTamano: string | null;

  @Column({ name: 'download_status', type: 'text', default: 'pending' })
  downloadStatus: string;

  @Column({ name: 'downloaded_at', type: 'timestamptz', nullable: true })
  downloadedAt: Date | null;

  @Column({ name: 'download_error', type: 'text', nullable: true })
  downloadError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => WhatsappInboundMessage, (m) => m.attachments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inbound_message_id' })
  inboundMessage?: WhatsappInboundMessage;
}
