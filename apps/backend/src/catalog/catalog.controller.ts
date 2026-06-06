import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { CatalogService } from './catalog.service';
import { CreateCategoriaDto } from './dto/create-categoria.dto';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { CreateProveedorDto } from './dto/create-proveedor.dto';
import { ListCatalogQueryDto } from './dto/list-catalog-query.dto';
import { UpdateCategoriaDto } from './dto/update-categoria.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { UpdateProveedorDto } from './dto/update-proveedor.dto';

@ApiTags('catalog')
@ApiBearerAuth('access-token')
@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('categories')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Listar categor├¡as del tenant' })
  listCategories(@Query() query: ListCatalogQueryDto) {
    return this.catalogService.listCategorias(query);
  }

  @Post('categories')
  @Roles('admin', 'operador')
  createCategory(@Body() dto: CreateCategoriaDto) {
    return this.catalogService.createCategoria(dto);
  }

  @Get('categories/:id')
  @Roles('admin', 'operador', 'visor')
  getCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogService.getCategoria(id);
  }

  @Patch('categories/:id')
  @Roles('admin', 'operador')
  updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoriaDto) {
    return this.catalogService.updateCategoria(id, dto);
  }

  @Delete('categories/:id')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Desactivar categor├¡a (soft)' })
  deleteCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogService.deactivateCategoria(id);
  }

  @Get('suppliers')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Listar proveedores del tenant' })
  listSuppliers(@Query() query: ListCatalogQueryDto) {
    return this.catalogService.listProveedores(query);
  }

  @Post('suppliers')
  @Roles('admin', 'operador')
  createSupplier(@Body() dto: CreateProveedorDto) {
    return this.catalogService.createProveedor(dto);
  }

  @Get('suppliers/:id')
  @Roles('admin', 'operador', 'visor')
  getSupplier(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogService.getProveedor(id);
  }

  @Patch('suppliers/:id')
  @Roles('admin', 'operador')
  updateSupplier(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProveedorDto) {
    return this.catalogService.updateProveedor(id, dto);
  }

  @Delete('suppliers/:id')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Desactivar proveedor (soft)' })
  deleteSupplier(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogService.deactivateProveedor(id);
  }

  @Get('customers')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Listar clientes del tenant' })
  listCustomers(@Query() query: ListCatalogQueryDto) {
    return this.catalogService.listClientes(query);
  }

  @Post('customers')
  @Roles('admin', 'operador')
  createCustomer(@Body() dto: CreateClienteDto) {
    return this.catalogService.createCliente(dto);
  }

  @Get('customers/:id')
  @Roles('admin', 'operador', 'visor')
  getCustomer(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogService.getCliente(id);
  }

  @Patch('customers/:id')
  @Roles('admin', 'operador')
  updateCustomer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClienteDto) {
    return this.catalogService.updateCliente(id, dto);
  }

  @Delete('customers/:id')
  @Roles('admin', 'operador')
  @ApiOperation({ summary: 'Desactivar cliente (soft)' })
  deleteCustomer(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogService.deactivateCliente(id);
  }
}
