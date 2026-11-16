// FoodX — Roles & Permissions page (protected, read-only for Phase 1).
// Lists the roles (12 system defaults + any restaurant roles) and a
// permission matrix (roles x permissions) from role_permissions.
// Editing is explicitly marked "Not implemented" — never faked.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Minus } from 'lucide-react'
import { isMissingTableError } from '@/lib/errors'
import {
  fetchPermissions,
  fetchRolePermissions,
  fetchRoles,
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

export default function RolesPage() {
  const { t } = useTranslation()
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'dbPending'>(
    'loading',
  )

  useEffect(() => {
    let cancelled = false
    void Promise.all([fetchRoles(), fetchPermissions(), fetchRolePermissions()])
      .then(([rolesData, permissionsData, rolePermissionsData]) => {
        if (cancelled) return
        setRoles(rolesData)
        setPermissions(permissionsData)
        setRolePermissions(rolePermissionsData)
        setState('ready')
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

  const permissionsByModule = useMemo(() => {
    const groups = new Map<string, Permission[]>()
    for (const permission of permissions) {
      const list = groups.get(permission.module) ?? []
      list.push(permission)
      groups.set(permission.module, list)
    }
    return [...groups.entries()]
  }, [permissions])

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
          <Button onClick={() => window.location.reload()}>
            {t('common.retry')}
          </Button>
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
                <li key={role.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div>
                    <p className="font-medium">
                      {role.display_name ?? role.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      <code className="rounded bg-muted px-1 py-0.5 text-xs">
                        {role.name}
                      </code>
                      {role.description ? ` — ${role.description}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {role.is_system
                      ? t('roles.systemRole')
                      : t('roles.customRole')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-sm text-muted-foreground">
            {t('roles.editNotImplemented')}
          </p>
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
                              {granted.has(`${role.id}:${permission.id}`) ? (
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
