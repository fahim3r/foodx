// FoodX — Roles & Permissions page.
// System roles (12, vendor-defined) are read-only and shown from
// the code-level defaults in services/roles. A restaurant's own
// custom roles can be created, renamed, deleted and given
// permissions by admin-level users (migration 0029 backs this at
// the database level). Enforcement of the matrix is UI-level —
// see the honest note on the page.
import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Minus } from 'lucide-react'
import { isMissingTableError } from '@/lib/errors'
import { useAuth } from '@/hooks/useAuth'
import { usePermissions } from '@/hooks/usePermissions'
import {
  countRoleAssignments,
  createRole,
  deleteRole,
  DEFAULT_ROLE_PERMISSIONS,
  fetchPermissions,
  fetchRolePermissions,
  fetchRoles,
  renameRole,
  setRolePermission,
} from '@/services/roles'
import type { Permission, Role, RolePermission } from '@/types'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function RolesPage() {
  const { t } = useTranslation()
  const { restaurant } = useAuth()
  const { isAdminLevel } = usePermissions()
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'dbPending'>(
    'loading',
  )
  const [newRoleName, setNewRoleName] = useState('')
  const [creating, setCreating] = useState(false)
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)

  const load = async () => {
    const [rolesData, permissionsData, rolePermissionsData] = await Promise.all([
      fetchRoles(),
      fetchPermissions(),
      fetchRolePermissions(),
    ])
    setRoles(rolesData)
    setPermissions(permissionsData)
    setRolePermissions(rolePermissionsData)
  }

  useEffect(() => {
    let cancelled = false
    load()
      .then(() => {
        if (!cancelled) setState('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState(isMissingTableError(error) ? 'dbPending' : 'error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const granted = useMemo(() => {
    const set = new Set<string>()
    for (const row of rolePermissions) set.add(`${row.role_id}:${row.permission_id}`)
    return set
  }, [rolePermissions])

  const permissionByKey = useMemo(
    () => new Map(permissions.map((p) => [p.key, p])),
    [permissions],
  )

  const isGranted = (role: Role, permission: Permission): boolean => {
    if (role.is_system) {
      return (DEFAULT_ROLE_PERMISSIONS[role.name] ?? []).includes(permission.key)
    }
    return granted.has(`${role.id}:${permission.id}`)
  }

  const permissionsByModule = useMemo(() => {
    const groups = new Map<string, Permission[]>()
    for (const permission of permissions) {
      const list = groups.get(permission.module) ?? []
      list.push(permission)
      groups.set(permission.module, list)
    }
    return [...groups.entries()]
  }, [permissions])

  const handleCreateRole = async (event: FormEvent) => {
    event.preventDefault()
    if (!restaurant || !newRoleName.trim()) return
    setActionError(null)
    setCreating(true)
    try {
      await createRole(restaurant.id, newRoleName)
      setNewRoleName('')
      await load()
    } catch (error) {
      console.error('[Roles] create failed', error)
      setActionError('roles.saveFailed')
    } finally {
      setCreating(false)
    }
  }

  const handleRename = async (role: Role) => {
    const draft = (renameDrafts[role.id] ?? '').trim()
    if (!draft) return
    setActionError(null)
    try {
      await renameRole(role.id, draft)
      await load()
    } catch (error) {
      console.error('[Roles] rename failed', error)
      setActionError('roles.saveFailed')
    }
  }

  const handleDelete = async (role: Role) => {
    setActionError(null)
    try {
      const assignments = await countRoleAssignments(role.id)
      if (assignments > 0) {
        setActionError('roles.roleInUse')
        setConfirmingDeleteId(null)
        return
      }
      await deleteRole(role.id)
      setConfirmingDeleteId(null)
      await load()
    } catch (error) {
      console.error('[Roles] delete failed', error)
      setActionError('roles.saveFailed')
    }
  }

  const handleToggle = async (role: Role, permission: Permission, next: boolean) => {
    setActionError(null)
    // Optimistic update; revert on failure.
    setRolePermissions((prev) =>
      next
        ? [...prev, { role_id: role.id, permission_id: permission.id }]
        : prev.filter(
            (row) => !(row.role_id === role.id && row.permission_id === permission.id),
          ),
    )
    try {
      await setRolePermission(role.id, permission.id, next)
    } catch (error) {
      console.error('[Roles] permission toggle failed', error)
      setActionError('roles.saveFailed')
      await load().catch(() => undefined)
    }
  }

  if (state === 'loading') {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }

  if (state === 'dbPending') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('roles.dbPendingTitle')}</CardTitle>
          <CardDescription>{t('roles.dbPendingBody')}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (state === 'error') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('common.error')}</CardTitle>
          <CardDescription>{t('roles.loadFailed')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => window.location.reload()}>{t('common.retry')}</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t('roles.title')}</h2>
          <p className="text-muted-foreground">{t('roles.subtitle')}</p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          {t('roles.rolesCount', { count: roles.length })}
        </span>
      </header>

      <p className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">
        {t('roles.enforcementNote')}
      </p>
      {!isAdminLevel && (
        <p className="text-sm text-muted-foreground">{t('roles.readOnlyNote')}</p>
      )}
      {actionError && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t(actionError)}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('roles.listTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {roles.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('roles.noRoles')}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {roles.map((role) => (
                <li
                  key={role.id}
                  className="flex flex-wrap items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div>
                    <p className="font-medium">{role.display_name ?? role.name}</p>
                    <p className="text-sm text-muted-foreground">
                      <code className="rounded bg-muted px-1 py-0.5 text-xs">
                        {role.name}
                      </code>
                      {role.description ? ` — ${role.description}` : ''}
                    </p>
                    {isAdminLevel && !role.is_system && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Input
                          value={renameDrafts[role.id] ?? role.display_name ?? ''}
                          onChange={(e) =>
                            setRenameDrafts((prev) => ({
                              ...prev,
                              [role.id]: e.target.value,
                            }))
                          }
                          className="h-8 w-48"
                          aria-label={t('roles.renameRole')}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void handleRename(role)}
                        >
                          {t('roles.renameRole')}
                        </Button>
                        {confirmingDeleteId === role.id ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={() => void handleDelete(role)}
                            >
                              {t('roles.confirmDelete')}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmingDeleteId(null)}
                            >
                              {t('common.cancel')}
                            </Button>
                          </>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmingDeleteId(role.id)}
                          >
                            {t('roles.deleteRole')}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {role.is_system ? t('roles.systemRole') : t('roles.customRole')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {isAdminLevel && (
            <form
              onSubmit={(e) => void handleCreateRole(e)}
              className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4"
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-role-name">{t('roles.newRoleName')}</Label>
                <Input
                  id="new-role-name"
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder={t('roles.newRolePlaceholder')}
                  className="w-64"
                />
              </div>
              <Button type="submit" disabled={creating || !newRoleName.trim()}>
                {t('roles.createRole')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('roles.matrixTitle')}</CardTitle>
          <CardDescription>{t('roles.matrixHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {permissions.length === 0 || roles.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('roles.noRoles')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-160 border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 border-b bg-card px-3 py-2 text-left font-medium">
                      {t('roles.module')}
                    </th>
                    {roles.map((role) => (
                      <th
                        key={role.id}
                        scope="col"
                        className="border-b px-3 py-2 text-center font-medium whitespace-nowrap"
                      >
                        {role.display_name ?? role.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {permissionsByModule.map(([moduleName, modulePermissions]) => (
                    <Fragment key={moduleName}>
                      <tr>
                        <th
                          colSpan={roles.length + 1}
                          className="bg-muted/50 px-3 py-1.5 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                        >
                          {moduleName}
                        </th>
                      </tr>
                      {modulePermissions.map((permission) => (
                        <tr key={permission.id}>
                          <th
                            scope="row"
                            className="sticky left-0 border-b bg-card px-3 py-2 text-left font-normal"
                          >
                            <code className="text-xs">{permission.key}</code>
                            {permission.description ? (
                              <span className="block text-xs text-muted-foreground">
                                {permission.description}
                              </span>
                            ) : null}
                          </th>
                          {roles.map((role) => (
                            <td
                              key={role.id}
                              className="border-b px-3 py-2 text-center"
                            >
                              {isAdminLevel && !role.is_system ? (
                                <input
                                  type="checkbox"
                                  className="size-4 accent-emerald-600"
                                  checked={isGranted(role, permission)}
                                  onChange={(e) =>
                                    void handleToggle(role, permission, e.target.checked)
                                  }
                                  aria-label={`${role.display_name ?? role.name}: ${permission.key}`}
                                />
                              ) : isGranted(role, permission) ? (
                                <Check className="mx-auto size-4 text-emerald-600" />
                              ) : (
                                <Minus className="mx-auto size-4 text-muted-foreground/50" />
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
