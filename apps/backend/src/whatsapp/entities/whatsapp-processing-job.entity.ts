import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { WhatsappBranchResolutionStatus } from '../enums/whatsapp-branch-resolution-status.enum';
import { WhatsappJobStatus } from '../enums/whatsapp-job-status.enum';
import { WhatsappInboundAttachment } from './whatsapp-inbound-attachment.entity';
import { WhatsappInboundMessage } from './whatsapp-inbound-message.entity';

@Entity({ name: 'whatsapp_processing_job' })
export class WhatsappProcessingJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'inbound_message_id', type: 'uuid' })
  inboundMessageId: string;

  @Column({ name: 'inbound_attachment_id', type: 'uuid', nullable: true })
  inboundAttachmentId: string | null;

  @Column({
    type: 'enum',
    enum: WhatsappJobStatus,
    enumName: 'whatsapp_job_status',
    default: WhatsappJobStatus.queued,
  })
  status: WhatsappJobStatus;

  @Column({ name: 'document_type', type: 'text', nullable: true })
  documentType: string | null;

  @Column({ name: 'error_code', type: 'text', nullable: true })
  errorCode: string | null;

  @Column({ name: 'error_detail', type: 'text', nullable: true })
  errorDetail: string | null;

  @Column({ name: 'from_wa_id', type: 'text', nullable: true })
  fromWaId: string | null;

  @Column({ name: 'to_phone_number_id', type: 'text', nullable: true })
  toPhoneNumberId: string | null;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @Column({
    name: 'branch_resolution_status',
    type: 'enum',
    enum: WhatsappBranchResolutionStatus,
    enumName: 'whatsapp_branch_resolution_status',
    nullable: true,
  })
  branchResolutionStatus: WhatsappBranchResolutionStatus | null;

  @Column({ name: 'branch_resolution_reason', type: 'text', nullable: true })
  branchResolutionReason: string | null;

  @Column({ name: 'branch_prompt_requested_at', type: 'timestamptz', nullable: true })
  branchPromptRequestedAt: Date | null;

  @Column({ name: 'branch_prompt_deadline_at', type: 'timestamptz', nullable: true })
  branchPromptDeadlineAt: Date | null;

  @Column({ name: 'target_entity_type', type: 'text', nullable: true })
  targetEntityType: string | null;

  @Column({ name: 'target_entity_id', type: 'uuid', nullable: true })
  targetEntityId: string | null;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount: number;

  @Column({ name: 'last_error_at', type: 'timestamptz', nullable: true })
  lastErrorAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @ManyToOne(() => WhatsappInboundMessage, (m) => m.jobs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inbound_message_id' })
  inboundMessage?: WhatsappInboundMessage;

  @ManyToOne(() => WhatsappInboundAttachment, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'inbound_attachment_id' })
  inboundAttachment?: WhatsappInboundAttachment | null;
}
