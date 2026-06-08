import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { PedidoWorkflowEstado } from '../pedidos/entities/pedido-workflow-estado.entity';
import { Permiso } from '../rbac/entities/permiso.entity';
import { Rol } from '../rbac/entities/rol.entity';
import { UsuarioCredencialLocal } from '../rbac/entities/usuario-credencial-local.entity';
import { UsuarioPedidoWorkflowEstado } from '../rbac/entities/usuario-pedido-workflow-estado.entity';
import { UsuarioPermiso } from '../rbac/entities/usuario-permiso.entity';
import { UsuarioRol } from '../rbac/entities/usuario-rol.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { UsuarioSucursal } from '../users/entities/usuario-sucursal.entity';
import { RolUsuario } from '../users/enums/rol-usuario.enum';
import { ConfigUsersRbacService } from './config-users-rbac.service';

describe('ConfigUsersRbacService', () => {
  let service: ConfigUsersRbacService;
  let usuarioRepo: { findOne: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    usuarioRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'u1',
        tenantId: 'tenant-1',
        rol: RolUsuario.operador,
        pedidosPuedeCrear: false,
        deletedAt: null,
      }),
      update: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigUsersRbacService,
        { provide: getRepositoryToken(Usuario), useValue: usuarioRepo },
        {
          provide: getRepositoryToken(UsuarioSucursal),
          useValue: { find: jest.fn().mockResolvedValue([{ sucursalId: 's1' }]) },
        },
        { provide: getRepositoryToken(Sucursal), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(Rol), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(UsuarioRol), useValue: { save: jest.fn() } },
        {
          provide: getRepositoryToken(Permiso),
          useValue: {
            find: jest.fn().mockResolvedValue([
              { id: 'p1', clave: 'stock.ver' },
            ]),
          },
        },
        {
          provide: getRepositoryToken(UsuarioPermiso),
          useValue: { find: jest.fn().mockResolvedValue([]), delete: jest.fn(), save: jest.fn() },
        },
        { provide: getRepositoryToken(UsuarioCredencialLocal), useValue: { findOne: jest.fn() } },
        {
          provide: getRepositoryToken(UsuarioPedidoWorkflowEstado),
          useValue: { find: jest.fn().mockResolvedValue([]), delete: jest.fn(), save: jest.fn() },
        },
        { provide: getRepositoryToken(PedidoWorkflowEstado), useValue: { find: jest.fn() } },
        { provide: TenantContext, useValue: { getTenantId: () => 'tenant-1' } },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn(async (fn) =>
              fn({
                delete: jest.fn(),
                save: jest.fn(),
                update: jest.fn(),
              }),
            ),
          },
        },
      ],
    }).compile();

    service = module.get(ConfigUsersRbacService);
  });

  it('getUserSucursales devuelve ids', async () => {
    const result = await service.getUserSucursales('u1');
    expect(result.sucursalIds).toEqual(['s1']);
  });

  it('getUserPermisosExtra para admin lanza error en patch', async () => {
    usuarioRepo.findOne.mockResolvedValue({
      id: 'u1',
      tenantId: 'tenant-1',
      rol: RolUsuario.admin,
      pedidosPuedeCrear: false,
      deletedAt: null,
    });

    await expect(
      service.patchUserPermisosExtra('u1', { permisos: ['stock.ver'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('usuario inexistente lanza NotFound', async () => {
    usuarioRepo.findOne.mockResolvedValue(null);
    await expect(service.getUserSucursales('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
