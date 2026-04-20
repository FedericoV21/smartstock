'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { USUARIOS_MAX_POR_TENANT } from '@/lib/limits';

type UsuarioRow = {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: string;
  activo: boolean;
  created_at: string;
};

const ROL_LABEL: Record<string, string> = {
  admin: 'Administrador',
  operador: 'Operador',
  visor: 'Visor',
};

export default function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<UsuarioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [rolInvite, setRolInvite] = useState<'operador' | 'visor'>('operador');
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/configuracion/usuarios');
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? 'Error al cargar');
      setUsuarios([]);
    } else {
      setError(null);
      setUsuarios(json.usuarios ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const usuariosActivos = usuarios.filter((u) => u.activo).length;
  const limiteUsuarios = usuariosActivos >= USUARIOS_MAX_POR_TENANT;

  async function invitar() {
    setInviting(true);
    setError(null);
    const res = await fetch('/api/configuracion/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, nombre, apellido, rol: rolInvite }),
    });
    const json = await res.json();
    setInviting(false);
    if (!res.ok) {
      setError(json.error ?? 'Error al invitar');
      return;
    }
    setEmail('');
    setNombre('');
    setApellido('');
    void load();
  }

  async function actualizarUsuario(id: string, patch: { rol?: string; activo?: boolean }) {
    setError(null);
    const res = await fetch(`/api/configuracion/usuarios/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? 'Error al guardar');
      return;
    }
    void load();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 overflow-x-hidden">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usuarios del negocio</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Invitá operadores o visores por correo. Recibirán un enlace para ingresar.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <section className="rounded-xl border bg-card p-4 shadow-sm md:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Invitar usuario</h2>
          <span className="text-xs text-muted-foreground">
            {usuariosActivos} / {USUARIOS_MAX_POR_TENANT} usuarios activos
          </span>
        </div>
        {limiteUsuarios ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Llegaste al máximo de {USUARIOS_MAX_POR_TENANT} usuarios activos. Desactivá a alguien en
            la tabla para liberar un cupo e invitar a otra persona.
          </p>
        ) : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Input
            type="email"
            placeholder="Correo"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            disabled={limiteUsuarios}
          />
          <Select
            value={rolInvite}
            onValueChange={(v) => setRolInvite(v as 'operador' | 'visor')}
            disabled={limiteUsuarios}
          >
            <SelectTrigger>
              <SelectValue placeholder="Rol" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="operador">Operador</SelectItem>
              <SelectItem value="visor">Visor</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            disabled={limiteUsuarios}
          />
          <Input
            placeholder="Apellido"
            value={apellido}
            onChange={(e) => setApellido(e.target.value)}
            disabled={limiteUsuarios}
          />
        </div>
        <Button
          type="button"
          className="mt-4"
          disabled={
            limiteUsuarios || inviting || !email.trim() || !nombre.trim() || !apellido.trim()
          }
          onClick={() => void invitar()}
        >
          {inviting ? 'Enviando…' : 'Enviar invitación'}
        </Button>
      </section>

      <section className="rounded-xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Correo</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    Cargando…
                  </TableCell>
                </TableRow>
              ) : usuarios.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No hay usuarios
                  </TableCell>
                </TableRow>
              ) : (
                usuarios.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.nombre} {u.apellido}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">{u.email}</TableCell>
                    <TableCell>
                      <Select
                        value={u.rol ?? 'visor'}
                        onValueChange={(newRol) => {
                          if (newRol) void actualizarUsuario(u.id, { rol: newRol });
                        }}
                        disabled={u.rol === 'admin'}
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Administrador</SelectItem>
                          <SelectItem value="operador">Operador</SelectItem>
                          <SelectItem value="visor">Visor</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>{u.activo ? 'Activo' : 'Inactivo'}</TableCell>
                    <TableCell className="text-right">
                      {u.rol !== 'admin' ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void actualizarUsuario(u.id, { activo: !u.activo })
                          }
                        >
                          {u.activo ? 'Desactivar' : 'Activar'}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Leyenda de roles: {ROL_LABEL.admin}, {ROL_LABEL.operador}, {ROL_LABEL.visor}.
      </p>
    </div>
  );
}
