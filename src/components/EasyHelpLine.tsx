import { useTranslation } from 'react-i18next'

import { useEasyMode } from '@/hooks/useEasyMode'

/**
 * Easy Mode v2 (wave E2; design §9): the one-line plain-language
 * explanation a page shows under its title — what this page is
 * for, in everyday words. Rendered ONLY in easy mode; in the
 * normal (Advanced) panel it renders nothing, so pages can mount
 * it unconditionally next to their existing subtitle.
 */
export default function EasyHelpLine({ labelKey }: { labelKey: string }) {
  const { t } = useTranslation()
  const { easy } = useEasyMode()
  if (!easy) return null
  return (
    <p className="mt-1 text-base font-medium text-muted-foreground">
      {t(labelKey)}
    </p>
  )
}
