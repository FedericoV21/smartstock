import type { MpTransferenciaReportConfigPayload } from '../mp-transferencia-api.client';

export const COLUMNAS_TRANSFERENCIA_MP = [
  'SOURCE_ID',
  'TRANSACTION_DATE',
  'SETTLEMENT_DATE',
  'TRANSACTION_AMOUNT',
  'SETTLEMENT_NET_AMOUNT',
  'TRANSACTION_CURRENCY',
  'SETTLEMENT_CURRENCY',
  'TRANSACTION_TYPE',
  'PAYMENT_METHOD',
  'PAYMENT_METHOD_TYPE',
  'DESCRIPTION',
  'PAYER_NAME',
  'PAYER_ID_NUMBER',
  'PAY_BANK_TRANSFER_ID',
  'PURCHASE_ID',
  'ORDER_MP',
  'TRANSACTION_INTENT_ID',
] as const;

export function payloadConfigReportesMp(): MpTransferenciaReportConfigPayload {
  return {
    file_name_prefix: 'smartstock-transferencias-mp',
    columns: COLUMNAS_TRANSFERENCIA_MP.map((key) => ({ key })),
    frequency: {
      type: 'monthly',
      value: 1,
      hour: 0,
    },
    separator: ',',
    display_timezone: 'GMT-03',
    report_translation: 'en',
    header_language: 'en',
    scheduled: false,
    include_withdraw: false,
    refund_detailed: false,
    shipping_detail: false,
    coupon_detailed: false,
    show_chargeback_cancel: false,
    show_fee_prevision: false,
  };
}
