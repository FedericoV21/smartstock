import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { CobroModalidad } from '../../cuenta-corriente/enums/cobro-modalidad.enum';
import { CobroPeriodicidad } from '../../cuenta-corriente/enums/cobro-periodicidad.enum';

@Entity({ name: 'cuenta_corriente' })
export class CuentaCorriente {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'cliente_id', type: 'uuid', nullable: true })
  clienteId: string | null;

  @Column({ name: 'proveedor_id', type: 'uuid', nullable: true })
  proveedorId: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 6, default: 0 })
  saldo: string;

  @Column({ name: 'limite_credito', type: 'numeric', precision: 18, scale: 6, nullable: true })
  limiteCredito: string | null;

  @Column({ name: 'tipo_cuenta', type: 'enum', enumName: 'tipo_cuenta_corriente', default: 'cliente' })
  tipoCuenta: string;

  @Column({
    name: 'cobro_modalidad',
    type: 'enum',
    enum: CobroModalidad,
    enumName: 'cobro_modalidad',
    default: CobroModalidad.por_comprobante,
  })
  cobroModalidad: CobroModalidad;

  @Column({ name: 'cobro_dias_plazo', type: 'int', default: 7 })
  cobroDiasPlazo: number;

  @Column({
    name: 'cobro_periodicidad',
    type: 'enum',
    enum: CobroPeriodicidad,
    enumName: 'cobro_periodicidad',
    nullable: true,
  })
  cobroPeriodicidad: CobroPeriodicidad | null;

  @Column({ name: 'cobro_dia_vencimiento_mes', type: 'int', nullable: true })
  cobroDiaVencimientoMes: number | null;

  @Column({ name: 'cobro_monto_minimo', type: 'numeric', precision: 18, scale: 6, default: 0 })
  cobroMontoMinimo: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
