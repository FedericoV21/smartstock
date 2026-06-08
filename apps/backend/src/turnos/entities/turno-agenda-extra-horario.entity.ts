import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { TurnoAgenda } from './turno-agenda.entity';

@Entity({ name: 'turno_agenda_extra_horario' })
export class TurnoAgendaExtraHorario {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'agenda_id', type: 'uuid' })
  agendaId: string;

  @Column({ name: 'dia_semana', type: 'smallint' })
  diaSemana: number;

  @Column({ name: 'hora_inicio', type: 'time' })
  horaInicio: string;

  @Column({ name: 'hora_fin', type: 'time' })
  horaFin: string;

  @Column({ name: 'extra_monto', type: 'numeric', precision: 12, scale: 2, default: '0' })
  extraMonto: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  @Column({ type: 'boolean', default: true })
  activa: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => TurnoAgenda, (agenda) => agenda.extrasHorarios, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agenda_id' })
  agenda?: TurnoAgenda;
}
