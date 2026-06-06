import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { TipoPago } from '../enums/tipo-pago.enum';

@Entity({ name: 'pago' })
export class Pago {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'cliente_id', type: 'uuid', nullable: true })
  clienteId: string | null;

  @Column({ name: 'proveedor_id', type: 'uuid', nullable: true })
  proveedorId: string | null;

  @Column({ name: 'cuenta_id', type: 'uuid' })
  cuentaId: string;

  @Column({ name: 'comprobante_id', type: 'uuid', nullable: true })
  comprobanteId: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 6 })
  monto: string;

  @Column({ name: 'tipo_pago', type: 'enum', enum: TipoPago, enumName: 'tipo_pago', default: TipoPago.efectivo })
  tipoPago: TipoPago;

  @Column({ type: 'text', nullable: true })
  referencia: string | null;

  @Column({ type: 'text', nullable: true })
  notas: string | null;

  @Column({ type: 'date' })
  fecha: string;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
