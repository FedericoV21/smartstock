import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'rol_permiso' })
export class RolPermiso {
  @PrimaryColumn({ name: 'rol_id', type: 'uuid' })
  rolId: string;

  @PrimaryColumn({ name: 'permiso_id', type: 'uuid' })
  permisoId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
