export type DespiecePlantillaPredeterminada = {
  slug: string;
  nombre: string;
  padre: {
    codigo: string;
    nombre: string;
    costoKg: number;
    pesoTotalKg: number;
  };
  unidadBase?: {
    tipo: 'unidad';
    nombre: string;
    cantidad: number;
    contenedorNombre?: string | null;
    unidadesPorContenedor?: number | null;
  };
  rentabilidadObjetivoPct: number;
  cortes: Array<{
    codigo: string;
    nombre: string;
    kgRendimiento: number;
    factorAjustePct: number;
    precioAnclado: number | null;
  }>;
};

export const PLANTILLAS_DESPIECE_PREDETERMINADAS: DespiecePlantillaPredeterminada[] = [
  {
    slug: 'media-cerdo-reyes',
    nombre: 'Media de cerdo - plantilla base',
    padre: { codigo: 'DESP-CERDO-PADRE', nombre: 'MEDIA DE CERDO', costoKg: 2900, pesoTotalKg: 47 },
    rentabilidadObjetivoPct: 50,
    cortes: [
      { codigo: 'DESP-CERDO-MATAMBRE', nombre: 'Matambre de cerdo', kgRendimiento: 1.65, factorAjustePct: 0.8055555, precioAnclado: 8500 },
      { codigo: 'DESP-CERDO-VACIO', nombre: 'Vacío de cerdo', kgRendimiento: 1.675, factorAjustePct: 0.6664, precioAnclado: 7000 },
      { codigo: 'DESP-CERDO-COSTILLAR', nombre: 'Costillar de cerdo', kgRendimiento: 5.33, factorAjustePct: 0.3887, precioAnclado: 6500 },
      { codigo: 'DESP-CERDO-PALETA', nombre: 'Paleta de cerdo s/p', kgRendimiento: 6.2, factorAjustePct: 0.1109, precioAnclado: 4800 },
      { codigo: 'DESP-CERDO-BONDIOLA', nombre: 'Bondiola s/h', kgRendimiento: 2.7, factorAjustePct: 0.8053, precioAnclado: 8000 },
      { codigo: 'DESP-CERDO-JAMON', nombre: 'Jamón s/h', kgRendimiento: 11.1, factorAjustePct: 0.3887, precioAnclado: 6500 },
      { codigo: 'DESP-CERDO-CARRE', nombre: 'Carré sin cuero', kgRendimiento: 6.6, factorAjustePct: 0.3331, precioAnclado: 6500 },
      { codigo: 'DESP-CERDO-PATITA', nombre: 'Patita de cerdo', kgRendimiento: 0.6, factorAjustePct: -0.5, precioAnclado: 1000 },
      { codigo: 'DESP-CERDO-RECORTE', nombre: 'Recorte y papada', kgRendimiento: 2, factorAjustePct: -0.1, precioAnclado: 5200 },
    ],
  },
  {
    slug: 'cajon-pollo-7',
    nombre: 'Cajon de pollo - 7 pollos',
    padre: { codigo: 'DESP-POLLO-PADRE', nombre: 'CAJON DE POLLO', costoKg: 2666.67, pesoTotalKg: 18 },
    unidadBase: {
      tipo: 'unidad',
      nombre: 'pollos',
      cantidad: 7,
      contenedorNombre: 'cajon',
      unidadesPorContenedor: 7,
    },
    rentabilidadObjetivoPct: 70,
    cortes: [
      { codigo: 'DESP-POLLO-PATA-MUSLO', nombre: 'Pata y muslo', kgRendimiento: 7.6, factorAjustePct: -0.04, precioAnclado: null },
      { codigo: 'DESP-POLLO-SUPREMA', nombre: 'Supremas', kgRendimiento: 5.2, factorAjustePct: 1.9, precioAnclado: null },
      { codigo: 'DESP-POLLO-ALITA', nombre: 'Alitas', kgRendimiento: 2.9, factorAjustePct: -0.5, precioAnclado: null },
      { codigo: 'DESP-POLLO-CARCOSA', nombre: 'Carcosa', kgRendimiento: 0.5, factorAjustePct: -0.63, precioAnclado: null },
      { codigo: 'DESP-POLLO-MENUDO', nombre: 'Menudos', kgRendimiento: 0.9, factorAjustePct: -0.63, precioAnclado: null },
      { codigo: 'DESP-POLLO-PIEL-DESP', nombre: 'Piel / desperdicios', kgRendimiento: 0.9, factorAjustePct: -0.8, precioAnclado: null },
    ],
  },
  {
    slug: 'media-vacuna-reyes',
    nombre: 'Media vacuna - plantilla base',
    padre: { codigo: 'DESP-VACUNO-PADRE', nombre: 'MEDIA VACUNA', costoKg: 6400, pesoTotalKg: 118 },
    rentabilidadObjetivoPct: 20,
    cortes: [
      { codigo: 'DESP-VACUNO-ARANITA', nombre: 'Arañita', kgRendimiento: 0.5, factorAjustePct: 0.3185, precioAnclado: 11000 },
      { codigo: 'DESP-VACUNO-ASADO', nombre: 'Asado', kgRendimiento: 10.35, factorAjustePct: 0.397, precioAnclado: 9900 },
      { codigo: 'DESP-VACUNO-ASADO-PUNTA', nombre: 'Asado punta', kgRendimiento: 3.45, factorAjustePct: 0.3966265060240961, precioAnclado: 7800 },
      { codigo: 'DESP-VACUNO-BIFE-ANCHO', nombre: 'Bife ancho', kgRendimiento: 4.42, factorAjustePct: 0.10566265060240942, precioAnclado: 9530 },
      { codigo: 'DESP-VACUNO-BIFE-ANGOSTO', nombre: 'Bife angosto', kgRendimiento: 10.74, factorAjustePct: 0.10566265060240942, precioAnclado: 9530 },
      { codigo: 'DESP-VACUNO-BOLA-LOMO', nombre: 'Bola de lomo', kgRendimiento: 3.84, factorAjustePct: 0.43542168674698756, precioAnclado: 11000 },
      { codigo: 'DESP-VACUNO-CHIQUIZUELA', nombre: 'Chiquizuela', kgRendimiento: 0.55, factorAjustePct: -0.06891566265060256, precioAnclado: 2000 },
      { codigo: 'DESP-VACUNO-COLITA', nombre: 'Colita de cuadril', kgRendimiento: 1.4, factorAjustePct: 0.5130120481927707, precioAnclado: 12000 },
      { codigo: 'DESP-VACUNO-CUADRADA', nombre: 'Cuadrada', kgRendimiento: 3.8, factorAjustePct: 0.47421686746987923, precioAnclado: 11000 },
      { codigo: 'DESP-VACUNO-CUADRIL', nombre: 'Cuadril', kgRendimiento: 3.6, factorAjustePct: 0.5130120481927707, precioAnclado: 11000 },
      { codigo: 'DESP-VACUNO-ENTRANA', nombre: 'Entraña', kgRendimiento: 0.54, factorAjustePct: 0.5324096385542165, precioAnclado: 14000 },
      { codigo: 'DESP-VACUNO-ESPINAZO', nombre: 'Espinazo p.', kgRendimiento: 1.425, factorAjustePct: -0.6120481927710844, precioAnclado: 2000 },
      { codigo: 'DESP-VACUNO-FALDA', nombre: 'Falda', kgRendimiento: 3.2, factorAjustePct: 0.06686746987951775, precioAnclado: 7800 },
      { codigo: 'DESP-VACUNO-LOMO', nombre: 'Lomo', kgRendimiento: 1.91, factorAjustePct: 0.5906024096385538, precioAnclado: 12500 },
      { codigo: 'DESP-VACUNO-MATAMBRE', nombre: 'Matambre', kgRendimiento: 1.45, factorAjustePct: 0.319036144578313, precioAnclado: 10000 },
      { codigo: 'DESP-VACUNO-NALGA', nombre: 'Nalga', kgRendimiento: 4.86, factorAjustePct: 0.5906024096385538, precioAnclado: 11500 },
      { codigo: 'DESP-VACUNO-OSOBUCO', nombre: 'Osobuco', kgRendimiento: 4.675, factorAjustePct: -0.06891566265060256, precioAnclado: 7500 },
      { codigo: 'DESP-VACUNO-PALETA', nombre: 'Paleta', kgRendimiento: 5, factorAjustePct: 0.3966265060240961, precioAnclado: 11000 },
      { codigo: 'DESP-VACUNO-PALOMITA', nombre: 'Palomita', kgRendimiento: 5, factorAjustePct: 0.3966265060240961, precioAnclado: 11000 },
      { codigo: 'DESP-VACUNO-PECETO', nombre: 'Peceto', kgRendimiento: 1.96, factorAjustePct: 0.5906024096385538, precioAnclado: 11500 },
      { codigo: 'DESP-VACUNO-PUNTA-FALDA', nombre: 'Punta de falda', kgRendimiento: 1.76, factorAjustePct: -0.7090361445783133, precioAnclado: 2000 },
      { codigo: 'DESP-VACUNO-PICADA', nombre: 'Picada', kgRendimiento: 6.525, factorAjustePct: -0.12710843373493996, precioAnclado: 5887 },
      { codigo: 'DESP-VACUNO-ROAST-BEEF', nombre: 'Roast beef', kgRendimiento: 4.88, factorAjustePct: 0.37722891566265027, precioAnclado: 11000 },
      { codigo: 'DESP-VACUNO-TAPA-ASADO', nombre: 'Tapa de asado', kgRendimiento: 3.61, factorAjustePct: 0.3966265060240961, precioAnclado: 10000 },
      { codigo: 'DESP-VACUNO-TAPA-NALGA', nombre: 'Tapa de nalga', kgRendimiento: 1.6, factorAjustePct: 0.3966265060240961, precioAnclado: 10000 },
      { codigo: 'DESP-VACUNO-TORTUGUITA', nombre: 'Tortuguita', kgRendimiento: 1.54, factorAjustePct: 0.37722891566265027, precioAnclado: 10000 },
      { codigo: 'DESP-VACUNO-VACIO', nombre: 'Vacío', kgRendimiento: 5.425, factorAjustePct: 0.5518072289156624, precioAnclado: 12500 },
    ],
  },
  {
    slug: 'media-res-luz',
    nombre: 'Media Res / Luz',
    padre: { codigo: 'DESP-LUZ-PADRE', nombre: 'MEDIA RES / LUZ', costoKg: 10390, pesoTotalKg: 111 },
    rentabilidadObjetivoPct: 30.62,
    cortes: [
      { codigo: 'DESP-LUZ-ASADO', nombre: 'Asado', kgRendimiento: 11.5, factorAjustePct: 0.3919959420440653, precioAnclado: 15000 },
      { codigo: 'DESP-LUZ-VACIO', nombre: 'Vacío', kgRendimiento: 3.4, factorAjustePct: 0.6703951304528784, precioAnclado: 18000 },
      { codigo: 'DESP-LUZ-MATAMBRE', nombre: 'Matambre', kgRendimiento: 1.6, factorAjustePct: 0.8652745623390474, precioAnclado: 20100 },
      { codigo: 'DESP-LUZ-ENTRANA', nombre: 'Entraña', kgRendimiento: 0.425, factorAjustePct: 0.8745545352860078, precioAnclado: 20200 },
      { codigo: 'DESP-LUZ-OSOBUCO', nombre: 'Osobuco', kgRendimiento: 2.6, factorAjustePct: 0.2063964831048566, precioAnclado: 13000 },
      { codigo: 'DESP-LUZ-ROAST-BEEF', nombre: 'Roast beef', kgRendimiento: 5.2, factorAjustePct: 0.7167949951876804, precioAnclado: 18500 },
      { codigo: 'DESP-LUZ-CUADRIL', nombre: 'Cuadril', kgRendimiento: 2.7, factorAjustePct: 0.939514345914731, precioAnclado: 20900 },
      { codigo: 'DESP-LUZ-TORTUGUITA', nombre: 'Tortuguita', kgRendimiento: 1.4, factorAjustePct: 0.7446349140285617, precioAnclado: 18800 },
      { codigo: 'DESP-LUZ-PALOMITA', nombre: 'Palomita', kgRendimiento: 0.9, factorAjustePct: 0.791034778763364, precioAnclado: 19300 },
      { codigo: 'DESP-LUZ-COLITA-CUADRIL', nombre: 'Colita de cuadril', kgRendimiento: 0.9, factorAjustePct: 0.9673542647556121, precioAnclado: 21200 },
      { codigo: 'DESP-LUZ-BOLA-LOMO', nombre: 'Bola de lomo', kgRendimiento: 4.3, factorAjustePct: 0.9116744270738497, precioAnclado: 20600 },
      { codigo: 'DESP-LUZ-NALGA', nombre: 'Nalga', kgRendimiento: 4.5, factorAjustePct: 1.0787139401191377, precioAnclado: 22400 },
      { codigo: 'DESP-LUZ-TAPA-NALGA', nombre: 'Tapa de nalga', kgRendimiento: 1.7, factorAjustePct: 0.661115157505918, precioAnclado: 17900 },
      { codigo: 'DESP-LUZ-PECETO', nombre: 'Peceto', kgRendimiento: 1.6, factorAjustePct: 1.0972738860130584, precioAnclado: 22600 },
      { codigo: 'DESP-LUZ-PALETA', nombre: 'Paleta', kgRendimiento: 5.6, factorAjustePct: 0.791034778763364, precioAnclado: 19300 },
      { codigo: 'DESP-LUZ-CUADRADA', nombre: 'Cuadrada', kgRendimiento: 4.7, factorAjustePct: 0.9487943188616914, precioAnclado: 21000 },
      { codigo: 'DESP-LUZ-TAPA-ASADO', nombre: 'Tapa de asado', kgRendimiento: 2.3, factorAjustePct: 0.6796751033998387, precioAnclado: 18100 },
      { codigo: 'DESP-LUZ-LOMO', nombre: 'Lomo', kgRendimiento: 1.5, factorAjustePct: 1.0972738860130584, precioAnclado: 22600 },
      { codigo: 'DESP-LUZ-ESPINAZO', nombre: 'Espinazo', kgRendimiento: 4.2, factorAjustePct: 0.5033556174075906, precioAnclado: 16200 },
      { codigo: 'DESP-LUZ-FALDA', nombre: 'Falda', kgRendimiento: 3.2, factorAjustePct: 0.2063964831048566, precioAnclado: 13000 },
      { codigo: 'DESP-LUZ-BIFE', nombre: 'Bife', kgRendimiento: 11.1, factorAjustePct: 0.642555211611997, precioAnclado: 17700 },
      { codigo: 'DESP-LUZ-PICADA', nombre: 'Picada', kgRendimiento: 8, factorAjustePct: 0.6054353198241553, precioAnclado: 17300 },
      { codigo: 'DESP-LUZ-DESPERDICIO', nombre: 'Desperdicio', kgRendimiento: 23.7, factorAjustePct: -1, precioAnclado: 0 },
    ],
  },
  {
    slug: 'media-res-nt-nov25',
    nombre: 'Media res NT - noviembre 25',
    padre: { codigo: 'DESP-MR-NT-NOV25-PADRE', nombre: 'MEDIA RES NT NOV 25', costoKg: 3700, pesoTotalKg: 111 },
    rentabilidadObjetivoPct: 31.47,
    cortes: [
      { codigo: 'DESP-NT-PALETA', nombre: 'Paleta', kgRendimiento: 6.065, factorAjustePct: 0.506432432432432, precioAnclado: 5735 },
      { codigo: 'DESP-NT-ROAST-BEEF', nombre: 'Roast beef', kgRendimiento: 6.705, factorAjustePct: 0.469658144631117, precioAnclado: 5595 },
      { codigo: 'DESP-NT-PALOMITA', nombre: 'Palomita', kgRendimiento: 1.045, factorAjustePct: 0.590487947406866, precioAnclado: 6055 },
      { codigo: 'DESP-NT-TAPA-DE-ASADO', nombre: 'Tapa de asado', kgRendimiento: 4.5, factorAjustePct: 0.485418553688824, precioAnclado: 5655 },
      { codigo: 'DESP-NT-FALDA', nombre: 'Falda', kgRendimiento: 2.01, factorAjustePct: -0.160758217677137, precioAnclado: 3195 },
      { codigo: 'DESP-NT-GARRON', nombre: 'Garron', kgRendimiento: 5.92, factorAjustePct: -0.146311176040906, precioAnclado: 3250 },
      { codigo: 'DESP-NT-RECORTE', nombre: 'Recorte', kgRendimiento: 6.53, factorAjustePct: 0.312054054054054, precioAnclado: 4995 },
      { codigo: 'DESP-NT-GRASA', nombre: 'Grasa', kgRendimiento: 8.1, factorAjustePct: -0.960598977355734, precioAnclado: 150 },
      { codigo: 'DESP-NT-HUESO', nombre: 'Hueso', kgRendimiento: 9.58, factorAjustePct: -0.990806428049671, precioAnclado: 35 },
      { codigo: 'DESP-NT-ESPINAZO', nombre: 'Espinazo', kgRendimiento: 2.375, factorAjustePct: -0.645390796201607, precioAnclado: 1350 },
      { codigo: 'DESP-NT-NALGA-ST', nombre: 'Nalga s/t', kgRendimiento: 3.985, factorAjustePct: 1.23141124908692, precioAnclado: 8495 },
      { codigo: 'DESP-NT-TAPA-DE-NALGA', nombre: 'Tapa de nalga', kgRendimiento: 1.78, factorAjustePct: 0.469658144631117, precioAnclado: 5595 },
      { codigo: 'DESP-NT-CUADRADA', nombre: 'Cuadrada', kgRendimiento: 3.115, factorAjustePct: 0.819013878743608, precioAnclado: 6925 },
      { codigo: 'DESP-NT-BOLA-DE-LOMO', nombre: 'Bola de lomo', kgRendimiento: 4.015, factorAjustePct: 0.804566837107378, precioAnclado: 6870 },
      { codigo: 'DESP-NT-CUADRIL', nombre: 'Cuadril', kgRendimiento: 2.7, factorAjustePct: 0.798, precioAnclado: 6845 },
      { codigo: 'DESP-NT-PICANA', nombre: 'Picaña', kgRendimiento: 1.495, factorAjustePct: 1.26687216946676, precioAnclado: 8630 },
      { codigo: 'DESP-NT-COLITA-DE-CUADRIL', nombre: 'Colita de cuadril', kgRendimiento: 0.94, factorAjustePct: 1.33122717311907, precioAnclado: 8875 },
      { codigo: 'DESP-NT-PECETO', nombre: 'Peceto', kgRendimiento: 1.765, factorAjustePct: 1.25505186267348, precioAnclado: 8585 },
      { codigo: 'DESP-NT-TORTUGUITA', nombre: 'Tortuguita', kgRendimiento: 1.505, factorAjustePct: 0.469658144631117, precioAnclado: 5595 },
      { codigo: 'DESP-NT-BARRA-BIFE-SIN-LOMO', nombre: 'Barra bife sin lomo', kgRendimiento: 14.6, factorAjustePct: 0.51299926953981, precioAnclado: 5760 },
      { codigo: 'DESP-NT-LOMO', nombre: 'Lomo', kgRendimiento: 2.15, factorAjustePct: 2.07196639883126, precioAnclado: 11695 },
      { codigo: 'DESP-NT-ASADO', nombre: 'Asado', kgRendimiento: 10.6, factorAjustePct: 0.469658144631117, precioAnclado: 5595 },
      { codigo: 'DESP-NT-MATAMBRE', nombre: 'Matambre', kgRendimiento: 1.52, factorAjustePct: 0.648276113951789, precioAnclado: 6275 },
      { codigo: 'DESP-NT-VACIO', nombre: 'Vacío', kgRendimiento: 4.295, factorAjustePct: 0.930650109569028, precioAnclado: 7350 },
      { codigo: 'DESP-NT-ENTRANA', nombre: 'Entraña', kgRendimiento: 0.585, factorAjustePct: 2.112680788897, precioAnclado: 11850 },
    ],
  },
  {
    slug: 'media-res-res-nov25',
    nombre: 'Media res RES - noviembre 25',
    padre: { codigo: 'DESP-MR-RES-NOV25-PADRE', nombre: 'MEDIA RES RES NOV 25', costoKg: 10500, pesoTotalKg: 107 },
    rentabilidadObjetivoPct: 30.69,
    cortes: [
      { codigo: 'DESP-RES-NOV25-PALETA', nombre: 'Paleta', kgRendimiento: 4.83, factorAjustePct: 0.688712060525144, precioAnclado: 17000 },
      { codigo: 'DESP-RES-NOV25-ROAST-BEEF', nombre: 'Roast beef', kgRendimiento: 4.454, factorAjustePct: 0.639044058744993, precioAnclado: 16500 },
      { codigo: 'DESP-RES-NOV25-PALOMITA', nombre: 'Palomita', kgRendimiento: 0.8, factorAjustePct: 0.758247263017356, precioAnclado: 17700 },
      { codigo: 'DESP-RES-NOV25-TAPA-DE-ASADO', nombre: 'Tapa de asado', kgRendimiento: 3.3, factorAjustePct: 0.738380062305296, precioAnclado: 17500 },
      { codigo: 'DESP-RES-NOV25-FALDA', nombre: 'Falda', kgRendimiento: 3.12, factorAjustePct: 0.341036048064085, precioAnclado: 13500 },
      { codigo: 'DESP-RES-NOV25-OSOBUCO', nombre: 'Osobuco', kgRendimiento: 5.44, factorAjustePct: 0.172164842011571, precioAnclado: 11800 },
      { codigo: 'DESP-RES-NOV25-PICADA', nombre: 'Picada', kgRendimiento: 7.33, factorAjustePct: 0.370836849132176, precioAnclado: 13800 },
      { codigo: 'DESP-RES-NOV25-GRASA', nombre: 'Grasa', kgRendimiento: 20, factorAjustePct: -0.955298798397864, precioAnclado: 450 },
      { codigo: 'DESP-RES-NOV25-HUESO', nombre: 'Hueso', kgRendimiento: 10, factorAjustePct: -0.99006639964397, precioAnclado: 100 },
      { codigo: 'DESP-RES-NOV25-ESPINAZO', nombre: 'Espinazo', kgRendimiento: 2.43, factorAjustePct: -0.453651980418336, precioAnclado: 5500 },
      { codigo: 'DESP-RES-NOV25-NALGA-ST', nombre: 'Nalga s/t', kgRendimiento: 4.07, factorAjustePct: 1.23506008010681, precioAnclado: 22500 },
      { codigo: 'DESP-RES-NOV25-TAPA-DE-NALGA', nombre: 'Tapa de nalga', kgRendimiento: 1.59, factorAjustePct: 0.867516866933689, precioAnclado: 18800 },
      { codigo: 'DESP-RES-NOV25-CUADRADA', nombre: 'Cuadrada', kgRendimiento: 2.9, factorAjustePct: 0.788048064085447, precioAnclado: 18000 },
      { codigo: 'DESP-RES-NOV25-BOLA-DE-LOMO', nombre: 'Bola de lomo', kgRendimiento: 3.28, factorAjustePct: 0.788048064085447, precioAnclado: 18000 },
      { codigo: 'DESP-RES-NOV25-CUADRIL', nombre: 'Cuadril', kgRendimiento: 2.22, factorAjustePct: 1.23506008010681, precioAnclado: 22500 },
      { codigo: 'DESP-RES-NOV25-PICANA', nombre: 'Picaña', kgRendimiento: 1.45, factorAjustePct: 1.41386488651535, precioAnclado: 24300 },
      { codigo: 'DESP-RES-NOV25-COLITA-DE-CUADRIL', nombre: 'Colita de cuadril', kgRendimiento: 1.1, factorAjustePct: 1.43373208722741, precioAnclado: 24500 },
      { codigo: 'DESP-RES-NOV25-PECETO', nombre: 'Peceto', kgRendimiento: 1.5, factorAjustePct: 1.3641968847352, precioAnclado: 23800 },
      { codigo: 'DESP-RES-NOV25-TORTUGUITA', nombre: 'Tortuguita', kgRendimiento: 1.6, factorAjustePct: 0.668844859813084, precioAnclado: 16800 },
      { codigo: 'DESP-RES-NOV25-BIFE-ANGOSTO', nombre: 'Bife angosto', kgRendimiento: 5.9, factorAjustePct: 0.837716065865598, precioAnclado: 18500 },
      { codigo: 'DESP-RES-NOV25-BIFE-ANCHO', nombre: 'Bife ancho', kgRendimiento: 7.2, factorAjustePct: 0.768180863373387, precioAnclado: 17800 },
      { codigo: 'DESP-RES-NOV25-LOMO', nombre: 'Lomo', kgRendimiento: 1.5, factorAjustePct: 2.16881851357365, precioAnclado: 31900 },
      { codigo: 'DESP-RES-NOV25-ASADO', nombre: 'Asado', kgRendimiento: 6, factorAjustePct: 0.937052069425901, precioAnclado: 19500 },
      { codigo: 'DESP-RES-NOV25-MATAMBRE', nombre: 'Matambre', kgRendimiento: 1.34, factorAjustePct: 0.539708055184691, precioAnclado: 15500 },
      { codigo: 'DESP-RES-NOV25-VACIO', nombre: 'Vacío', kgRendimiento: 5.2, factorAjustePct: 1.23506008010681, precioAnclado: 22500 },
      { codigo: 'DESP-RES-NOV25-ENTRANA', nombre: 'Entraña', kgRendimiento: 0.55, factorAjustePct: 1.96021290609702, precioAnclado: 29800 },
      { codigo: 'DESP-RES-NOV25-ASADO-ORILLA', nombre: 'Asado orilla', kgRendimiento: 2.5, factorAjustePct: 0.837716065865598, precioAnclado: 18500 },
    ],
  },
  {
    slug: 'cajon-pollo-nov25',
    nombre: 'Cajon de pollo - noviembre 25',
    padre: { codigo: 'DESP-POLLO-NOV25-PADRE', nombre: 'CAJON DE POLLO NOV 25', costoKg: 70000 / 19, pesoTotalKg: 19 },
    unidadBase: {
      tipo: 'unidad',
      nombre: 'cajon',
      cantidad: 1,
      contenedorNombre: null,
      unidadesPorContenedor: null,
    },
    rentabilidadObjetivoPct: 41.23,
    cortes: [
      { codigo: 'DESP-POLLO-NOV25-SUPREMA', nombre: 'Suprema', kgRendimiento: 5.1, factorAjustePct: 2.17857142857143, precioAnclado: 12500 },
      { codigo: 'DESP-POLLO-NOV25-PATA-Y-MUSLO', nombre: 'Pata y muslo', kgRendimiento: 7, factorAjustePct: 0.00849714285714298, precioAnclado: 3966 },
      { codigo: 'DESP-POLLO-NOV25-ALITA', nombre: 'Alita', kgRendimiento: 2.7, factorAjustePct: -0.533894285714286, precioAnclado: 1833 },
      { codigo: 'DESP-POLLO-NOV25-MENUDO', nombre: 'Menudo', kgRendimiento: 3, factorAjustePct: -0.796571428571429, precioAnclado: 800 },
    ],
  },
];
