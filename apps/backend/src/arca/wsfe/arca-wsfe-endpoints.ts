import { ArcaAmbiente } from '../enums/arca-ambiente.enum';

export function getWsfeEndpoint(ambiente: ArcaAmbiente): string {
  if (ambiente === ArcaAmbiente.produccion) {
    return 'https://servicios1.afip.gov.ar/wsfev1/service.asmx';
  }
  return 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx';
}

export function getWsaaEndpoint(ambiente: ArcaAmbiente): string {
  if (ambiente === ArcaAmbiente.produccion) {
    return 'https://wsaa.afip.gob.ar/ws/services/LoginCms';
  }
  return 'https://wsaahomo.afip.gob.ar/ws/services/LoginCms';
}
