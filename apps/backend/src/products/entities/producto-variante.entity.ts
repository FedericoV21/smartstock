import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'producto_variante' })
export class ProductoVariante {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'producto_id', type: 'uuid' })
  productoId: string;

  @Column({ type: 'text', nullable: true })
  codigo: string | null;

  @Column({ name: 'codigo_barras', type: 'varchar', length: 64, nullable: true })
  codigoBarras: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  atributos: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  etiqueta: string | null;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @Column({ type: 'integer', default: 0 })
  orden: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
