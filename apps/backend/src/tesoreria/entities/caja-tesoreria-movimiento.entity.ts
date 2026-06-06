import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { CajaTesoreriaMovimientoTipo } from '../enums/caja-tesoreria-movimiento-tipo.enum';

@Entity({ name: 'caja_tesoreria_movimiento' })
export class CajaTesoreriaMovimiento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'caja_tesoreria_id', type: 'uuid' })
  cajaTesoreriaId: string;

  @Column({
    type: 'enum',
    enum: CajaTesoreriaMovimientoTipo,
    enumName: 'caja_tesoreria_movimiento_tipo',
  })
  tipo: CajaTesoreriaMovimientoTipo;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  monto: string;

  @Column({ name: 'es_ingreso', type: 'boolean' })
  esIngreso: boolean;

  @Column({ name: 'cierre_z_id', type: 'uuid', nullable: true })
  cierreZId: string | null;

  @Column({ name: 'caja_id', type: 'uuid', nullable: true })
  cajaId: string | null;

  @Column({ name: 'pago_id', type: 'uuid', nullable: true })
  pagoId: string | null;

  @Column({ name: 'cheque_id', type: 'uuid', nullable: true })
  chequeId: string | null;

  @Column({ name: 'proveedor_id', type: 'uuid', nullable: true })
  proveedorId: string | null;

  @Column({ type: 'text', nullable: true })
  notas: string | null;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ type: 'date' })
  fecha: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
