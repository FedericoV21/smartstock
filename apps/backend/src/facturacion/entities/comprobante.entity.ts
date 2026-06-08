import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { EstadoComprobante } from '../enums/estado-comprobante.enum';
import { TipoComprobante } from '../enums/tipo-comprobante.enum';

@Entity({ name: 'comprobante' })
export class Comprobante {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'enum', enum: TipoComprobante, enumName: 'tipo_comprobante' })
  tipo: TipoComprobante;

  @Column({ type: 'integer', nullable: true })
  numero: number | null;

  @Column({ name: 'numero_orden', type: 'integer', nullable: true })
  numeroOrden: number | null;

  @Column({ type: 'date' })
  fecha: string;

  @Column({ name: 'cliente_id', type: 'uuid', nullable: true })
  clienteId: string | null;

  @Column({ name: 'sucursal_id', type: 'uuid', nullable: true })
  sucursalId: string | null;

  @Column({ name: 'tipo_operacion', type: 'text', default: 'venta' })
  tipoOperacion: 'venta' | 'compra';

  @Column({ name: 'proveedor_id', type: 'uuid', nullable: true })
  proveedorId: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  subtotal: string;

  @Column({ name: 'iva_monto', type: 'numeric', precision: 18, scale: 2, default: '0' })
  ivaMonto: string;

  @Column({ name: 'iva_porcentaje', type: 'numeric', precision: 8, scale: 2, default: '0' })
  ivaPorcentaje: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  total: string;

  @Column({ type: 'enum', enum: EstadoComprobante, enumName: 'estado_comprobante' })
  estado: EstadoComprobante;

  @Column({ name: 'metodo_pago', type: 'varchar', length: 20, nullable: true })
  metodoPago: string | null;

  @Column({ name: 'metodo_pago_detalle', type: 'jsonb', nullable: true })
  metodoPagoDetalle: Record<string, unknown> | null;

  @Column({ name: 'total_mercaderia', type: 'numeric', precision: 18, scale: 4, nullable: true })
  totalMercaderia: string | null;

  @Column({ name: 'medio_pago_opcion_id', type: 'uuid', nullable: true })
  medioPagoOpcionId: string | null;

  @Column({ name: 'financiacion_monto', type: 'numeric', precision: 18, scale: 4, nullable: true })
  financiacionMonto: string | null;

  @Column({ name: 'financiacion_porcentaje', type: 'numeric', precision: 12, scale: 4, nullable: true })
  financiacionPorcentaje: string | null;

  @Column({ name: 'financiacion_descripcion', type: 'text', nullable: true })
  financiacionDescripcion: string | null;

  @Column({ name: 'caja_id', type: 'varchar', length: 20, nullable: true })
  cajaId: string | null;

  @Column({ name: 'caja_uuid', type: 'uuid', nullable: true })
  cajaUuid: string | null;

  @Column({ name: 'caja_turno_id', type: 'uuid', nullable: true })
  cajaTurnoId: string | null;

  @Column({ name: 'numero_caja', type: 'integer', nullable: true })
  numeroCaja: number | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  cae: string | null;

  @Column({ name: 'cae_vencimiento', type: 'date', nullable: true })
  caeVencimiento: string | null;

  @Column({ name: 'pdf_url', type: 'text', nullable: true })
  pdfUrl: string | null;

  @Column({ type: 'text', nullable: true })
  notas: string | null;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ name: 'motivo_anulacion', type: 'text', nullable: true })
  motivoAnulacion: string | null;

  @Column({ name: 'anulado_at', type: 'timestamptz', nullable: true })
  anuladoAt: Date | null;

  @Column({ name: 'anulado_por', type: 'uuid', nullable: true })
  anuladoPor: string | null;

  @Column({ name: 'intentos_arca', type: 'integer', default: 0 })
  intentosArca: number;

  @Column({ name: 'ultimo_error_arca_codigo', type: 'varchar', length: 20, nullable: true })
  ultimoErrorArcaCodigo: string | null;

  @Column({ name: 'ultimo_error_arca_mensaje', type: 'text', nullable: true })
  ultimoErrorArcaMensaje: string | null;

  @Column({ name: 'ultimo_intento_arca_at', type: 'timestamptz', nullable: true })
  ultimoIntentoArcaAt: Date | null;

  @Column({ name: 'mp_point_intent_id', type: 'text', nullable: true })
  mpPointIntentId: string | null;

  @Column({ name: 'mp_point_payment_id', type: 'bigint', nullable: true })
  mpPointPaymentId: string | null;

  @Column({ name: 'mp_qr_order_id', type: 'text', nullable: true })
  mpQrOrderId: string | null;

  @Column({ name: 'mp_qr_payment_id', type: 'bigint', nullable: true })
  mpQrPaymentId: string | null;

  @Column({ name: 'mp_qr_pago_huerfano', type: 'boolean', default: false })
  mpQrPagoHuerfano: boolean;

  @Column({ name: 'mp_qr_cancelado_at', type: 'timestamptz', nullable: true })
  mpQrCanceladoAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
