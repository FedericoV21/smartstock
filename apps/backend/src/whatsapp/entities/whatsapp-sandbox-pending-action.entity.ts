import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Usuario } from '../../users/entities/usuario.entity';
import { WhatsappActor } from './whatsapp-actor.entity';

@Entity({ name: 'whatsapp_sandbox_pending_action' })
export class WhatsappSandboxPendingAction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @Column({ name: 'actor_id', type: 'uuid' })
  actorId: string;

  @Column({ name: 'from_wa_id', type: 'text' })
  fromWaId: string;

  @Column({ name: 'action_type', type: 'text' })
  actionType: string;

  @Column({ type: 'text', default: 'pending_confirmation' })
  status: string;

  @Column({ name: 'action_signature', type: 'text' })
  actionSignature: string;

  @Column({ name: 'confirmation_token', type: 'text' })
  confirmationToken: string;

  @Column({ name: 'confirmation_expires_at', type: 'timestamptz' })
  confirmationExpiresAt: Date;

  @Column({ name: 'action_payload', type: 'jsonb', default: () => "'{}'" })
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

  @ManyToOne(() => WhatsappActor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'actor_id' })
  actor?: WhatsappActor;

  @ManyToOne(() => Usuario, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'usuario_id' })
  usuario?: Usuario;
}
