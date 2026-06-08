import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'whatsapp_platform_routing_state' })
export class WhatsappPlatformRoutingState {
  @PrimaryColumn({ name: 'from_wa_id', type: 'text' })
  fromWaId: string;

  @Column({ name: 'selected_tenant_id', type: 'uuid', nullable: true })
  selectedTenantId: string | null;

  @Column({ name: 'pending_choices', type: 'jsonb', default: () => "'[]'::jsonb" })
  pendingChoices: unknown;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
