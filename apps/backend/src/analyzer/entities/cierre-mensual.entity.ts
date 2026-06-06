import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type TopProductoCierre = {
  producto_id: string;
  producto_nombre: string;
  ingresos: number;
  margen_bruto: number;
  unidades: number;
};

export type CategoriaResumenCierre = {
  categoria_id: string;
  categoria_nombre: string;
  ingresos: number;
  costos: number;
  margen_bruto: number;
  margen_pct: number;
};

@Entity({ name: 'cierre_mensual' })
export class CierreMensual {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  periodo: string;

  @Column({ name: 'ingresos_brutos', type: 'numeric', precision: 18, scale: 6, default: 0 })
  ingresosBrutos: string;

  @Column({ name: 'costo_mercaderia', type: 'numeric', precision: 18, scale: 6, default: 0 })
  costoMercaderia: string;

  @Column({ name: 'margen_bruto', type: 'numeric', precision: 18, scale: 6, default: 0 })
  margenBruto: string;

  @Column({ name: 'margen_bruto_pct', type: 'numeric', precision: 12, scale: 6, nullable: true })
  margenBrutoPct: string | null;

  @Column({ name: 'unidades_vendidas', type: 'int', default: 0 })
  unidadesVendidas: number;

  @Column({ name: 'comprobantes_emitidos', type: 'int', default: 0 })
  comprobantesEmitidos: number;

  @Column({ name: 'ticket_promedio', type: 'numeric', precision: 18, scale: 6, nullable: true })
  ticketPromedio: string | null;

  @Column({ name: 'top_productos', type: 'jsonb', nullable: true })
  topProductos: TopProductoCierre[] | null;

  @Column({ name: 'por_categoria', type: 'jsonb', nullable: true })
  porCategoria: CategoriaResumenCierre[] | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
