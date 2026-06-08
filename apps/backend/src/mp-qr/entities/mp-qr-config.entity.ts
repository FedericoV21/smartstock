import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'mp_qr_config' })
export class MpQrConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ name: 'access_token', type: 'text', nullable: true })
  accessToken: string | null;

  @Column({ name: 'user_id', type: 'text', nullable: true })
  userId: string | null;

  @Column({ name: 'external_pos_id', type: 'text', nullable: true })
  externalPosId: string | null;

  @Column({ name: 'webhook_secret', type: 'text', nullable: true })
  webhookSecret: string | null;

  @Column({ type: 'boolean', default: false })
  habilitado: boolean;

  @Column({ name: 'transferencia_habilitada', type: 'boolean', default: false })
  transferenciaHabilitada: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
