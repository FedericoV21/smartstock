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
import { WhatsappActorTrustLevel } from '../enums/whatsapp-actor-trust-level.enum';

@Entity({ name: 'whatsapp_actor' })
export class WhatsappActor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @Column({ name: 'from_wa_id', type: 'text' })
  fromWaId: string;

  @Column({ name: 'rol_whatsapp', type: 'text', default: 'operador' })
  rolWhatsapp: string;

  @Column({
    name: 'trust_level',
    type: 'enum',
    enum: WhatsappActorTrustLevel,
    enumName: 'whatsapp_actor_trust_level',
    default: WhatsappActorTrustLevel.unverified,
  })
  trustLevel: WhatsappActorTrustLevel;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @Column({ name: 'replaced_by_actor_id', type: 'uuid', nullable: true })
  replacedByActorId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => Usuario, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'usuario_id' })
  usuario?: Usuario;
}
