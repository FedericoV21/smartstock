import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'mp_transferencia_verificacion' })
export class MpTransferenciaVerificacion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ name: 'comprobante_id', type: 'uuid' })
  comprobanteId: string;

  @Column({ name: 'movimiento_id', type: 'uuid', nullable: true })
  movimientoId: string | null;

  @Column({ name: 'mp_movimiento_id', type: 'text' })
  mpMovimientoId: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  monto: string;

  @Column({ name: 'fecha_operacion', type: 'date' })
  fechaOperacion: string;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ type: 'text', default: 'reservado' })
  estado: 'reservado' | 'verificado' | 'error';

  @Column({ name: 'verificado_at', type: 'timestamptz', nullable: true })
  verificadoAt: Date | null;

  @Column({ name: 'ultimo_error', type: 'text', nullable: true })
  ultimoError: string | null;

  @Column({ type: 'jsonb', default: {} })
  raw: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
