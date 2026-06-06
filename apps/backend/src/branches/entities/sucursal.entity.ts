import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'sucursal' })
export class Sucursal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  codigo: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  direccion: string | null;

  @Column({ type: 'boolean', default: true })
  activa: boolean;

  @Column({ name: 'es_principal', type: 'boolean', default: false })
  esPrincipal: boolean;

  @Column({ name: 'hereda_datos_ticket', type: 'boolean', default: true })
  heredaDatosTicket: boolean;

  @Column({ name: 'razon_social', type: 'text', nullable: true })
  razonSocial: string | null;

  @Column({ type: 'text', nullable: true })
  cuit: string | null;

  @Column({ type: 'text', nullable: true })
  telefono: string | null;

  @Column({ name: 'horarios_atencion', type: 'text', nullable: true })
  horariosAtencion: string | null;

  @Column({ type: 'text', nullable: true })
  email: string | null;

  @Column({ name: 'pos_prefs', type: 'jsonb', nullable: true })
  posPrefs: Record<string, unknown> | null;

  @Column({ name: 'business_prefs', type: 'jsonb', nullable: true })
  businessPrefs: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
