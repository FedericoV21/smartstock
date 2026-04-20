export function getEndpoints(ambiente: 'homologacion' | 'produccion') {
  if (ambiente === 'produccion') {
    return {
      wsaa: 'https://wsaa.afip.gob.ar/ws/services/LoginCms',
      wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
    };
  }
  return {
    wsaa: 'https://wsaahomo.afip.gob.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  };
}
