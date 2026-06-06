import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { ArcaAmbiente } from '../enums/arca-ambiente.enum';

@Entity({ name: 'arca_config' })
export class ArcaConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ name: 'certificado_pem', type: 'text', nullable: true })
  certificadoPem: string | null;

  @Column({ name: 'clave_privada_pem', type: 'text', nullable: true })
  clavePrivadaPem: string | null;

  @Column({ name: 'cuit_emisor', type: 'varchar', length: 13, nullable: true })
  cuitEmisor: string | null;

  @Column({ name: 'punto_de_venta', type: 'integer', nullable: true })
  puntoDeVenta: number | null;

  @Column({ type: 'enum', enum: ArcaAmbiente, enumName: 'arca_ambiente', default: ArcaAmbiente.homologacion })
  ambiente: ArcaAmbiente;

  @Column({ name: 'ticket_acceso', type: 'text', nullable: true })
  ticketAcceso: string | null;

  @Column({ name: 'ticket_sign', type: 'text', nullable: true })
  ticketSign: string | null;

  @Column({ name: 'ticket_expiracion', type: 'timestamptz', nullable: true })
  ticketExpiracion: Date | null;

  @Column({ name: 'ultimo_comprobante', type: 'integer', nullable: true })
  ultimoComprobante: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
