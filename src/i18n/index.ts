import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import bn from './locales/bn.json'
import en from './locales/en.json'

const storedLanguage = (() => {
  try {
    const saved = window.localStorage.getItem('foodx.language')
    return saved === 'bn' || saved === 'en' ? saved : 'en'
  } catch {
    return 'en'
  }
})()

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    bn: { translation: bn },
  },
  lng: storedLanguage,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
