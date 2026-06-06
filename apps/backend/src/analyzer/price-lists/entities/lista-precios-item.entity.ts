import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'lista_precios_item' })
export class ListaPreciosItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'lista_id', type: 'uuid' })
  listaId: string;

  @Column({ name: 'codigo_proveedor', type: 'text', nullable: true })
  codigoProveedor: string | null;

  @Column({ name: 'nombre_proveedor', type: 'text' })
  nombreProveedor: string;

  @Column({ name: 'nombre_normalizado', type: 'text', nullable: true })
  nombreNormalizado: string | null;

  @Column({ name: 'precio_lista', type: 'numeric', precision: 18, scale: 6 })
  precioLista: string;

  @Column({ name: 'precio_neto', type: 'numeric', precision: 18, scale: 6, nullable: true })
  precioNeto: string | null;

  @Column({ name: 'producto_id', type: 'uuid', nullable: true })
  productoId: string | null;

  @Column({ name: 'precio_costo_actual', type: 'numeric', precision: 18, scale: 6, nullable: true })
  precioCostoActual: string | null;

  @Column({ name: 'variacion_pct', type: 'numeric', precision: 12, scale: 4, nullable: true })
  variacionPct: string | null;

  @Column({ name: 'margen_actual_pct', type: 'numeric', precision: 12, scale: 4, nullable: true })
  margenActualPct: string | null;

  @Column({ name: 'margen_nuevo_pct', type: 'numeric', precision: 12, scale: 4, nullable: true })
  margenNuevoPct: string | null;

  @Column({ name: 'precio_venta_sugerido', type: 'numeric', precision: 18, scale: 6, nullable: true })
  precioVentaSugerido: string | null;

  @Column({ name: 'precio_venta_decidido', type: 'numeric', precision: 18, scale: 6, nullable: true })
  precioVentaDecidido: string | null;

  @Column({ name: 'seleccionado', type: 'boolean', default: true })
  seleccionado: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
