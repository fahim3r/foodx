import { useEasyMode } from '@/hooks/useEasyMode'

/**
 * Easy Mode v2 (wave E2; design §9): the big plain-language
 * warning shown inside a destructive action's existing
 * confirmation step while easy mode is on — it names the item
 * and the consequence in everyday words ("Order #12 will be
 * cancelled… Are you sure?"). It changes only the wording and
 * presentation of the confirmation: the action's own flow —
 * including any manager-PIN step — is untouched, and in the
 * normal (Advanced) panel this renders nothing at all.
 */
export default function EasyConfirmNote({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const { easy } = useEasyMode()
  if (!easy) return null
  return (
    <p
      role="alert"
      className={`rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-lg font-semibold text-destructive ${className ?? ''}`}
    >
      {text}
    </p>
  )
}
