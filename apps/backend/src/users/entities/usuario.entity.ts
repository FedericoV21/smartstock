import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { RolUsuario } from '../enums/rol-usuario.enum';

@Entity({ name: 'usuario' })
export class Usuario {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'text', default: '' })
  apellido: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({
    type: 'enum',
    enum: RolUsuario,
    enumName: 'rol_usuario',
    default: RolUsuario.operador,
  })
  rol: RolUsuario;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @Column({ name: 'es_super_admin', type: 'boolean', default: false })
  esSuperAdmin: boolean;

  @Column({ name: 'es_prueba', type: 'boolean', default: false })
  esPrueba: boolean;

  @Column({ name: 'tenant_contexto_id', type: 'uuid', nullable: true })
  tenantContextoId: string | null;

  @Column({ name: 'sucursal_default_id', type: 'uuid', nullable: true })
  sucursalDefaultId: string | null;

  @Column({ name: 'pedidos_puede_crear', type: 'boolean', default: false })
  pedidosPuedeCrear: boolean;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @Column({ name: 'deleted_by', type: 'uuid', nullable: true })
  deletedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
