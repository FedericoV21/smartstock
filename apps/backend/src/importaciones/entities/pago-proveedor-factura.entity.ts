import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'pago_proveedor_factura' })
export class PagoProveedorFactura {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'comprobante_id', type: 'uuid', nullable: true })
  comprobanteId: string | null;

  @Column({ name: 'proveedor_id', type: 'uuid' })
  proveedorId: string;

  @Column({ name: 'monto_original', type: 'numeric', precision: 18, scale: 6 })
  montoOriginal: string;

  @Column({ name: 'saldo_pendiente', type: 'numeric', precision: 18, scale: 6 })
  saldoPendiente: string;

  @Column({ name: 'vencimiento_at', type: 'timestamptz' })
  vencimientoAt: Date;

  @Column({ name: 'condicion_pago', type: 'text' })
  condicionPago: string;

  @Column({ type: 'text', default: 'pendiente' })
  estado: string;

  @Column({ type: 'text', default: 'comprobante' })
  origen: string;

  @Column({ type: 'text', nullable: true })
  referencia: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
