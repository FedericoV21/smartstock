import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'caja_turno' })
export class CajaTurno {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'caja_id', type: 'uuid' })
  cajaId: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @Column({ type: 'text' })
  estado: 'abierto' | 'cerrado';

  @Column({ name: 'abierto_at', type: 'timestamptz' })
  abiertoAt: Date;

  @Column({ name: 'cerrado_at', type: 'timestamptz', nullable: true })
  cerradoAt: Date | null;

  @Column({ name: 'monto_inicial', type: 'numeric', precision: 12, scale: 2, default: '0' })
  montoInicial: string;

  @Column({ name: 'cierre_z_id', type: 'uuid', nullable: true })
  cierreZId: string | null;

  @Column({ type: 'text', nullable: true })
  notas: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
