import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { Categoria } from './entities/categoria.entity';
import { Cliente } from './entities/cliente.entity';
import { Proveedor } from './entities/proveedor.entity';
import { SupplierMergeController } from './supplier-merge.controller';
import { SupplierMergeService } from './supplier-merge.service';

@Module({
  imports: [TypeOrmModule.forFeature([Categoria, Proveedor, Cliente, ModuloConfig]), AuthModule],
  controllers: [CatalogController, SupplierMergeController],
  providers: [CatalogService, SupplierMergeService],
  exports: [CatalogService, SupplierMergeService],
})
export class CatalogModule {}
