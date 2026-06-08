'use client';

const ID_SAFE = /^[a-zA-Z][\w-]*$/;

type Props = {
  /** Id del contenedor a imprimir (ej. `print-zone`). Solo caracteres alfanuméricos, guiones y underscore; debe empezar con letra. */
  printZoneId: string;
};

export function EtiquetaPrintGlobalStyles({ printZoneId }: Props) {
  if (!ID_SAFE.test(printZoneId)) {
    throw new Error('EtiquetaPrintGlobalStyles: printZoneId inválido');
  }

  return (
    <style jsx global>{`
      @media print {
        body * {
          visibility: hidden;
        }
        #${printZoneId},
        #${printZoneId} * {
          visibility: visible;
        }
        #${printZoneId} {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
        }
        .print-hidden {
          display: none !important;
        }
        .print-label {
          page-break-inside: avoid;
          break-inside: avoid;
        }
      }
    `}</style>
  );
}
