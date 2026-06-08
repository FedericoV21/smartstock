import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { LectorFacturasBaseService } from '../lector-facturas/lector-facturas-base.service';
import { WhatsappBaseService } from './whatsapp-base.service';
import { WhatsappSandboxInvoiceService } from './whatsapp-sandbox-invoice.service';
import { WhatsappSandboxService } from './whatsapp-sandbox.service';

const MAX_FILE_SIZE = 12 * 1024 * 1024;

@ApiTags('whatsapp')
@ApiBearerAuth('access-token')
@Controller('whatsapp/sandbox')
export class WhatsappSandboxController {
  constructor(
    private readonly base: WhatsappBaseService,
    private readonly lectorBase: LectorFacturasBaseService,
    private readonly sandbox: WhatsappSandboxService,
    private readonly invoice: WhatsappSandboxInvoiceService,
  ) {}

  @Get('chat')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Listar mensajes sandbox', description: 'Paridad GET /api/whatsapp/sandbox/chat' })
  async getChat(@CurrentUser() user: AccessTokenPayload) {
    await this.base.assertModuloWhatsApp();
    const messages = await this.sandbox.loadMessages(user);
    return { messages };
  }

  @Post('chat')
  @Roles('admin', 'operador', 'visor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enviar mensaje sandbox', description: 'Paridad POST /api/whatsapp/sandbox/chat' })
  async postChat(@CurrentUser() user: AccessTokenPayload, @Body() body: Record<string, unknown>) {
    await this.base.assertModuloWhatsApp();
    const message = String(body.message ?? '').trim();
    if (!message) {
      throw new BadRequestException('El mensaje no puede estar vacio.');
    }
    return this.sandbox.sendSandboxChatMessage(user, message);
  }

  @Delete('chat')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({ summary: 'Limpiar chat sandbox', description: 'Paridad DELETE /api/whatsapp/sandbox/chat' })
  async deleteChat(@CurrentUser() user: AccessTokenPayload) {
    await this.base.assertModuloWhatsApp();
    await this.sandbox.clearChat(user);
    return { ok: true, messages: [] };
  }

  @Post('facturas')
  @Roles('admin', 'operador')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('archivo', 10, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  @ApiOperation({
    summary: 'Subir factura al sandbox',
    description: 'Paridad POST /api/whatsapp/sandbox/facturas',
  })
  async postFacturas(
    @CurrentUser() user: AccessTokenPayload,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('sucursal_id') sucursalId?: string,
  ) {
    await this.lectorBase.assertModuloLector();
    this.lectorBase.assertNotVisor(user);
    const sucursal = await this.invoice.resolveSucursalForUpload(user, sucursalId);
    const archivos = this.invoice.multerToEntrada(files);
    const result = await this.invoice.processSandboxInvoiceUpload({
      user,
      sucursalId: sucursal,
      archivos,
    });
    if (!result.ok) {
      throw new HttpException({ error: result.error, messages: result.messages }, result.status);
    }
    return result;
  }

  @Get('facturas/tickets')
  @Roles('admin', 'operador', 'visor')
  @ApiOperation({
    summary: 'Listar tickets de factura sandbox',
    description: 'Paridad GET /api/whatsapp/sandbox/facturas/tickets',
  })
  async listTickets(@CurrentUser() user: AccessTokenPayload, @Query('limit') limit?: string) {
    await this.lectorBase.assertModuloLector();
    const parsed = limit != null ? Number.parseInt(limit, 10) : undefined;
    return this.sandbox.listInvoiceTickets(user, parsed);
  }

  @Patch('facturas/tickets/:id/items')
  @Roles('admin', 'operador')
  @ApiOperation({
    summary: 'Enlazar producto en ticket',
    description: 'Paridad PATCH /api/whatsapp/sandbox/facturas/tickets/:id/items',
  })
  async patchTicketItem(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    await this.lectorBase.assertModuloLector();
    this.lectorBase.assertNotVisor(user);
    const itemIndice = Number(body.item_indice ?? body.indice);
    const productoId = typeof body.producto_id === 'string' ? body.producto_id.trim() : '';
    if (!id) throw new BadRequestException('Ticket invalido.');
    if (!Number.isInteger(itemIndice) || itemIndice < 0) {
      throw new BadRequestException('item_indice invalido.');
    }
    if (!productoId) throw new BadRequestException('producto_id es obligatorio.');
    return this.sandbox.linkTicketItem({ user, ticketId: id, itemIndice, productoId });
  }

  @Post('facturas/tickets/:id/continuar')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Continuar / cargar ticket',
    description: 'Paridad POST /api/whatsapp/sandbox/facturas/tickets/:id/continuar',
  })
  async continueTicket(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    await this.lectorBase.assertModuloLector();
    this.lectorBase.assertNotVisor(user);
    if (!id) throw new BadRequestException('Ticket invalido.');
    const token = typeof body.token === 'string' ? body.token.trim() || null : null;
    return this.sandbox.continueTicket({ user, ticketId: id, token });
  }

  @Post('facturas/tickets/:id/cerrar')
  @Roles('admin', 'operador')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cerrar ticket sandbox',
    description: 'Paridad POST /api/whatsapp/sandbox/facturas/tickets/:id/cerrar',
  })
  async closeTicket(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    await this.lectorBase.assertModuloLector();
    this.lectorBase.assertNotVisor(user);
    if (!id) throw new BadRequestException('Ticket invalido.');
    return this.sandbox.closeTicket({ user, ticketId: id });
  }
}
