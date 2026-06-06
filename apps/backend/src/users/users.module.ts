import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Sucursal } from '../branches/entities/sucursal.entity';
import { UsuarioSucursal } from './entities/usuario-sucursal.entity';
import { Usuario } from './entities/usuario.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([Usuario, UsuarioSucursal, Sucursal])],
  providers: [UsersService],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
