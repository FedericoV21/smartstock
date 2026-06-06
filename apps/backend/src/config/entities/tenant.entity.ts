import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { CondicionIva } from '../../catalog/enums/condicion-iva.enum';
import { PlanTipo } from '../enums/plan-tipo.enum';

@Entity({ name: 'tenant' })
export class Tenant {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ name: 'razon_social', type: 'text', nullable: true })
  razonSocial: string | null;

  @Column({ type: 'varchar', length: 13, nullable: true })
  cuit: string | null;

  @Column({ type: 'text', nullable: true })
  domicilio: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  telefono: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ name: 'logo_url', type: 'text', nullable: true })
  logoUrl: string | null;

  @Column({ name: 'horarios_atencion', type: 'text', nullable: true })
  horariosAtencion: string | null;

  @Column({ name: 'codigo_acceso', type: 'text', nullable: true })
  codigoAcceso: string | null;

  @Column({ name: 'punto_de_venta', type: 'integer', nullable: true })
  puntoDeVenta: number | null;

  @Column({
    name: 'condicion_iva',
    type: 'enum',
    enum: CondicionIva,
    enumName: 'condicion_iva',
    nullable: true,
  })
  condicionIva: CondicionIva | null;

  @Column({
    type: 'enum',
    enum: PlanTipo,
    enumName: 'plan_tipo',
    default: PlanTipo.base,
  })
  plan: PlanTipo;

  @Column({ name: 'iva_porcentaje_default', type: 'numeric', precision: 5, scale: 2, default: '21' })
  ivaPorcentajeDefault: string;

  @Column({ name: 'pos_prefs', type: 'jsonb', nullable: true })
  posPrefs: Record<string, unknown> | null;

  @Column({ name: 'business_prefs', type: 'jsonb', nullable: true })
  businessPrefs: Record<string, unknown> | null;

  @Column({ name: 'ia_ilimitada_origen', type: 'text', nullable: true })
  iaIlimitadaOrigen: 'lector_factura' | 'ia_pdf' | null;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
