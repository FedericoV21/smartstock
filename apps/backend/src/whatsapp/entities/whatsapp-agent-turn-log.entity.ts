import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { Usuario } from '../../users/entities/usuario.entity';
import { WhatsappActor } from './whatsapp-actor.entity';

@Entity({ name: 'whatsapp_agent_turn_log' })
export class WhatsappAgentTurnLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ name: 'inbound_message_id', type: 'uuid', nullable: true })
  inboundMessageId: string | null;

  @Column({ name: 'action_log_id', type: 'uuid', nullable: true })
  actionLogId: string | null;

  @Column({ name: 'from_wa_id', type: 'text', nullable: true })
  fromWaId: string | null;

  @Column({ type: 'text' })
  channel: string;

  @Column({ type: 'text' })
  source: string;

  @Column({ name: 'input_body', type: 'text' })
  inputBody: string;

  @Column({ name: 'resolved_message', type: 'text', nullable: true })
  resolvedMessage: string | null;

  @Column({ name: 'reply_body', type: 'text', nullable: true })
  replyBody: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  replies: unknown;

  @Column({ type: 'text', nullable: true })
  intent: string | null;

  @Column({ type: 'numeric', nullable: true })
  confidence: string | null;

  @Column({ name: 'fallback_reason', type: 'text', nullable: true })
  fallbackReason: string | null;

  @Column({ type: 'text' })
  status: string;

  @Column({ name: 'tool_name', type: 'text', nullable: true })
  toolName: string | null;

  @Column({ name: 'tool_args', type: 'jsonb', nullable: true })
  toolArgs: Record<string, unknown> | null;

  @Column({ name: 'tool_result', type: 'jsonb', nullable: true })
  toolResult: Record<string, unknown> | null;

  @Column({ name: 'tool_trace', type: 'jsonb', nullable: true })
  toolTrace: Record<string, unknown> | null;

  @Column({ name: 'processing_trace', type: 'jsonb', default: () => "'{}'::jsonb" })
  processingTrace: Record<string, unknown>;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  @Column({ name: 'error_detail', type: 'text', nullable: true })
  errorDetail: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @ManyToOne(() => WhatsappActor, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actor_id' })
  actor?: WhatsappActor | null;

  @ManyToOne(() => Usuario, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'usuario_id' })
  usuario?: Usuario | null;
}
