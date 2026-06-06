import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'cobranza_factura' })
export class CobranzaFactura {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'comprobante_id', type: 'uuid' })
  comprobanteId: string;

  @Column({ name: 'cliente_id', type: 'uuid' })
  clienteId: string;

  @Column({ name: 'monto_original', type: 'numeric', precision: 18, scale: 6 })
  montoOriginal: string;

  @Column({ name: 'saldo_pendiente', type: 'numeric', precision: 18, scale: 6 })
  saldoPendiente: string;

  @Column({ name: 'vencimiento_at', type: 'timestamptz' })
  vencimientoAt: Date;

  @Column({ name: 'recordatorio_snooze_until', type: 'timestamptz', nullable: true })
  recordatorioSnoozeUntil: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
