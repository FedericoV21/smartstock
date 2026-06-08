import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Cliente } from '../../catalog/entities/cliente.entity';
import { Comprobante } from '../../facturacion/entities/comprobante.entity';
import { TurnoReservaEstado } from '../enums/turno-reserva-estado.enum';
import { TurnoAgenda } from './turno-agenda.entity';

@Entity({ name: 'turno_reserva' })
export class TurnoReserva {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ name: 'agenda_id', type: 'uuid' })
  agendaId: string;

  @Column({ name: 'cliente_id', type: 'uuid', nullable: true })
  clienteId: string | null;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  telefono: string | null;

  @Column({ type: 'text', nullable: true })
  email: string | null;

  @Column({ type: 'text', nullable: true })
  notas: string | null;

  @Column({ type: 'date' })
  fecha: string;

  @Column({ name: 'hora_inicio', type: 'time' })
  horaInicio: string;

  @Column({ name: 'hora_fin', type: 'time' })
  horaFin: string;

  @Column({ name: 'precio_snapshot', type: 'numeric', precision: 12, scale: 2, default: '0' })
  precioSnapshot: string;

  @Column({ name: 'sena_monto', type: 'numeric', precision: 12, scale: 2, default: '0' })
  senaMonto: string;

  @Column({ type: 'text', default: TurnoReservaEstado.reservado })
  estado: TurnoReservaEstado;

  @Column({ name: 'comprobante_id', type: 'uuid', nullable: true })
  comprobanteId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'cancelado_at', type: 'timestamptz', nullable: true })
  canceladoAt: Date | null;

  @Column({ name: 'cancelado_por', type: 'uuid', nullable: true })
  canceladoPor: string | null;

  @ManyToOne(() => TurnoAgenda, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agenda_id' })
  agenda?: TurnoAgenda;

  @ManyToOne(() => Cliente, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'cliente_id' })
  cliente?: Cliente | null;

  @ManyToOne(() => Comprobante, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'comprobante_id' })
  comprobante?: Comprobante | null;
}
