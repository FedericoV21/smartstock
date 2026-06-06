import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { CondicionIva } from '../enums/condicion-iva.enum';

@Entity({ name: 'cliente' })
export class Cliente {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ name: 'razon_social', type: 'text', nullable: true })
  razonSocial: string | null;

  @Column({ name: 'cuit_dni', type: 'varchar', length: 20, nullable: true })
  cuitDni: string | null;

  @Column({
    name: 'condicion_iva',
    type: 'enum',
    enum: CondicionIva,
    enumName: 'condicion_iva',
    nullable: true,
  })
  condicionIva: CondicionIva | null;

  @Column({ type: 'text', nullable: true })
  direccion: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  telefono: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'text', nullable: true })
  notas: string | null;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
