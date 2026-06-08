import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'mp_qr_webhook_log' })
export class MpQrWebhookLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId: string | null;

  @Column({ name: 'comprobante_id', type: 'uuid', nullable: true })
  comprobanteId: string | null;

  @Column({ type: 'text', nullable: true })
  topic: string | null;

  @Column({ name: 'merchant_order_id', type: 'text', nullable: true })
  merchantOrderId: string | null;

  @Column({ type: 'text', nullable: true })
  resultado: string | null;

  @Column({ name: 'payload_snippet', type: 'text', nullable: true })
  payloadSnippet: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
