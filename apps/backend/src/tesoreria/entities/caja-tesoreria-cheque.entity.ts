import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { CajaTesoreriaChequeEstado } from '../enums/caja-tesoreria-cheque-estado.enum';

@Entity({ name: 'caja_tesoreria_cheque' })
export class CajaTesoreriaCheque {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'caja_tesoreria_id', type: 'uuid' })
  cajaTesoreriaId: string;

  @Column({ type: 'text' })
  numero: string;

  @Column({ type: 'text' })
  banco: string;

  @Column({ type: 'text', nullable: true })
  titular: string | null;

  @Column({ name: 'fecha_emision', type: 'date', nullable: true })
  fechaEmision: string | null;

  @Column({ name: 'fecha_cobro', type: 'date', nullable: true })
  fechaCobro: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  monto: string;

  @Column({
    type: 'enum',
    enum: CajaTesoreriaChequeEstado,
    enumName: 'caja_tesoreria_cheque_estado',
    default: CajaTesoreriaChequeEstado.en_cartera,
  })
  estado: CajaTesoreriaChequeEstado;

  @Column({ name: 'movimiento_ingreso_id', type: 'uuid' })
  movimientoIngresoId: string;

  @Column({ name: 'movimiento_egreso_id', type: 'uuid', nullable: true })
  movimientoEgresoId: string | null;

  @Column({ name: 'pago_id', type: 'uuid', nullable: true })
  pagoId: string | null;

  @Column({ type: 'text', nullable: true })
  notas: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
