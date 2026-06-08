import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'pasarela_transaccion' })
export class PasarelaTransaccion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ name: 'caja_id', type: 'uuid', nullable: true })
  cajaId: string | null;

  @Column({ name: 'integracion_id', type: 'uuid', nullable: true })
  integracionId: string | null;

  @Column({ name: 'comprobante_id', type: 'uuid', nullable: true })
  comprobanteId: string | null;

  @Column({ type: 'text' })
  proveedor: string;

  @Column({ type: 'text' })
  canal: 'qr' | 'terminal';

  @Column({ type: 'text' })
  tipo: string;

  @Column({ type: 'text', default: 'creada' })
  estado: string;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  monto: string;

  @Column({ type: 'text', default: 'ARS' })
  moneda: string;

  @Column({ name: 'external_reference', type: 'text', nullable: true })
  externalReference: string | null;

  @Column({ name: 'external_intent_id', type: 'text', nullable: true })
  externalIntentId: string | null;

  @Column({ name: 'external_order_id', type: 'text', nullable: true })
  externalOrderId: string | null;

  @Column({ name: 'external_payment_id', type: 'text', nullable: true })
  externalPaymentId: string | null;

  @Column({ name: 'idempotency_key', type: 'text', nullable: true })
  idempotencyKey: string | null;

  @Column({ name: 'request_payload', type: 'jsonb', nullable: true })
  requestPayload: Record<string, unknown> | null;

  @Column({ name: 'response_payload', type: 'jsonb', nullable: true })
  responsePayload: Record<string, unknown> | null;

  @Column({ name: 'ultimo_error', type: 'text', nullable: true })
  ultimoError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
