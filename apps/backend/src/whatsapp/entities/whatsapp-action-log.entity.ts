import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { WhatsappActionStatus } from '../enums/whatsapp-action-status.enum';

@Entity({ name: 'whatsapp_action_log' })
export class WhatsappActionLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'actor_id', type: 'uuid' })
  actorId: string;

  @Column({ name: 'inbound_message_id', type: 'uuid', nullable: true })
  inboundMessageId: string | null;

  @Column({ name: 'from_wa_id', type: 'text' })
  fromWaId: string;

  @Column({ name: 'action_type', type: 'text' })
  actionType: string;

  @Column({
    name: 'action_status',
    type: 'enum',
    enum: WhatsappActionStatus,
    enumName: 'whatsapp_action_status',
    default: WhatsappActionStatus.pending_confirmation,
  })
  actionStatus: WhatsappActionStatus;

  @Column({ name: 'action_signature', type: 'text' })
  actionSignature: string;

  @Column({ name: 'confirmation_token', type: 'text', nullable: true })
  confirmationToken: string | null;

  @Column({ name: 'confirmation_expires_at', type: 'timestamptz', nullable: true })
  confirmationExpiresAt: Date | null;

  @Column({ name: 'action_payload', type: 'jsonb' })
  actionPayload: Record<string, unknown>;

  @Column({ name: 'result_payload', type: 'jsonb', nullable: true })
  resultPayload: Record<string, unknown> | null;

  @Column({ name: 'error_detail', type: 'text', nullable: true })
  errorDetail: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @Column({ name: 'executed_at', type: 'timestamptz', nullable: true })
  executedAt: Date | null;
}
