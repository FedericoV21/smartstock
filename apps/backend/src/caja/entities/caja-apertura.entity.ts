import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'caja_apertura' })
export class CajaApertura {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ name: 'caja_id', type: 'text', default: '__sin_caja__' })
  cajaId: string;

  @Column({ name: 'fecha_operativa', type: 'date' })
  fechaOperativa: string;

  @Column({ name: 'opened_at', type: 'timestamptz' })
  openedAt: Date;

  @Column({ name: 'fondo_efectivo', type: 'numeric', precision: 18, scale: 6 })
  fondoEfectivo: string;

  @Column({ type: 'text', nullable: true })
  notas: string | null;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
