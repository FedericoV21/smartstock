import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'cierre_z' })
export class CierreZ {
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

  @Column({ name: 'caja_apertura_id', type: 'uuid', nullable: true })
  cajaAperturaId: string | null;

  @Column({ name: 'tipo_cierre', type: 'text', default: 'diario' })
  tipoCierre: 'diario' | 'parcial';

  @Column({ name: 'rango_desde', type: 'timestamptz' })
  rangoDesde: Date;

  @Column({ name: 'rango_hasta', type: 'timestamptz' })
  rangoHasta: Date;

  @Column({ name: 'total_comprobantes', type: 'integer', default: 0 })
  totalComprobantes: number;

  @Column({ name: 'ventas_brutas', type: 'numeric', precision: 18, scale: 6, default: '0' })
  ventasBrutas: string;

  @Column({ name: 'notas_credito_total', type: 'numeric', precision: 18, scale: 6, default: '0' })
  notasCreditoTotal: string;

  @Column({ name: 'ventas_netas', type: 'numeric', precision: 18, scale: 6, default: '0' })
  ventasNetas: string;

  @Column({ name: 'pagos_cta_cte_total', type: 'numeric', precision: 18, scale: 6, default: '0' })
  pagosCtaCteTotal: string;

  @Column({ name: 'usuario_cierre_id', type: 'uuid', nullable: true })
  usuarioCierreId: string | null;

  @Column({ name: 'payload_resumen', type: 'jsonb', default: {} })
  payloadResumen: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
