import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { TipoPago } from '../enums/tipo-pago.enum';

@Entity({ name: 'pago_proveedor_movimiento' })
export class PagoProveedorMovimiento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'pago_proveedor_factura_id', type: 'uuid' })
  pagoProveedorFacturaId: string;

  @Column({ type: 'numeric', precision: 18, scale: 6 })
  monto: string;

  @Column({ name: 'tipo_pago', type: 'enum', enum: TipoPago, enumName: 'tipo_pago', default: TipoPago.efectivo })
  tipoPago: TipoPago;

  @Column({ type: 'date' })
  fecha: string;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ type: 'text', nullable: true })
  notas: string | null;

  @Column({ name: 'recibo_comprobante_id', type: 'uuid', nullable: true })
  reciboComprobanteId: string | null;

  @Column({ name: 'pago_cuenta_corriente_id', type: 'uuid', nullable: true })
  pagoCuentaCorrienteId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
