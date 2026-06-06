import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'proveedor' })
export class Proveedor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'varchar', length: 13, nullable: true })
  cuit: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  telefono: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'text', nullable: true })
  direccion: string | null;

  @Column({ type: 'text', nullable: true })
  notas: string | null;

  @Column({ name: 'mapeo_excel', type: 'jsonb', nullable: true })
  mapeoExcel: Record<string, unknown> | null;

  @Column({ name: 'condicion_pago_default', type: 'text', default: 'contado' })
  condicionPagoDefault: 'contado' | 'dias';

  @Column({ name: 'plazo_pago_dias', type: 'int', nullable: true })
  plazoPagoDias: number | null;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
