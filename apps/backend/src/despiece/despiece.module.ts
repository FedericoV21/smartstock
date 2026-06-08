import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { PrecioSucursal } from '../branches/entities/precio-sucursal.entity';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { TenantConfigModule } from '../config/config.module';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { LectorFacturasModule } from '../lector-facturas/lector-facturas.module';
import { PrecioHistorial } from '../pricing/entities/precio-historial.entity';
import { ProductoLoteIngreso } from '../products/entities/producto-lote-ingreso.entity';
import { Producto } from '../products/entities/producto.entity';
import { ProductsModule } from '../products/products.module';
import { Permiso } from '../rbac/entities/permiso.entity';
import { RolPermiso } from '../rbac/entities/rol-permiso.entity';
import { UsuarioPermiso } from '../rbac/entities/usuario-permiso.entity';
import { UsuarioRol } from '../rbac/entities/usuario-rol.entity';
import { PermisosEvalService } from '../rbac/permisos-eval.service';
import { Usuario } from '../users/entities/usuario.entity';
import { DespieceBaseService } from './despiece-base.service';
import { DespieceCalculoService } from './despiece-calculo.service';
import { DespieceController } from './despiece.controller';
import { DespieceIngresosService } from './despiece-ingresos.service';
import { DespiecePlantillasService } from './despiece-plantillas.service';
import { DespiecePredeterminadasService } from './despiece-predeterminadas.service';
import { DespieceProductosCorteService } from './despiece-productos-corte.service';
import { DespieceCorte } from './entities/despiece-corte.entity';
import { DespiecePlantilla } from './entities/despiece-plantilla.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DespiecePlantilla,
      DespieceCorte,
      ModuloConfig,
      Tenant,
      Sucursal,
      Producto,
      ProductoLoteIngreso,
      PrecioSucursal,
      PrecioHistorial,
      Usuario,
      Permiso,
      RolPermiso,
      UsuarioPermiso,
      UsuarioRol,
    ]),
    AuthModule,
    BranchesModule,
    TenantConfigModule,
    ProductsModule,
    forwardRef(() => LectorFacturasModule),
  ],
  controllers: [DespieceController],
  providers: [
    PermisosEvalService,
    DespieceBaseService,
    DespieceCalculoService,
    DespiecePlantillasService,
    DespieceIngresosService,
    DespieceProductosCorteService,
    DespiecePredeterminadasService,
  ],
})
export class DespieceModule {}
