import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'caja_gasto' })
export class CajaGasto {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ name: 'caja_id', type: 'text' })
  cajaId: string;

  @Column({ name: 'caja_apertura_id', type: 'uuid' })
  cajaAperturaId: string;

  @Column({ type: 'text' })
  concepto: string;

  @Column({ type: 'numeric', precision: 18, scale: 6 })
  monto: string;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ name: 'cierre_z_id', type: 'uuid', nullable: true })
  cierreZId: string | null;

  @Column({ name: 'anulado_at', type: 'timestamptz', nullable: true })
  anuladoAt: Date | null;

  @Column({ name: 'anulado_por', type: 'uuid', nullable: true })
  anuladoPor: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
