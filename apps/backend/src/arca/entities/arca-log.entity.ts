import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'arca_log' })
export class ArcaLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 10 })
  servicio: string;

  @Column({ type: 'varchar', length: 100 })
  operacion: string;

  @Column({ name: 'request_xml', type: 'text', nullable: true })
  requestXml: string | null;

  @Column({ name: 'response_xml', type: 'text', nullable: true })
  responseXml: string | null;

  @Column({ name: 'exitoso', type: 'boolean', default: false })
  exitoso: boolean;

  @Column({ name: 'error_codigo', type: 'varchar', length: 64, nullable: true })
  errorCodigo: string | null;

  @Column({ name: 'error_mensaje', type: 'text', nullable: true })
  errorMensaje: string | null;

  @Column({ name: 'comprobante_id', type: 'uuid', nullable: true })
  comprobanteId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
