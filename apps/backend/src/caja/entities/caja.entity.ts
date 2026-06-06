import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'caja' })
export class Caja {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ type: 'integer' })
  numero: number;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ name: 'usuario_default_id', type: 'uuid', nullable: true })
  usuarioDefaultId: string | null;

  @Column({ type: 'boolean', default: true })
  activa: boolean;

  @Column({ name: 'auto_cierre_horas', type: 'integer', nullable: true })
  autoCierreHoras: number | null;

  @Column({ type: 'jsonb', default: {} })
  prefs: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
