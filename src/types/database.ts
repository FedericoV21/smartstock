/**
 * Tipos del esquema `public` de Supabase (Nexus).
 * Regenerar con `npm run gen:types` cuando tengas `SUPABASE_ACCESS_TOKEN` configurado.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      arca_config: {
        Row: {
          ambiente: Database['public']['Enums']['arca_ambiente'];
          certificado_pem: string | null;
          clave_privada_pem: string | null;
          created_at: string;
          cuit_emisor: string | null;
          id: string;
          punto_de_venta: number | null;
          tenant_id: string;
          ticket_acceso: string | null;
          ticket_expiracion: string | null;
          ticket_sign: string | null;
          ultimo_comprobante: number | null;
          updated_at: string;
        };
        Insert: {
          ambiente?: Database['public']['Enums']['arca_ambiente'];
          certificado_pem?: string | null;
          clave_privada_pem?: string | null;
          created_at?: string;
          cuit_emisor?: string | null;
          id?: string;
          punto_de_venta?: number | null;
          tenant_id: string;
          ticket_acceso?: string | null;
          ticket_expiracion?: string | null;
          ticket_sign?: string | null;
          ultimo_comprobante?: number | null;
          updated_at?: string;
        };
        Update: {
          ambiente?: Database['public']['Enums']['arca_ambiente'];
          certificado_pem?: string | null;
          clave_privada_pem?: string | null;
          created_at?: string;
          cuit_emisor?: string | null;
          id?: string;
          punto_de_venta?: number | null;
          tenant_id?: string;
          ticket_acceso?: string | null;
          ticket_expiracion?: string | null;
          ticket_sign?: string | null;
          ultimo_comprobante?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'arca_config_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: true;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
        ];
      };
      arca_log: {
        Row: {
          comprobante_id: string | null;
          created_at: string;
          error_codigo: string | null;
          error_mensaje: string | null;
          exitoso: boolean;
          id: string;
          operacion: string | null;
          request_xml: string | null;
          response_xml: string | null;
          servicio: string | null;
          tenant_id: string;
        };
        Insert: {
          comprobante_id?: string | null;
          created_at?: string;
          error_codigo?: string | null;
          error_mensaje?: string | null;
          exitoso?: boolean;
          id?: string;
          operacion?: string | null;
          request_xml?: string | null;
          response_xml?: string | null;
          servicio?: string | null;
          tenant_id: string;
        };
        Update: {
          comprobante_id?: string | null;
          created_at?: string;
          error_codigo?: string | null;
          error_mensaje?: string | null;
          exitoso?: boolean;
          id?: string;
          operacion?: string | null;
          request_xml?: string | null;
          response_xml?: string | null;
          servicio?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'arca_log_comprobante_id_fkey';
            columns: ['comprobante_id'];
            isOneToOne: false;
            referencedRelation: 'comprobante';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'arca_log_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
        ];
      };
      cierre_mensual: {
        Row: {
          id: string;
          tenant_id: string;
          periodo: string;
          ingresos_brutos: number;
          costo_mercaderia: number;
          margen_bruto: number;
          margen_bruto_pct: number | null;
          unidades_vendidas: number;
          comprobantes_emitidos: number;
          ticket_promedio: number | null;
          top_productos: Json | null;
          por_categoria: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          periodo: string;
          ingresos_brutos?: number;
          costo_mercaderia?: number;
          margen_bruto?: number;
          margen_bruto_pct?: number | null;
          unidades_vendidas?: number;
          comprobantes_emitidos?: number;
          ticket_promedio?: number | null;
          top_productos?: Json | null;
          por_categoria?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          periodo?: string;
          ingresos_brutos?: number;
          costo_mercaderia?: number;
          margen_bruto?: number;
          margen_bruto_pct?: number | null;
          unidades_vendidas?: number;
          comprobantes_emitidos?: number;
          ticket_promedio?: number | null;
          top_productos?: Json | null;
          por_categoria?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cierre_mensual_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
        ];
      };
      cuenta_corriente: {
        Row: {
          id: string;
          tenant_id: string;
          cliente_id: string;
          saldo: number;
          limite_credito: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          cliente_id: string;
          saldo?: number;
          limite_credito?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          cliente_id?: string;
          saldo?: number;
          limite_credito?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cuenta_corriente_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cuenta_corriente_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'cliente';
            referencedColumns: ['id'];
          },
        ];
      };
      categoria: {
        Row: {
          activa: boolean;
          created_at: string;
          descripcion: string | null;
          id: string;
          nombre: string;
          tenant_id: string;
        };
        Insert: {
          activa?: boolean;
          created_at?: string;
          descripcion?: string | null;
          id?: string;
          nombre: string;
          tenant_id: string;
        };
        Update: {
          activa?: boolean;
          created_at?: string;
          descripcion?: string | null;
          id?: string;
          nombre?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'categoria_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
        ];
      };
      cliente: {
        Row: {
          activo: boolean;
          condicion_iva: Database['public']['Enums']['condicion_iva'] | null;
          created_at: string;
          cuit_dni: string | null;
          direccion: string | null;
          email: string | null;
          id: string;
          nombre: string;
          notas: string | null;
          razon_social: string | null;
          telefono: string | null;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          condicion_iva?: Database['public']['Enums']['condicion_iva'] | null;
          created_at?: string;
          cuit_dni?: string | null;
          direccion?: string | null;
          email?: string | null;
          id?: string;
          nombre: string;
          notas?: string | null;
          razon_social?: string | null;
          telefono?: string | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          condicion_iva?: Database['public']['Enums']['condicion_iva'] | null;
          created_at?: string;
          cuit_dni?: string | null;
          direccion?: string | null;
          email?: string | null;
          id?: string;
          nombre?: string;
          notas?: string | null;
          razon_social?: string | null;
          telefono?: string | null;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cliente_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
        ];
      };
      medio_pago: {
        Row: {
          activo: boolean;
          created_at: string;
          id: string;
          nombre: string;
          orden: number;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          created_at?: string;
          id?: string;
          nombre: string;
          orden?: number;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          created_at?: string;
          id?: string;
          nombre?: string;
          orden?: number;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'medio_pago_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
        ];
      };
      medio_pago_rapido: {
        Row: {
          codigo: string;
          recargo_porcentaje: number;
          tenant_id: string;
        };
        Insert: {
          codigo: string;
          recargo_porcentaje?: number;
          tenant_id: string;
        };
        Update: {
          codigo?: string;
          recargo_porcentaje?: number;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'medio_pago_rapido_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
        ];
      };
      medio_pago_opcion: {
        Row: {
          cuotas: number;
          id: string;
          medio_pago_id: string;
          recargo_porcentaje: number;
        };
        Insert: {
          cuotas: number;
          id?: string;
          medio_pago_id: string;
          recargo_porcentaje: number;
        };
        Update: {
          cuotas?: number;
          id?: string;
          medio_pago_id?: string;
          recargo_porcentaje?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'medio_pago_opcion_medio_pago_id_fkey';
            columns: ['medio_pago_id'];
            isOneToOne: false;
            referencedRelation: 'medio_pago';
            referencedColumns: ['id'];
          },
        ];
      };
      comprobante: {
        Row: {
          cae: string | null;
          cae_vencimiento: string | null;
          caja_id: string | null;
          cliente_id: string | null;
          created_at: string;
          estado: Database['public']['Enums']['estado_comprobante'];
          fecha: string;
          fiscalizado_por_id: string | null;
          financiacion_descripcion: string | null;
          financiacion_monto: number | null;
          financiacion_porcentaje: number | null;
          id: string;
          iva_monto: number;
          iva_porcentaje: number;
          metodo_pago: string | null;
          metodo_pago_detalle: Json | null;
          medio_pago_opcion_id: string | null;
          mp_point_intent_id: string | null;
          mp_point_payment_id: number | null;
          notas: string | null;
          numero: number;
          numero_orden: number;
          pdf_url: string | null;
          subtotal: number;
          tenant_id: string;
          tipo: Database['public']['Enums']['tipo_comprobante'];
          total: number;
          total_mercaderia: number | null;
          updated_at: string;
          usuario_id: string | null;
        };
        Insert: {
          cae?: string | null;
          cae_vencimiento?: string | null;
          caja_id?: string | null;
          cliente_id?: string | null;
          created_at?: string;
          estado?: Database['public']['Enums']['estado_comprobante'];
          fecha?: string;
          fiscalizado_por_id?: string | null;
          financiacion_descripcion?: string | null;
          financiacion_monto?: number | null;
          financiacion_porcentaje?: number | null;
          id?: string;
          iva_monto?: number;
          iva_porcentaje?: number;
          metodo_pago?: string | null;
          metodo_pago_detalle?: Json | null;
          medio_pago_opcion_id?: string | null;
          mp_point_intent_id?: string | null;
          mp_point_payment_id?: number | null;
          notas?: string | null;
          numero: number;
          numero_orden: number;
          pdf_url?: string | null;
          subtotal?: number;
          tenant_id: string;
          tipo: Database['public']['Enums']['tipo_comprobante'];
          total?: number;
          total_mercaderia?: number | null;
          updated_at?: string;
          usuario_id?: string | null;
        };
        Update: {
          cae?: string | null;
          cae_vencimiento?: string | null;
          caja_id?: string | null;
          cliente_id?: string | null;
          created_at?: string;
          estado?: Database['public']['Enums']['estado_comprobante'];
          fecha?: string;
          fiscalizado_por_id?: string | null;
          financiacion_descripcion?: string | null;
          financiacion_monto?: number | null;
          financiacion_porcentaje?: number | null;
          id?: string;
          iva_monto?: number;
          iva_porcentaje?: number;
          metodo_pago?: string | null;
          metodo_pago_detalle?: Json | null;
          medio_pago_opcion_id?: string | null;
          mp_point_intent_id?: string | null;
          mp_point_payment_id?: number | null;
          notas?: string | null;
          numero?: number;
          numero_orden?: number;
          pdf_url?: string | null;
          subtotal?: number;
          tenant_id?: string;
          tipo?: Database['public']['Enums']['tipo_comprobante'];
          total?: number;
          total_mercaderia?: number | null;
          updated_at?: string;
          usuario_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'comprobante_fiscalizado_por_id_fkey';
            columns: ['fiscalizado_por_id'];
            isOneToOne: false;
            referencedRelation: 'comprobante';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'comprobante_medio_pago_opcion_id_fkey';
            columns: ['medio_pago_opcion_id'];
            isOneToOne: false;
            referencedRelation: 'medio_pago_opcion';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'comprobante_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'cliente';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'comprobante_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'comprobante_usuario_id_fkey';
            columns: ['usuario_id'];
            isOneToOne: false;
            referencedRelation: 'usuario';
            referencedColumns: ['id'];
          },
        ];
      };
      comprobante_item: {
        Row: {
          cantidad: number;
          comprobante_id: string;
          created_at: string;
          id: string;
          precio_costo: number;
          precio_unitario: number;
          producto_id: string;
          subtotal: number;
        };
        Insert: {
          cantidad: number;
          comprobante_id: string;
          created_at?: string;
          id?: string;
          precio_costo?: number;
          precio_unitario: number;
          producto_id: string;
          subtotal: number;
        };
        Update: {
          cantidad?: number;
          comprobante_id?: string;
          created_at?: string;
          id?: string;
          precio_costo?: number;
          precio_unitario?: number;
          producto_id?: string;
          subtotal?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'comprobante_item_comprobante_id_fkey';
            columns: ['comprobante_id'];
            isOneToOne: false;
            referencedRelation: 'comprobante';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'comprobante_item_producto_id_fkey';
            columns: ['producto_id'];
            isOneToOne: false;
            referencedRelation: 'producto';
            referencedColumns: ['id'];
          },
        ];
      };
      importacion_log: {
        Row: {
          archivo_nombre: string;
          created_at: string;
          detalle_errores: Json | null;
          filas_con_error: number;
          filas_exitosas: number;
          id: string;
          origen: Database['public']['Enums']['origen_precio'];
          productos_actualizados: number;
          productos_creados: number;
          proveedor_id: string | null;
          tenant_id: string;
          total_filas: number;
          usuario_id: string | null;
        };
        Insert: {
          archivo_nombre: string;
          created_at?: string;
          detalle_errores?: Json | null;
          filas_con_error?: number;
          filas_exitosas?: number;
          id?: string;
          origen?: Database['public']['Enums']['origen_precio'];
          productos_actualizados?: number;
          productos_creados?: number;
          proveedor_id?: string | null;
          tenant_id: string;
          total_filas?: number;
          usuario_id?: string | null;
        };
        Update: {
          archivo_nombre?: string;
          created_at?: string;
          detalle_errores?: Json | null;
          filas_con_error?: number;
          filas_exitosas?: number;
          id?: string;
          origen?: Database['public']['Enums']['origen_precio'];
          productos_actualizados?: number;
          productos_creados?: number;
          proveedor_id?: string | null;
          tenant_id?: string;
          total_filas?: number;
          usuario_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'importacion_log_proveedor_id_fkey';
            columns: ['proveedor_id'];
            isOneToOne: false;
            referencedRelation: 'proveedor';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'importacion_log_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'importacion_log_usuario_id_fkey';
            columns: ['usuario_id'];
            isOneToOne: false;
            referencedRelation: 'usuario';
            referencedColumns: ['id'];
          },
        ];
      };
      lista_precios: {
        Row: {
          created_at: string;
          error_mensaje: string | null;
          estado: Database['public']['Enums']['estado_lista_precios'];
          fecha_recepcion: string;
          fecha_vigencia_desde: string | null;
          fecha_vigencia_hasta: string | null;
          id: string;
          impacto_por_categoria: Json | null;
          items_con_aumento: number;
          items_con_baja: number;
          items_matcheados_dudosos: number;
          items_matcheados_seguros: number;
          items_sin_cambio: number;
          items_sin_match: number;
          margen_global_anterior_pct: number | null;
          margen_global_nuevo_pct: number | null;
          mime_type: string | null;
          nombre_archivo: string;
          origen_extraccion: Database['public']['Enums']['origen_precio'];
          proveedor_id: string;
          resumen_ia: Json | null;
          storage_bucket: string;
          storage_path: string | null;
          tenant_id: string;
          total_items: number;
          updated_at: string;
          usuario_id: string | null;
          variacion_promedio_pct: number | null;
        };
        Insert: {
          created_at?: string;
          error_mensaje?: string | null;
          estado?: Database['public']['Enums']['estado_lista_precios'];
          fecha_recepcion?: string;
          fecha_vigencia_desde?: string | null;
          fecha_vigencia_hasta?: string | null;
          id?: string;
          impacto_por_categoria?: Json | null;
          items_con_aumento?: number;
          items_con_baja?: number;
          items_matcheados_dudosos?: number;
          items_matcheados_seguros?: number;
          items_sin_cambio?: number;
          items_sin_match?: number;
          margen_global_anterior_pct?: number | null;
          margen_global_nuevo_pct?: number | null;
          mime_type?: string | null;
          nombre_archivo: string;
          origen_extraccion: Database['public']['Enums']['origen_precio'];
          proveedor_id: string;
          resumen_ia?: Json | null;
          storage_bucket?: string;
          storage_path?: string | null;
          tenant_id: string;
          total_items?: number;
          updated_at?: string;
          usuario_id?: string | null;
          variacion_promedio_pct?: number | null;
        };
        Update: {
          created_at?: string;
          error_mensaje?: string | null;
          estado?: Database['public']['Enums']['estado_lista_precios'];
          fecha_recepcion?: string;
          fecha_vigencia_desde?: string | null;
          fecha_vigencia_hasta?: string | null;
          id?: string;
          impacto_por_categoria?: Json | null;
          items_con_aumento?: number;
          items_con_baja?: number;
          items_matcheados_dudosos?: number;
          items_matcheados_seguros?: number;
          items_sin_cambio?: number;
          items_sin_match?: number;
          margen_global_anterior_pct?: number | null;
          margen_global_nuevo_pct?: number | null;
          mime_type?: string | null;
          nombre_archivo?: string;
          origen_extraccion?: Database['public']['Enums']['origen_precio'];
          proveedor_id?: string;
          resumen_ia?: Json | null;
          storage_bucket?: string;
          storage_path?: string | null;
          tenant_id?: string;
          total_items?: number;
          updated_at?: string;
          usuario_id?: string | null;
          variacion_promedio_pct?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'lista_precios_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lista_precios_proveedor_id_fkey';
            columns: ['proveedor_id'];
            isOneToOne: false;
            referencedRelation: 'proveedor';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lista_precios_usuario_id_fkey';
            columns: ['usuario_id'];
            isOneToOne: false;
            referencedRelation: 'usuario';
            referencedColumns: ['id'];
          },
        ];
      };
      lista_precios_item: {
        Row: {
          codigo_proveedor: string | null;
          created_at: string;
          id: string;
          incluir_en_aplicacion: boolean;
          lista_id: string;
          margen_anterior_pct: number | null;
          margen_nuevo_pct: number | null;
          match_confidence: number | null;
          match_metodo: string | null;
          nombre_normalizado: string | null;
          nombre_raw: string;
          notas: string | null;
          orden: number | null;
          precio_costo_anterior: number | null;
          precio_lista: number;
          precio_venta_actual: number | null;
          precio_venta_decidido: number | null;
          precio_venta_sugerido: number | null;
          producto_id: string | null;
          unidad: Database['public']['Enums']['unidad_medida'] | null;
          updated_at: string;
          variacion_pct: number | null;
        };
        Insert: {
          codigo_proveedor?: string | null;
          created_at?: string;
          id?: string;
          incluir_en_aplicacion?: boolean;
          lista_id: string;
          margen_anterior_pct?: number | null;
          margen_nuevo_pct?: number | null;
          match_confidence?: number | null;
          match_metodo?: string | null;
          nombre_normalizado?: string | null;
          nombre_raw: string;
          notas?: string | null;
          orden?: number | null;
          precio_costo_anterior?: number | null;
          precio_lista: number;
          precio_venta_actual?: number | null;
          precio_venta_decidido?: number | null;
          precio_venta_sugerido?: number | null;
          producto_id?: string | null;
          unidad?: Database['public']['Enums']['unidad_medida'] | null;
          updated_at?: string;
          variacion_pct?: number | null;
        };
        Update: {
          codigo_proveedor?: string | null;
          created_at?: string;
          id?: string;
          incluir_en_aplicacion?: boolean;
          lista_id?: string;
          margen_anterior_pct?: number | null;
          margen_nuevo_pct?: number | null;
          match_confidence?: number | null;
          match_metodo?: string | null;
          nombre_normalizado?: string | null;
          nombre_raw?: string;
          notas?: string | null;
          orden?: number | null;
          precio_costo_anterior?: number | null;
          precio_lista?: number;
          precio_venta_actual?: number | null;
          precio_venta_decidido?: number | null;
          precio_venta_sugerido?: number | null;
          producto_id?: string | null;
          unidad?: Database['public']['Enums']['unidad_medida'] | null;
          updated_at?: string;
          variacion_pct?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'lista_precios_item_lista_id_fkey';
            columns: ['lista_id'];
            isOneToOne: false;
            referencedRelation: 'lista_precios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lista_precios_item_producto_id_fkey';
            columns: ['producto_id'];
            isOneToOne: false;
            referencedRelation: 'producto';
            referencedColumns: ['id'];
          },
        ];
      };
      modulo_config: {
        Row: {
          analizador_rentabilidad: boolean;
          created_at: string;
          facturador_arca: boolean;
          facturador_pos: boolean;
          facturador_simple: boolean;
          ia_precios: boolean;
          id: string;
          importador_excel: boolean;
          pedidos: boolean;
          presupuestos: boolean;
          stock: boolean;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          analizador_rentabilidad?: boolean;
          created_at?: string;
          facturador_arca?: boolean;
          facturador_pos?: boolean;
          facturador_simple?: boolean;
          ia_precios?: boolean;
          id?: string;
          importador_excel?: boolean;
          pedidos?: boolean;
          presupuestos?: boolean;
          stock?: boolean;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          analizador_rentabilidad?: boolean;
          created_at?: string;
          facturador_arca?: boolean;
          facturador_pos?: boolean;
          facturador_simple?: boolean;
          ia_precios?: boolean;
          id?: string;
          importador_excel?: boolean;
          pedidos?: boolean;
          presupuestos?: boolean;
          stock?: boolean;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'modulo_config_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: true;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
        ];
      };
      movimiento: {
        Row: {
          cantidad: number;
          created_at: string;
          id: string;
          motivo: string | null;
          producto_id: string;
          referencia_id: string | null;
          referencia_tipo: Database['public']['Enums']['referencia_tipo'] | null;
          stock_anterior: number;
          stock_posterior: number;
          tenant_id: string;
          tipo: Database['public']['Enums']['tipo_movimiento'];
          usuario_id: string | null;
        };
        Insert: {
          cantidad: number;
          created_at?: string;
          id?: string;
          motivo?: string | null;
          producto_id: string;
          referencia_id?: string | null;
          referencia_tipo?: Database['public']['Enums']['referencia_tipo'] | null;
          stock_anterior: number;
          stock_posterior: number;
          tenant_id: string;
          tipo: Database['public']['Enums']['tipo_movimiento'];
          usuario_id?: string | null;
        };
        Update: {
          cantidad?: number;
          created_at?: string;
          id?: string;
          motivo?: string | null;
          producto_id?: string;
          referencia_id?: string | null;
          referencia_tipo?: Database['public']['Enums']['referencia_tipo'] | null;
          stock_anterior?: number;
          stock_posterior?: number;
          tenant_id?: string;
          tipo?: Database['public']['Enums']['tipo_movimiento'];
          usuario_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'movimiento_producto_id_fkey';
            columns: ['producto_id'];
            isOneToOne: false;
            referencedRelation: 'producto';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'movimiento_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'movimiento_usuario_id_fkey';
            columns: ['usuario_id'];
            isOneToOne: false;
            referencedRelation: 'usuario';
            referencedColumns: ['id'];
          },
        ];
      };
      mp_point_config: {
        Row: {
          access_token: string | null;
          created_at: string;
          device_id: string | null;
          habilitado: boolean;
          id: string;
          tenant_id: string;
          updated_at: string;
          webhook_secret: string | null;
        };
        Insert: {
          access_token?: string | null;
          created_at?: string;
          device_id?: string | null;
          habilitado?: boolean;
          id?: string;
          tenant_id: string;
          updated_at?: string;
          webhook_secret?: string | null;
        };
        Update: {
          access_token?: string | null;
          created_at?: string;
          device_id?: string | null;
          habilitado?: boolean;
          id?: string;
          tenant_id?: string;
          updated_at?: string;
          webhook_secret?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'mp_point_config_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: true;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
        ];
      };
      pedido: {
        Row: {
          cliente_id: string | null;
          comprobante_id: string | null;
          created_at: string;
          estado: Database['public']['Enums']['estado_pedido'];
          fecha: string;
          id: string;
          notas: string | null;
          tenant_id: string;
          total: number;
          updated_at: string;
          usuario_id: string | null;
        };
        Insert: {
          cliente_id?: string | null;
          comprobante_id?: string | null;
          created_at?: string;
          estado?: Database['public']['Enums']['estado_pedido'];
          fecha?: string;
          id?: string;
          notas?: string | null;
          tenant_id: string;
          total?: number;
          updated_at?: string;
          usuario_id?: string | null;
        };
        Update: {
          cliente_id?: string | null;
          comprobante_id?: string | null;
          created_at?: string;
          estado?: Database['public']['Enums']['estado_pedido'];
          fecha?: string;
          id?: string;
          notas?: string | null;
          tenant_id?: string;
          total?: number;
          updated_at?: string;
          usuario_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'pedido_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'cliente';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pedido_comprobante_id_fkey';
            columns: ['comprobante_id'];
            isOneToOne: false;
            referencedRelation: 'comprobante';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pedido_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pedido_usuario_id_fkey';
            columns: ['usuario_id'];
            isOneToOne: false;
            referencedRelation: 'usuario';
            referencedColumns: ['id'];
          },
        ];
      };
      pedido_item: {
        Row: {
          cantidad: number;
          created_at: string;
          id: string;
          pedido_id: string;
          precio_unitario: number;
          producto_id: string;
          subtotal: number;
        };
        Insert: {
          cantidad: number;
          created_at?: string;
          id?: string;
          pedido_id: string;
          precio_unitario: number;
          producto_id: string;
          subtotal: number;
        };
        Update: {
          cantidad?: number;
          created_at?: string;
          id?: string;
          pedido_id?: string;
          precio_unitario?: number;
          producto_id?: string;
          subtotal?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'pedido_item_pedido_id_fkey';
            columns: ['pedido_id'];
            isOneToOne: false;
            referencedRelation: 'pedido';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pedido_item_producto_id_fkey';
            columns: ['producto_id'];
            isOneToOne: false;
            referencedRelation: 'producto';
            referencedColumns: ['id'];
          },
        ];
      };
      pago: {
        Row: {
          id: string;
          tenant_id: string;
          cliente_id: string;
          cuenta_id: string;
          comprobante_id: string | null;
          monto: number;
          tipo_pago: Database['public']['Enums']['tipo_pago'];
          referencia: string | null;
          notas: string | null;
          fecha: string;
          usuario_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          cliente_id: string;
          cuenta_id: string;
          comprobante_id?: string | null;
          monto: number;
          tipo_pago?: Database['public']['Enums']['tipo_pago'];
          referencia?: string | null;
          notas?: string | null;
          fecha?: string;
          usuario_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          cliente_id?: string;
          cuenta_id?: string;
          comprobante_id?: string | null;
          monto?: number;
          tipo_pago?: Database['public']['Enums']['tipo_pago'];
          referencia?: string | null;
          notas?: string | null;
          fecha?: string;
          usuario_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pago_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pago_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'cliente';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pago_cuenta_id_fkey';
            columns: ['cuenta_id'];
            isOneToOne: false;
            referencedRelation: 'cuenta_corriente';
            referencedColumns: ['id'];
          },
        ];
      };
      precio_historial: {
        Row: {
          created_at: string;
          id: string;
          margen_anterior: number | null;
          margen_nuevo: number | null;
          origen: Database['public']['Enums']['origen_precio'];
          precio_costo_anterior: number | null;
          precio_costo_nuevo: number | null;
          precio_venta_anterior: number | null;
          precio_venta_nuevo: number | null;
          producto_id: string;
          tenant_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          margen_anterior?: number | null;
          margen_nuevo?: number | null;
          origen?: Database['public']['Enums']['origen_precio'];
          precio_costo_anterior?: number | null;
          precio_costo_nuevo?: number | null;
          precio_venta_anterior?: number | null;
          precio_venta_nuevo?: number | null;
          producto_id: string;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          margen_anterior?: number | null;
          margen_nuevo?: number | null;
          origen?: Database['public']['Enums']['origen_precio'];
          precio_costo_anterior?: number | null;
          precio_costo_nuevo?: number | null;
          precio_venta_anterior?: number | null;
          precio_venta_nuevo?: number | null;
          producto_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'precio_historial_producto_id_fkey';
            columns: ['producto_id'];
            isOneToOne: false;
            referencedRelation: 'producto';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'precio_historial_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
        ];
      };
      producto: {
        Row: {
          activo: boolean;
          categoria_id: string | null;
          codigo: string;
          codigo_barras: string | null;
          created_at: string;
          descripcion: string | null;
          es_pesable: boolean;
          fecha_vencimiento: string | null;
          id: string;
          imagen_url: string | null;
          iva_porcentaje: number | null;
          moneda: string;
          nombre: string;
          plu: string | null;
          porcentaje_ganancia: number | null;
          precio_costo: number;
          precio_venta: number;
          proveedor_id: string | null;
          rubro: string | null;
          stock_actual: number;
          stock_minimo: number;
          subrubro: string | null;
          tenant_id: string;
          ubicacion: string | null;
          unidad: Database['public']['Enums']['unidad_medida'];
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          categoria_id?: string | null;
          codigo: string;
          codigo_barras?: string | null;
          created_at?: string;
          descripcion?: string | null;
          es_pesable?: boolean;
          fecha_vencimiento?: string | null;
          id?: string;
          imagen_url?: string | null;
          iva_porcentaje?: number | null;
          moneda?: string;
          nombre: string;
          plu?: string | null;
          porcentaje_ganancia?: number | null;
          precio_costo?: number;
          precio_venta?: number;
          proveedor_id?: string | null;
          rubro?: string | null;
          stock_actual?: number;
          stock_minimo?: number;
          subrubro?: string | null;
          tenant_id: string;
          ubicacion?: string | null;
          unidad?: Database['public']['Enums']['unidad_medida'];
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          categoria_id?: string | null;
          codigo?: string;
          codigo_barras?: string | null;
          created_at?: string;
          descripcion?: string | null;
          es_pesable?: boolean;
          fecha_vencimiento?: string | null;
          id?: string;
          imagen_url?: string | null;
          iva_porcentaje?: number | null;
          moneda?: string;
          nombre?: string;
          plu?: string | null;
          porcentaje_ganancia?: number | null;
          precio_costo?: number;
          precio_venta?: number;
          proveedor_id?: string | null;
          rubro?: string | null;
          stock_actual?: number;
          stock_minimo?: number;
          subrubro?: string | null;
          tenant_id?: string;
          ubicacion?: string | null;
          unidad?: Database['public']['Enums']['unidad_medida'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'producto_categoria_id_fkey';
            columns: ['categoria_id'];
            isOneToOne: false;
            referencedRelation: 'categoria';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'producto_proveedor_id_fkey';
            columns: ['proveedor_id'];
            isOneToOne: false;
            referencedRelation: 'proveedor';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'producto_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
        ];
      };
      producto_proveedor: {
        Row: {
          codigo_proveedor: string | null;
          created_at: string;
          id: string;
          precio_costo: number;
          producto_id: string;
          proveedor_id: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          codigo_proveedor?: string | null;
          created_at?: string;
          id?: string;
          precio_costo?: number;
          producto_id: string;
          proveedor_id: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          codigo_proveedor?: string | null;
          created_at?: string;
          id?: string;
          precio_costo?: number;
          producto_id?: string;
          proveedor_id?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'producto_proveedor_producto_id_fkey';
            columns: ['producto_id'];
            isOneToOne: false;
            referencedRelation: 'producto';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'producto_proveedor_proveedor_id_fkey';
            columns: ['proveedor_id'];
            isOneToOne: false;
            referencedRelation: 'proveedor';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'producto_proveedor_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
        ];
      };
      radar_inflacion: {
        Row: {
          id: string;
          rubro: string;
          proveedor_nombre: string;
          periodo: string;
          variacion_pct: number;
          cantidad_items: number;
          contribuciones: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          rubro: string;
          proveedor_nombre: string;
          periodo: string;
          variacion_pct?: number;
          cantidad_items?: number;
          contribuciones?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          rubro?: string;
          proveedor_nombre?: string;
          periodo?: string;
          variacion_pct?: number;
          cantidad_items?: number;
          contribuciones?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      proveedor: {
        Row: {
          activo: boolean;
          created_at: string;
          cuit: string | null;
          direccion: string | null;
          email: string | null;
          id: string;
          mapeo_excel: Json | null;
          nombre: string;
          notas: string | null;
          telefono: string | null;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          created_at?: string;
          cuit?: string | null;
          direccion?: string | null;
          email?: string | null;
          id?: string;
          mapeo_excel?: Json | null;
          nombre: string;
          notas?: string | null;
          telefono?: string | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          created_at?: string;
          cuit?: string | null;
          direccion?: string | null;
          email?: string | null;
          id?: string;
          mapeo_excel?: Json | null;
          nombre?: string;
          notas?: string | null;
          telefono?: string | null;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'proveedor_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
        ];
      };
      tenant: {
        Row: {
          activo: boolean;
          condicion_iva: Database['public']['Enums']['condicion_iva'] | null;
          created_at: string;
          cuit: string | null;
          domicilio: string | null;
          email: string | null;
          horarios_atencion: string | null;
          id: string;
          iva_porcentaje_default: number;
          logo_url: string | null;
          nombre: string;
          plan: Database['public']['Enums']['plan_tipo'];
          punto_de_venta: number;
          razon_social: string | null;
          telefono: string | null;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          condicion_iva?: Database['public']['Enums']['condicion_iva'] | null;
          created_at?: string;
          cuit?: string | null;
          domicilio?: string | null;
          email?: string | null;
          horarios_atencion?: string | null;
          id?: string;
          iva_porcentaje_default?: number;
          logo_url?: string | null;
          nombre: string;
          plan?: Database['public']['Enums']['plan_tipo'];
          punto_de_venta?: number;
          razon_social?: string | null;
          telefono?: string | null;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          condicion_iva?: Database['public']['Enums']['condicion_iva'] | null;
          created_at?: string;
          cuit?: string | null;
          domicilio?: string | null;
          email?: string | null;
          horarios_atencion?: string | null;
          id?: string;
          iva_porcentaje_default?: number;
          logo_url?: string | null;
          nombre?: string;
          plan?: Database['public']['Enums']['plan_tipo'];
          punto_de_venta?: number;
          razon_social?: string | null;
          telefono?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      super_admin_contexto_log: {
        Row: {
          created_at: string;
          id: string;
          tenant_id_next: string | null;
          tenant_id_prev: string | null;
          usuario_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          tenant_id_next?: string | null;
          tenant_id_prev?: string | null;
          usuario_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          tenant_id_next?: string | null;
          tenant_id_prev?: string | null;
          usuario_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'super_admin_contexto_log_usuario_id_fkey';
            columns: ['usuario_id'];
            isOneToOne: false;
            referencedRelation: 'usuario';
            referencedColumns: ['id'];
          },
        ];
      };
      super_admin_tenant_acceso: {
        Row: {
          created_at: string;
          tenant_id: string;
          usuario_id: string;
        };
        Insert: {
          created_at?: string;
          tenant_id: string;
          usuario_id: string;
        };
        Update: {
          created_at?: string;
          tenant_id?: string;
          usuario_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'super_admin_tenant_acceso_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'super_admin_tenant_acceso_usuario_id_fkey';
            columns: ['usuario_id'];
            isOneToOne: false;
            referencedRelation: 'usuario';
            referencedColumns: ['id'];
          },
        ];
      };
      usuario: {
        Row: {
          activo: boolean;
          apellido: string;
          created_at: string;
          email: string;
          es_super_admin: boolean;
          id: string;
          nombre: string;
          rol: Database['public']['Enums']['rol_usuario'];
          tenant_contexto_id: string | null;
          tenant_id: string;
        };
        Insert: {
          activo?: boolean;
          apellido: string;
          created_at?: string;
          email: string;
          es_super_admin?: boolean;
          id: string;
          nombre: string;
          rol?: Database['public']['Enums']['rol_usuario'];
          tenant_contexto_id?: string | null;
          tenant_id: string;
        };
        Update: {
          activo?: boolean;
          apellido?: string;
          created_at?: string;
          email?: string;
          es_super_admin?: boolean;
          id?: string;
          nombre?: string;
          rol?: Database['public']['Enums']['rol_usuario'];
          tenant_contexto_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'usuario_tenant_contexto_id_fkey';
            columns: ['tenant_contexto_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usuario_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenant';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      super_admin_set_tenant_contexto: {
        Args: { p_tenant_id: string | null };
        Returns: undefined;
      };
      activar_plan: {
        Args: { p_plan: Database['public']['Enums']['plan_tipo']; p_tenant_id: string };
        Returns: undefined;
      };
      registrar_movimiento: {
        Args: {
          p_cantidad: number;
          p_motivo?: string | null;
          p_permitir_stock_negativo?: boolean;
          p_producto_id: string;
          p_referencia_id?: string | null;
          p_referencia_tipo?: Database['public']['Enums']['referencia_tipo'] | null;
          p_tenant_id: string;
          p_tipo: Database['public']['Enums']['tipo_movimiento'];
          p_usuario_id?: string | null;
        };
        Returns: Database['public']['Tables']['movimiento']['Row'];
      };
      contribuir_radar: {
        Args: {
          p_rubro: string;
          p_proveedor_nombre: string;
          p_periodo: string;
          p_variacion_pct: number;
          p_cantidad_items?: number;
        };
        Returns: undefined;
      };
      registrar_pago: {
        Args: {
          p_tenant_id: string;
          p_cliente_id: string;
          p_monto: number;
          p_tipo_pago?: Database['public']['Enums']['tipo_pago'];
          p_comprobante_id?: string | null;
          p_referencia?: string | null;
          p_notas?: string | null;
          p_usuario_id?: string | null;
        };
        Returns: Database['public']['Tables']['pago']['Row'];
      };
      siguiente_numero_comprobante: {
        Args: {
          p_tenant_id: string;
          p_tipo: Database['public']['Enums']['tipo_comprobante'];
        };
        Returns: number;
      };
      siguiente_numero_orden: {
        Args: {
          p_tenant_id: string;
        };
        Returns: number;
      };
    };
    Enums: {
      arca_ambiente: 'homologacion' | 'produccion';
      condicion_iva:
        | 'responsable_inscripto'
        | 'monotributista'
        | 'exento'
        | 'consumidor_final';
      estado_comprobante:
        | 'borrador'
        | 'emitido'
        | 'pendiente_arca'
        | 'pendiente_posnet'
        | 'error_arca'
        | 'anulado';
      estado_lista_precios:
        | 'pendiente'
        | 'analizada'
        | 'aplicada_total'
        | 'aplicada_parcial'
        | 'archivada'
        | 'error';
      estado_pedido: 'borrador' | 'confirmado' | 'entregado' | 'cancelado';
      origen_precio: 'manual' | 'importacion_excel' | 'ia_pdf' | 'lista_precios';
      plan_tipo: 'base' | 'completo';
      referencia_tipo: 'factura' | 'pedido' | 'importacion' | 'manual' | 'ajuste_inventario';
      rol_usuario: 'admin' | 'operador' | 'visor';
      tipo_pago: 'efectivo' | 'transferencia' | 'cheque' | 'tarjeta' | 'otro';
      tipo_comprobante:
        | 'factura_a'
        | 'factura_b'
        | 'factura_c'
        | 'nota_credito_a'
        | 'nota_credito_b'
        | 'nota_credito_c'
        | 'remito'
        | 'presupuesto'
        | 'ticket';
      tipo_movimiento: 'entrada' | 'salida' | 'ajuste';
      unidad_medida: 'unidad' | 'kg' | 'litro' | 'metro' | 'caja' | 'pack' | 'gramo' | 'ml';
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (Database['public']['Tables'] & Database['public']['Views'])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions['schema']]['Tables'] &
        Database[PublicTableNameOrOptions['schema']]['Views'])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions['schema']]['Tables'] &
      Database[PublicTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (Database['public']['Tables'] &
        Database['public']['Views'])
    ? (Database['public']['Tables'] &
        Database['public']['Views'])[PublicTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;
