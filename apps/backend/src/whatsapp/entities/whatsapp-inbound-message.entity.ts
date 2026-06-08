import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { WhatsappInboundAttachment } from './whatsapp-inbound-attachment.entity';
import { WhatsappProcessingJob } from './whatsapp-processing-job.entity';

@Entity({ name: 'whatsapp_inbound_message' })
export class WhatsappInboundMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  wamid: string;

  @Column({ name: 'from_wa_id', type: 'text' })
  fromWaId: string;

  @Column({ name: 'to_phone_number_id', type: 'text', nullable: true })
  toPhoneNumberId: string | null;

  @Column({ name: 'message_type', type: 'text' })
  messageType: string;

  @Column({ name: 'text_body', type: 'text', nullable: true })
  textBody: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ name: 'raw_payload', type: 'jsonb' })
  rawPayload: Record<string, unknown>;

  @Column({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => WhatsappInboundAttachment, (a) => a.inboundMessage)
  attachments?: WhatsappInboundAttachment[];

  @OneToMany(() => WhatsappProcessingJob, (j) => j.inboundMessage)
  jobs?: WhatsappProcessingJob[];
}
