import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { UnidadMedida } from '../enums/unidad-medida.enum';

@Entity({ name: 'producto' })
export class Producto {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 64 })
  codigo: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  @Column({ name: 'categoria_id', type: 'uuid', nullable: true })
  categoriaId: string | null;

  @Column({ name: 'proveedor_id', type: 'uuid', nullable: true })
  proveedorId: string | null;

  @Column({ name: 'sucursal_id', type: 'uuid', nullable: true })
  sucursalId: string | null;

  @Column({
    type: 'enum',
    enum: UnidadMedida,
    enumName: 'unidad_medida',
  })
  unidad: UnidadMedida;

  @Column({ name: 'precio_costo', type: 'numeric', precision: 14, scale: 2 })
  precioCosto: string;

  @Column({ name: 'precio_venta', type: 'numeric', precision: 14, scale: 2 })
  precioVenta: string;

  @Column({ name: 'iva_porcentaje', type: 'numeric', precision: 5, scale: 2, nullable: true })
  ivaPorcentaje: string | null;

  @Column({ name: 'porcentaje_ganancia', type: 'numeric', precision: 5, scale: 2, nullable: true })
  porcentajeGanancia: string | null;

  @Column({ name: 'descuento_costo_pct', type: 'numeric', precision: 5, scale: 2, nullable: true })
  descuentoCostoPct: string | null;

  @Column({ name: 'stock_actual', type: 'numeric', precision: 12, scale: 3 })
  stockActual: string;

  @Column({ name: 'stock_minimo', type: 'numeric', precision: 12, scale: 3 })
  stockMinimo: string;

  @Column({ name: 'codigo_barras', type: 'varchar', length: 14, nullable: true })
  codigoBarras: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  plu: string | null;

  @Column({ name: 'es_pesable', type: 'boolean', default: false })
  esPesable: boolean;

  @Column({ name: 'es_despiece_padre', type: 'boolean', default: false })
  esDespiecePadre: boolean;

  @Column({ name: 'es_servicio', type: 'boolean', default: false })
  esServicio: boolean;

  @Column({ name: 'fecha_vencimiento', type: 'date', nullable: true })
  fechaVencimiento: string | null;

  @Column({ name: 'imagen_url', type: 'text', nullable: true })
  imagenUrl: string | null;

  @Column({ name: 'usa_variantes', type: 'boolean', default: false })
  usaVariantes: boolean;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
