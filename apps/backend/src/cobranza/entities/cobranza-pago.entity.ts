import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'cobranza_pago' })
export class CobranzaPago {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'cobranza_factura_id', type: 'uuid' })
  cobranzaFacturaId: string;

  @Column({ type: 'numeric', precision: 18, scale: 6 })
  monto: string;

  @Column({ name: 'tipo_pago', type: 'varchar', length: 32 })
  tipoPago: string;

  @Column({ type: 'date' })
  fecha: string;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ type: 'text', nullable: true })
  notas: string | null;

  @Column({ name: 'recibo_comprobante_id', type: 'uuid', nullable: true })
  reciboComprobanteId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
