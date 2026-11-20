// FoodX — Easy Mode v2 (wave E3; design §8, wizard 1): add a
// menu item the guided way — name → price → photo → list —
// wrapping the same createProduct / createCategory /
// uploadProductImage calls the Menu page uses. No new business
// logic; an easy-mode surface only (in Advanced the URL shows a
// plain note pointing at the normal Menu page).
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  BigChoiceButton,
  EasyOnlyNote,
  EasyWizardQuestion,
  EasyWizardShell,
  EasyWizardSuccess,
} from '@/components/EasyWizard'
import { useAuth } from '@/hooks/useAuth'
import { useEasyMode } from '@/hooks/useEasyMode'
import { roundMoney } from '@/lib/money'
import {
  createCategory,
  createProduct,
  fetchCategories,
} from '@/services/menu'
import { UploadError, uploadProductImage } from '@/services/uploads'
import type { Category } from '@/types'

const NEW_LIST = '__new__'
const NO_LIST = '__none__'

export default function AddItemWizardPage() {
  const { t } = useTranslation()
  const { easy } = useEasyMode()
  if (!easy) {
    return <EasyOnlyNote normalTo="/menu" normalLabel={t('easy.nav.menu')} />
  }
  return <AddItemWizard />
}

function AddItemWizard() {
  const { t, i18n } = useTranslation()
  const { restaurant } = useAuth()
  const restaurantId = restaurant?.id

  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [choice, setChoice] = useState<string>(NEW_LIST)
  const [newListName, setNewListName] = useState('')
  const [doneName, setDoneName] = useState<string | null>(null)

  useEffect(() => {
    if (!restaurantId) return
    let cancelled = false
    void fetchCategories(restaurantId)
      .then((rows) => {
        if (cancelled) return
        setCategories(rows)
        // The everyday case: the food joins an existing list.
        if (rows.length > 0) setChoice(rows[0].id)
      })
      .catch(() => {
        // No readable lists: the wizard falls back to making one.
        if (!cancelled) setCategories([])
      })
    return () => {
      cancelled = true
    }
  }, [restaurantId])

  const categoryLabel = (category: Category): string =>
    i18n.language === 'bn' && category.name_bn
      ? category.name_bn
      : category.name

  const handleFile = async (file: File | undefined) => {
    if (!file || !restaurantId) return
    setError(null)
    setUploading(true)
    try {
      const url = await uploadProductImage(restaurantId, file)
      setImageUrl(url)
    } catch (err) {
      if (err instanceof UploadError) {
        setError(
          t(
            err.code === 'upload_bad_type'
              ? 'easy.wizard.uploadBadType'
              : err.code === 'upload_too_large'
                ? 'easy.wizard.uploadTooLarge'
                : 'easy.wizard.uploadFailed',
          ),
        )
      } else {
        setError(t('easy.wizard.uploadFailed'))
      }
    } finally {
      setUploading(false)
    }
  }

  const handleCreate = async () => {
    if (!restaurantId || busy) return
    setError(null)
    if (choice === NEW_LIST && !newListName.trim()) {
      setError(t('easy.wizard.listNameRequired'))
      return
    }
    setBusy(true)
    try {
      let categoryId: string | null = null
      if (choice === NEW_LIST) {
        const created = await createCategory(restaurantId, {
          name: newListName.trim(),
        })
        categoryId = created.id
      } else if (choice !== NO_LIST) {
        categoryId = choice
      }
      await createProduct(restaurantId, {
        categoryId,
        name: name.trim(),
        price: roundMoney(Number.parseFloat(price)),
        imageUrl: imageUrl.trim() || undefined,
      })
      setDoneName(name.trim())
    } catch {
      setError(t('easy.wizard.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const goNext = () => {
    setError(null)
    if (step === 0) {
      if (!name.trim()) {
        setError(t('easy.wizard.nameRequired'))
        return
      }
      setStep(1)
    } else if (step === 1) {
      const value = Number.parseFloat(price)
      if (!Number.isFinite(value) || value <= 0) {
        setError(t('easy.wizard.priceRequired'))
        return
      }
      setStep(2)
    } else if (step === 2) {
      setStep(3)
    } else {
      void handleCreate()
    }
  }

  if (!restaurantId) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }

  if (doneName !== null) {
    return (
      <EasyWizardSuccess
        message={t('easy.wizard.itemCreated', { name: doneName })}
        doneTo="/menu"
      />
    )
  }

  return (
    <EasyWizardShell
      title={t('easy.wizard.addItemTitle')}
      step={step}
      stepCount={4}
      error={error}
      busy={busy || uploading}
      onBack={step > 0 ? () => setStep(step - 1) : undefined}
      onNext={goNext}
      nextLabel={
        step < 3 ? t('common.next') : t('easy.wizard.createItem')
      }
    >
      {step === 0 && (
        <>
          <EasyWizardQuestion>
            {t('easy.wizard.itemNameQ')}
          </EasyWizardQuestion>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-12 text-lg"
            autoFocus
          />
        </>
      )}

      {step === 1 && (
        <>
          <EasyWizardQuestion>
            {t('easy.wizard.itemPriceQ')}
          </EasyWizardQuestion>
          <Input
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="decimal"
            className="h-12 text-lg"
            autoFocus
          />
        </>
      )}

      {step === 2 && (
        <>
          <EasyWizardQuestion>
            {t('easy.wizard.itemPhotoQ')}
          </EasyWizardQuestion>
          <p className="text-base text-muted-foreground">
            {t('easy.wizard.photoLinkHint')}
          </p>
          <Input
            value={imageUrl}
            onChange={(event) => setImageUrl(event.target.value)}
            placeholder={t('easy.wizard.photoLinkPlaceholder')}
            className="h-12 text-lg"
          />
          <div>
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading
                ? t('easy.wizard.uploading')
                : t('easy.wizard.uploadPhoto')}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                void handleFile(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </div>
          {imageUrl.trim() && (
            <img
              src={imageUrl.trim()}
              alt=""
              className="h-32 w-32 rounded-lg border object-cover"
            />
          )}
        </>
      )}

      {step === 3 && (
        <>
          <EasyWizardQuestion>
            {t('easy.wizard.itemCategoryQ')}
          </EasyWizardQuestion>
          {categories === null ? (
            <p className="text-muted-foreground">{t('common.loading')}</p>
          ) : (
            <>
              {categories.map((category) => (
                <BigChoiceButton
                  key={category.id}
                  selected={choice === category.id}
                  onClick={() => setChoice(category.id)}
                >
                  {categoryLabel(category)}
                </BigChoiceButton>
              ))}
              <BigChoiceButton
                selected={choice === NEW_LIST}
                onClick={() => setChoice(NEW_LIST)}
              >
                {t('easy.wizard.newList')}
              </BigChoiceButton>
              <BigChoiceButton
                selected={choice === NO_LIST}
                onClick={() => setChoice(NO_LIST)}
              >
                {t('easy.wizard.noList')}
              </BigChoiceButton>
              {choice === NEW_LIST && (
                <Input
                  value={newListName}
                  onChange={(event) => setNewListName(event.target.value)}
                  placeholder={t('easy.wizard.newListPlaceholder')}
                  className="h-12 text-lg"
                />
              )}
            </>
          )}
        </>
      )}
    </EasyWizardShell>
  )
}
