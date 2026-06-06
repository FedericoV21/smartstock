import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'factura_importada_aplicacion' })
export class FacturaImportadaAplicacion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'comprobante_id', type: 'uuid' })
  comprobanteId: string;

  @Column({ type: 'text' })
  origen: 'lector' | 'manual';

  @Column({ name: 'afecta_stock', type: 'boolean', default: true })
  afectaStock: boolean;

  @Column({ name: 'afecta_cuenta_corriente', type: 'boolean', default: true })
  afectaCuentaCorriente: boolean;

  @Column({ type: 'numeric', precision: 18, scale: 6, default: '0' })
  subtotal: string;

  @Column({ name: 'iva_monto', type: 'numeric', precision: 18, scale: 6, default: '0' })
  ivaMonto: string;

  @Column({ type: 'numeric', precision: 18, scale: 6, default: '0' })
  total: string;

  @Column({ name: 'cuenta_corriente_delta', type: 'numeric', precision: 18, scale: 6, default: '0' })
  cuentaCorrienteDelta: string;

  @Column({ type: 'text', default: 'aplicada' })
  estado: 'aplicada' | 'revertida';

  @Column({ name: 'revertida_at', type: 'timestamptz', nullable: true })
  revertidaAt: Date | null;

  @Column({ name: 'revertida_por', type: 'uuid', nullable: true })
  revertidaPor: string | null;

  @Column({ name: 'motivo_reversion', type: 'text', nullable: true })
  motivoReversion: string | null;

  @Column({ name: 'resumen_reversion', type: 'jsonb', nullable: true })
  resumenReversion: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
