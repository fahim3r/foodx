import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useEasyMode } from '@/hooks/useEasyMode'

/**
 * Settings → Easy Mode (modifications v2, item 9). The card is
 * honest about what the mode is: a comfort setting for this
 * device's screens — not an access restriction.
 */
export default function EasyModeCard() {
  const { t } = useTranslation()
  const { easy, setEasy } = useEasyMode()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.easyTitle')}</CardTitle>
        <CardDescription>{t('settings.easyBody')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          variant={easy ? 'default' : 'outline'}
          onClick={() => setEasy(!easy)}
        >
          {easy ? t('settings.easyDisable') : t('settings.easyEnable')}
        </Button>
      </CardContent>
    </Card>
  )
}
