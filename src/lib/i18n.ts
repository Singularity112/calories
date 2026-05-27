export type Locale = 'en' | 'ru' | 'uk' | 'pl'

export const defaultLocale: Locale = 'en'
export const localeStorageKey = 'calories.locale'

const localeToIntlMap: Record<Locale, string> = {
  en: 'en-US',
  ru: 'ru-RU',
  uk: 'uk-UA',
  pl: 'pl-PL',
}

let activeLocale: Locale = defaultLocale

export const localeOptions: Array<{ value: Locale; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
  { value: 'uk', label: 'Українська' },
  { value: 'pl', label: 'Polski' },
]

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'ru' || value === 'uk' || value === 'pl'
}

export function getIntlLocale(locale: Locale = activeLocale) {
  return localeToIntlMap[locale]
}

export function getActiveLocale() {
  return activeLocale
}

export function setActiveLocale(locale: Locale) {
  activeLocale = locale
}

export function readStoredLocale() {
  if (typeof window === 'undefined') {
    return defaultLocale
  }

  const storedLocale = window.localStorage.getItem(localeStorageKey)

  return isLocale(storedLocale) ? storedLocale : defaultLocale
}

export function formatNumber(value: number, locale: Locale = activeLocale) {
  return value.toLocaleString(getIntlLocale(locale))
}

export function formatWeight(value: number, locale: Locale = activeLocale) {
  return new Intl.NumberFormat(getIntlLocale(locale), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatShortDate(value: string, locale: Locale = activeLocale) {
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    day: 'numeric',
    month: 'short',
  })
    .format(new Date(value))
    .replace(/\.$/, '')
}

export function parseLocalizedNumber(value: string) {
  return Number(value.replace(/\s+/g, '').replace(',', '.').trim())
}