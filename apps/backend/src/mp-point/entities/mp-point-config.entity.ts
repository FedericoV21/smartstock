import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'mp_point_config' })
export class MpPointConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ name: 'access_token', type: 'text', nullable: true })
  accessToken: string | null;

  @Column({ name: 'device_id', type: 'text', nullable: true })
  deviceId: string | null;

  @Column({ name: 'webhook_secret', type: 'text', nullable: true })
  webhookSecret: string | null;

  @Column({ type: 'boolean', default: true })
  habilitado: boolean;

  @Column({ name: 'last_payment_intent_id', type: 'text', nullable: true })
  lastPaymentIntentId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
