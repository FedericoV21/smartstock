import { redirect } from 'next/navigation';

/**
 * El clon de productos se hace desde el listado (selección + modal), no desde una ruta dedicada.
 */
export default function ClonarSucursalRedirectPage() {
  redirect('/productos');
}
