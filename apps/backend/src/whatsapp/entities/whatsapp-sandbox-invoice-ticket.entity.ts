import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { LectorFacturaJob } from '../../lector-facturas/entities/lector-factura-job.entity';
import { Usuario } from '../../users/entities/usuario.entity';
import { WhatsappActionLog } from './whatsapp-action-log.entity';
import { WhatsappActor } from './whatsapp-actor.entity';

@Entity({ name: 'whatsapp_sandbox_invoice_ticket' })
export class WhatsappSandboxInvoiceTicket {
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

  @Column({ name: 'lector_factura_job_id', type: 'uuid' })
  lectorFacturaJobId: string;

  @Column({ name: 'action_log_id', type: 'uuid', nullable: true })
  actionLogId: string | null;

  @Column({ type: 'text', default: 'needs_review' })
  status: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  summary: Record<string, unknown>;

  @Column({ name: 'pending_items', type: 'jsonb', default: () => "'[]'" })
  pendingItems: unknown[];

  @Column({ name: 'chat_state', type: 'jsonb', default: () => "'{}'" })
  chatState: Record<string, unknown>;

  @Column({ name: 'impact_hash', type: 'text', nullable: true })
  impactHash: string | null;

  @Column({ name: 'error_detail', type: 'text', nullable: true })
  errorDetail: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ name: 'applied_at', type: 'timestamptz', nullable: true })
  appliedAt: Date | null;

  @ManyToOne(() => WhatsappActor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'actor_id' })
  actor?: WhatsappActor;

  @ManyToOne(() => Usuario, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'usuario_id' })
  usuario?: Usuario;

  @ManyToOne(() => LectorFacturaJob, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lector_factura_job_id' })
  lectorFacturaJob?: LectorFacturaJob;

  @ManyToOne(() => WhatsappActionLog, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'action_log_id' })
  actionLog?: WhatsappActionLog | null;
}
