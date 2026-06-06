import { ProductoBarcodeTipo } from '../enums/producto-barcode-tipo.enum';

function isDigitsOnly(value: string): boolean {
  return /^\d+$/.test(value);
}

function hasValidMod10CheckDigit(value: string): boolean {
  const body = value.slice(0, -1);
  const check = Number(value.at(-1));

  let weightedSum = 0;
  for (let i = 0; i < body.length; i += 1) {
    const digit = Number(body[body.length - 1 - i]);
    weightedSum += digit * (i % 2 === 0 ? 3 : 1);
  }

  const expected = (10 - (weightedSum % 10)) % 10;
  return expected === check;
}

export function isValidEan13(value: string): boolean {
  return value.length === 13 && isDigitsOnly(value) && hasValidMod10CheckDigit(value);
}

export function isValidUpca(value: string): boolean {
  return value.length === 12 && isDigitsOnly(value) && hasValidMod10CheckDigit(value);
}

export function isValidItf14(value: string): boolean {
  return value.length === 14 && isDigitsOnly(value) && hasValidMod10CheckDigit(value);
}

export function inferBarcodeTipoByLength(value: string): ProductoBarcodeTipo {
  if (value.length === 12) return ProductoBarcodeTipo.UPCA;
  if (value.length === 13) return ProductoBarcodeTipo.EAN13;
  if (value.length === 14) return ProductoBarcodeTipo.ITF14;
  return ProductoBarcodeTipo.OTRO;
}

export function isValidBarcodeByTipo(tipo: ProductoBarcodeTipo, value: string): boolean {
  switch (tipo) {
    case ProductoBarcodeTipo.EAN13:
      return isValidEan13(value);
    case ProductoBarcodeTipo.UPCA:
      return isValidUpca(value);
    case ProductoBarcodeTipo.ITF14:
      return isValidItf14(value);
    case ProductoBarcodeTipo.OTRO:
      return value.length > 0;
    default:
      return false;
  }
}
