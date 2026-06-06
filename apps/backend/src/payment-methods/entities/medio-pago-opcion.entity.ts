import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { MedioPago } from './medio-pago.entity';

@Entity({ name: 'medio_pago_opcion' })
export class MedioPagoOpcion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'medio_pago_id', type: 'uuid' })
  medioPagoId: string;

  @Column({ type: 'integer' })
  cuotas: number;

  @Column({ name: 'recargo_porcentaje', type: 'numeric', precision: 12, scale: 4 })
  recargoPorcentaje: string;

  @ManyToOne(() => MedioPago, (m) => m.opciones, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'medio_pago_id' })
  medioPago: MedioPago;
}
