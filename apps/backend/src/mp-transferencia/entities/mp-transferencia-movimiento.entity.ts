import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'mp_transferencia_movimiento' })
export class MpTransferenciaMovimiento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ name: 'reporte_id', type: 'uuid', nullable: true })
  reporteId: string | null;

  @Column({ name: 'mp_movimiento_id', type: 'text' })
  mpMovimientoId: string;

  @Column({ name: 'fecha_operacion', type: 'date' })
  fechaOperacion: string;

  @Column({ name: 'fecha_hora', type: 'timestamptz', nullable: true })
  fechaHora: Date | null;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  monto: string;

  @Column({ type: 'text', default: 'ARS' })
  moneda: string;

  @Column({ name: 'transaction_type', type: 'text', nullable: true })
  transactionType: string | null;

  @Column({ name: 'payment_type', type: 'text', nullable: true })
  paymentType: string | null;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  @Column({ type: 'text', nullable: true })
  contraparte: string | null;

  @Column({ type: 'jsonb', default: {} })
  raw: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
