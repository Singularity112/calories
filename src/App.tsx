import { useEffect, useState, type ReactNode } from 'react'
import type { User } from 'firebase/auth'
import {
  isFirebaseConfigured,
  loadUserState,
  observeAuthState,
  parseFoodPrompt,
  parseWorkoutPrompt,
  resolvePendingRedirectSignIn,
  saveUserState,
  signInWithGoogle,
  signOutCurrentUser,
} from './lib/firebase'

type AppTab = 'today' | 'stats' | 'profile'
type EntrySource = 'manual' | 'gpt'
type StatsRange = '7d' | '30d' | '90d'
type GoalMode = 'auto' | 'manual'
type GoalType = 'cut' | 'maintain' | 'bulk'
type Gender = 'male' | 'female'
type ActivityLevel = 'low' | 'moderate' | 'high' | 'athlete'
type AddMode = 'manual' | 'chat'
type WorkoutType = 'strength' | 'cardio' | 'walking' | 'mobility'
type WorkoutMetric = 'calories' | 'steps'
type MacroKey = keyof NutritionTotals

type NutritionTotals = {
  calories: number
  protein: number
  fat: number
  carbs: number
}

type FoodEntry = NutritionTotals & {
  id: string
  name: string
  grams: number
  source: EntrySource
}

type Meal = {
  id: string
  title: string
  time: string
  note: string
  items: FoodEntry[]
}

type MealHistory = Record<string, Meal[]>

type WorkoutEntry = {
  id: string
  type: WorkoutType
  title: string
  details: string
  value: number
  metric: WorkoutMetric
  estimatedCalories: number
  source: EntrySource
}

type WorkoutHistory = Record<string, WorkoutEntry[]>

type WeightHistoryEntry = {
  date: string
  value: number
}

type DailyRecord = NutritionTotals & {
  date: string
  weight: number
  steps: number
  workouts: number
  workoutCalories: number
}

type ChatMessage = {
  id: string
  role: 'assistant' | 'user'
  text: string
}

type ChatDraft = {
  mealId: string
  title: string
  totals: NutritionTotals
  items: FoodEntry[]
  summary: string
}

type WorkoutDraft = {
  entry: WorkoutEntry
  summary: string
}

type ManualForm = {
  mealId: string
  name: string
  grams: string
  calories: string
  protein: string
  fat: string
  carbs: string
}

type WorkoutForm = {
  type: WorkoutType
  title: string
  value: string
  details: string
}

type Profile = {
  hasCompletedOnboarding: boolean
  gender: Gender
  age: number
  height: number
  currentWeight: number
  lastWeightEntryDate: string | null
  targetWeight: number
  goalType: GoalType
  weeklyRate: number
  activity: ActivityLevel
  goalMode: GoalMode
  manualCalories: number
  manualProtein: number
  manualFat: number
  manualCarbs: number
}

type SurfaceProps = {
  children: ReactNode
  className?: string
}

type FieldGroupProps = {
  label: string
  hint?: string
  children: ReactNode
}

type PendingMealDeletion = {
  mealId: string
  entryId: string
  entryName: string
} | null

type PendingWorkoutDeletion = {
  entryId: string
  entryName: string
} | null

type MacroCardProps = {
  macro: MacroKey
  current: number
  goal: number
}

type MacroPillProps = {
  macro: MacroKey
  value: number
  goal?: number
  compact?: boolean
}

type MetricCardProps = {
  label: string
  value: string
  note: string
}

type SyncStatus = 'local' | 'idle' | 'loading' | 'saving' | 'saved' | 'error'

type FoodCatalogEntry = {
  key: string
  label: string
  defaultGrams: number
  calories: number
  protein: number
  fat: number
  carbs: number
}

const tabs: { id: AppTab; label: string; note: string }[] = [
  { id: 'today', label: 'Сегодня', note: 'Еда, вес и быстрый ввод' },
  { id: 'stats', label: 'Статистика', note: 'Неделя, месяц и тренды' },
  { id: 'profile', label: 'Профиль', note: 'Цели и расчет КБЖУ' },
]

const macroMeta: Record<
  MacroKey,
  {
    label: string
    iconBg: string
    iconColor: string
    badgeBg: string
    badgeText: string
    barClass: string
    chipClass: string
    tintClass: string
  }
> = {
  calories: {
    label: 'Калории',
    iconBg: 'bg-[#fff1e2]',
    iconColor: 'text-[#eb7d1a]',
    badgeBg: 'bg-[#fff3e8]',
    badgeText: 'text-[#b7691d]',
    barClass: 'bg-[#f4a340]',
    chipClass: 'bg-[#fff5ea] text-[#b7691d]',
    tintClass: 'bg-[#fffaf4] border-[#f4e2cf]',
  },
  protein: {
    label: 'Белки',
    iconBg: 'bg-[#eaf1ff]',
    iconColor: 'text-[#2967db]',
    badgeBg: 'bg-[#edf3ff]',
    badgeText: 'text-[#2c62c6]',
    barClass: 'bg-[#2f7de1]',
    chipClass: 'bg-[#eef4ff] text-[#2c62c6]',
    tintClass: 'bg-[#f9fbff] border-[#dce6fb]',
  },
  fat: {
    label: 'Жиры',
    iconBg: 'bg-[#fff6df]',
    iconColor: 'text-[#b78617]',
    badgeBg: 'bg-[#fff7e7]',
    badgeText: 'text-[#9c7716]',
    barClass: 'bg-[#c8a13c]',
    chipClass: 'bg-[#fff8e8] text-[#9c7716]',
    tintClass: 'bg-[#fffdf7] border-[#f0e5c8]',
  },
  carbs: {
    label: 'Углеводы',
    iconBg: 'bg-[#e9f7ef]',
    iconColor: 'text-[#24845c]',
    badgeBg: 'bg-[#eaf7f0]',
    badgeText: 'text-[#246e52]',
    barClass: 'bg-[#49a078]',
    chipClass: 'bg-[#eef9f2] text-[#246e52]',
    tintClass: 'bg-[#f8fcfa] border-[#dcebe2]',
  },
}

const activityMultipliers: Record<ActivityLevel, number> = {
  low: 1.2,
  moderate: 1.375,
  high: 1.55,
  athlete: 1.725,
}

const activityOptions: { value: ActivityLevel; label: string; note: string }[] = [
  { value: 'low', label: 'Сидячий', note: 'офис, мало шагов' },
  { value: 'moderate', label: 'Умеренный', note: 'много ходьбы и 2-3 тренировки' },
  { value: 'high', label: 'Активный', note: 'частые тренировки и высокий NEAT' },
  { value: 'athlete', label: 'Очень активный', note: 'спорт почти каждый день' },
]

const workoutTypes: WorkoutType[] = ['strength', 'cardio', 'walking', 'mobility']

const workoutTypeMeta: Record<
  WorkoutType,
  {
    label: string
    note: string
    metric: WorkoutMetric
    inputLabel: string
    inputPlaceholder: string
    defaultValue: number
    chatPlaceholder: string
    chipClass: string
    panelClass: string
  }
> = {
  strength: {
    label: 'Силовая',
    note: 'подходы, повторения, упражнения',
    metric: 'calories',
    inputLabel: 'Сожжено, ккал',
    inputPlaceholder: '220',
    defaultValue: 220,
    chatPlaceholder: 'Я присел 20 раз по 4 подхода и сделал жим ногами',
    chipClass: 'bg-[#eef3ff] text-[#2c62c6]',
    panelClass: 'border-[#dce6fb] bg-[#f9fbff]',
  },
  cardio: {
    label: 'Кардио',
    note: 'бег, велосипед, дорожка, интервалы',
    metric: 'calories',
    inputLabel: 'Сожжено, ккал',
    inputPlaceholder: '320',
    defaultValue: 320,
    chatPlaceholder: 'Пробежал 35 минут в спокойном темпе',
    chipClass: 'bg-[#fff3e8] text-[#b7691d]',
    panelClass: 'border-[#f4e2cf] bg-[#fffaf4]',
  },
  walking: {
    label: 'Шаги',
    note: 'прогулка, поход пешком, длительная ходьба',
    metric: 'steps',
    inputLabel: 'Шаги',
    inputPlaceholder: '8500',
    defaultValue: 7000,
    chatPlaceholder: 'Сегодня прошел 9600 шагов',
    chipClass: 'bg-[#eaf7f0] text-[#246e52]',
    panelClass: 'border-[#dcebe2] bg-[#f8fcfa]',
  },
  mobility: {
    label: 'Восстановление',
    note: 'растяжка, йога, мобилити',
    metric: 'calories',
    inputLabel: 'Сожжено, ккал',
    inputPlaceholder: '90',
    defaultValue: 90,
    chatPlaceholder: 'Сделал 25 минут растяжки после тренировки',
    chipClass: 'bg-[#eef5f2] text-[#4f6255]',
    panelClass: 'border-[#dfe7e2] bg-[#f8fbf9]',
  },
}

const foodCatalog: FoodCatalogEntry[] = [
  { key: 'греч', label: 'Гречка', defaultGrams: 180, calories: 110, protein: 4.2, fat: 1.1, carbs: 21.3 },
  { key: 'рис', label: 'Рис', defaultGrams: 180, calories: 130, protein: 2.7, fat: 0.3, carbs: 28 },
  { key: 'овсян', label: 'Овсянка', defaultGrams: 80, calories: 360, protein: 13, fat: 6.5, carbs: 62 },
  { key: 'куриц', label: 'Куриная грудка', defaultGrams: 160, calories: 165, protein: 31, fat: 3.6, carbs: 0 },
  { key: 'индейк', label: 'Индейка', defaultGrams: 160, calories: 138, protein: 29, fat: 2, carbs: 0 },
  { key: 'лосос', label: 'Лосось', defaultGrams: 160, calories: 208, protein: 20, fat: 13, carbs: 0 },
  { key: 'творог', label: 'Творог 5%', defaultGrams: 180, calories: 145, protein: 17, fat: 5, carbs: 3 },
  { key: 'йогурт', label: 'Греческий йогурт', defaultGrams: 180, calories: 68, protein: 10, fat: 2, carbs: 4 },
  { key: 'банан', label: 'Банан', defaultGrams: 120, calories: 89, protein: 1.1, fat: 0.3, carbs: 23 },
  { key: 'яйц', label: 'Яйца', defaultGrams: 120, calories: 155, protein: 13, fat: 11, carbs: 1.1 },
  { key: 'салат', label: 'Овощной салат', defaultGrams: 150, calories: 65, protein: 2, fat: 4, carbs: 6 },
  { key: 'овощ', label: 'Овощи', defaultGrams: 180, calories: 35, protein: 2, fat: 0.4, carbs: 6 },
  { key: 'яблок', label: 'Яблоко', defaultGrams: 150, calories: 52, protein: 0.3, fat: 0.2, carbs: 14 },
  { key: 'миндал', label: 'Миндаль', defaultGrams: 25, calories: 579, protein: 21, fat: 50, carbs: 22 },
  { key: 'протеин', label: 'Протеиновый шейк', defaultGrams: 35, calories: 390, protein: 74, fat: 6, carbs: 10 },
]

const initialMeals: Meal[] = [
  {
    id: 'breakfast',
    title: 'Завтрак',
    time: '08:00–10:00',
    note: 'Старт дня и первая порция белка.',
    items: [],
  },
  {
    id: 'lunch',
    title: 'Обед',
    time: '12:30–14:30',
    note: 'Основной прием пищи и база по энергии.',
    items: [],
  },
  {
    id: 'dinner',
    title: 'Ужин',
    time: '18:30–20:30',
    note: 'Чуть легче по калориям, но не по белку.',
    items: [],
  },
  {
    id: 'snacks',
    title: 'Перекусы',
    time: 'Свободно',
    note: 'Контроль голода без срыва в калории.',
    items: [],
  },
]

const initialChatMessages: ChatMessage[] = []

const initialProfile: Profile = {
  hasCompletedOnboarding: false,
  gender: 'male',
  age: 29,
  height: 180,
  currentWeight: 78.1,
  lastWeightEntryDate: null,
  targetWeight: 73,
  goalType: 'cut',
  weeklyRate: 0.4,
  activity: 'moderate',
  goalMode: 'auto',
  manualCalories: 2100,
  manualProtein: 150,
  manualFat: 68,
  manualCarbs: 210,
}

const mealLabels: Record<string, string> = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snacks: 'Перекусы',
}

const mealTones: Record<string, { badge: string; card: string; total: string }> = {
  breakfast: {
    badge: 'bg-[#ddf3e5] text-[#22563d]',
    card: 'border-[#d7e8dc] bg-[#f8fcf8]',
    total: 'bg-[#eaf7ee] text-[#22563d]',
  },
  lunch: {
    badge: 'bg-[#d9f1e8] text-[#1d6146]',
    card: 'border-[#d4e9df] bg-[#f7fbf9]',
    total: 'bg-[#e4f5ec] text-[#1e6247]',
  },
  dinner: {
    badge: 'bg-[#e4f1e4] text-[#2d5b38]',
    card: 'border-[#d7e5d6] bg-[#f9fbf7]',
    total: 'bg-[#edf7eb] text-[#2b5935]',
  },
  snacks: {
    badge: 'bg-[#edf4de] text-[#50672d]',
    card: 'border-[#dfe7d1] bg-[#fbfcf7]',
    total: 'bg-[#f2f8e8] text-[#51692e]',
  },
}

const demoFoodEntryIds = new Set([
  'breakfast-oats',
  'breakfast-yogurt',
  'lunch-turkey',
  'lunch-bulgur',
  'lunch-salad',
  'dinner-salmon',
  'dinner-puree',
  'snack-apple',
  'snack-pudding',
])

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`
}

function cloneMeals() {
  return initialMeals.map((meal) => ({
    ...meal,
    items: meal.items.map((item) => ({ ...item })),
  }))
}

function sanitizeMeals(meals: Meal[]) {
  return meals.map((meal) => ({
    ...meal,
    items: meal.items.filter((item) => !demoFoodEntryIds.has(item.id)),
  }))
}

function sanitizeMealHistory(history: MealHistory) {
  return Object.fromEntries(
    Object.entries(history).map(([date, meals]) => [date, sanitizeMeals(meals)]),
  )
}

function sanitizeWorkoutHistory(history: WorkoutHistory): WorkoutHistory {
  return Object.fromEntries(
    Object.entries(history).map(([date, entries]) => [
      date,
      entries.map((entry) => {
        const metric: WorkoutMetric = entry.metric === 'steps' ? 'steps' : 'calories'
        const value = Math.max(0, roundMacro(entry.value))

        return {
          ...entry,
          metric,
          value,
          estimatedCalories:
            typeof entry.estimatedCalories === 'number'
              ? Math.max(0, roundMacro(entry.estimatedCalories))
              : metric === 'steps'
                ? estimateCaloriesFromSteps(value, initialProfile.currentWeight)
                : value,
        }
      }),
    ]),
  )
}

function getSuggestedMealId(date = new Date()) {
  const hour = date.getHours()

  if (hour < 5) {
    return 'snacks'
  }

  if (hour < 12) {
    return 'breakfast'
  }

  if (hour < 16) {
    return 'lunch'
  }

  if (hour < 18) {
    return 'snacks'
  }

  return 'dinner'
}

function createDefaultManualForm(date = new Date()): ManualForm {
  return {
    mealId: getSuggestedMealId(date),
    name: '',
    grams: '',
    calories: '',
    protein: '',
    fat: '',
    carbs: '',
  }
}

function createDefaultWorkoutForm(): WorkoutForm {
  return {
    type: 'strength',
    title: '',
    value: '',
    details: '',
  }
}

function getInitialMealHistory(todayKey: string) {
  const storedMealHistory = readStorage<MealHistory | null>('calories.mealHistory', null)

  if (storedMealHistory) {
    return sanitizeMealHistory(storedMealHistory)
  }

  const legacyMeals = sanitizeMeals(readStorage<Meal[]>('calories.meals', cloneMeals()))

  return legacyMeals.some((meal) => meal.items.length > 0) ? { [todayKey]: legacyMeals } : {}
}

function getInitialWorkoutHistory() {
  return sanitizeWorkoutHistory(readStorage<WorkoutHistory>('calories.workoutHistory', {}))
}

function getInitialWeightHistory() {
  const storedWeightHistory = readStorage<WeightHistoryEntry[] | null>('calories.weightHistory', null)

  if (storedWeightHistory) {
    return storedWeightHistory
  }

  const storedProfile = readStorage<Profile>('calories.profile', initialProfile)

  return storedProfile.lastWeightEntryDate
    ? [{ date: storedProfile.lastWeightEntryDate, value: storedProfile.currentWeight }]
    : []
}

function readStorage<T>(key: string, fallback: T) {
  if (typeof window === 'undefined') {
    return fallback
  }

  try {
    const rawValue = window.localStorage.getItem(key)

    if (!rawValue) {
      return fallback
    }

    return JSON.parse(rawValue) as T
  } catch {
    return fallback
  }
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function formatNumber(value: number) {
  return value.toLocaleString('ru-RU')
}

function formatWeight(value: number) {
  return value.toFixed(1).replace('.', ',')
}

function formatSignedWeight(value: number) {
  if (value === 0) {
    return formatWeight(0)
  }

  return `${value > 0 ? '+' : '-'}${formatWeight(Math.abs(value))}`
}

function formatSignedCalories(value: number) {
  if (value === 0) {
    return '0'
  }

  return `${value > 0 ? '+' : '-'}${formatNumber(Math.abs(value))}`
}

function getFirebaseErrorMessage(error: unknown, fallback: string) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: string }).code)
      : ''

  switch (code) {
    case 'permission-denied':
      return 'Firebase отклонил доступ к данным. Проверь Firestore Database и опубликованные rules.'
    case 'failed-precondition':
      return 'Firestore еще не готов. Создай Database в Firebase Console и попробуй снова.'
    case 'unavailable':
      return 'Firebase сейчас недоступен. Проверь сеть и повтори попытку.'
    case 'auth/unauthorized-domain':
      return 'Домен не разрешен для Google login. Добавь 127.0.0.1 в Authorized domains.'
    case 'auth/popup-closed-by-user':
      return 'Вход через Google был закрыт до завершения.'
    case 'auth/network-request-failed':
      return 'Не удалось связаться с Firebase. Проверь сеть и настройки проекта.'
    default:
      return code ? `${fallback} (${code})` : fallback
  }
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
  })
    .format(new Date(value))
    .replace('.', '')
}

function parseLocalizedNumber(value: string) {
  return Number(value.replace(',', '.').trim())
}

function sumEntries(items: FoodEntry[]): NutritionTotals {
  return items.reduce(
    (totals, item) => ({
      calories: totals.calories + item.calories,
      protein: totals.protein + item.protein,
      fat: totals.fat + item.fat,
      carbs: totals.carbs + item.carbs,
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 },
  )
}

function sumMeals(meals: Meal[]) {
  return meals.reduce(
    (totals, meal) => {
      const mealTotals = sumEntries(meal.items)

      return {
        calories: totals.calories + mealTotals.calories,
        protein: totals.protein + mealTotals.protein,
        fat: totals.fat + mealTotals.fat,
        carbs: totals.carbs + mealTotals.carbs,
      }
    },
    { calories: 0, protein: 0, fat: 0, carbs: 0 },
  )
}

function sumWorkoutMetric(entries: WorkoutEntry[], metric: WorkoutMetric) {
  return entries.reduce((sum, entry) => (entry.metric === metric ? sum + entry.value : sum), 0)
}

function sumWorkoutCalories(entries: WorkoutEntry[]) {
  return entries.reduce((sum, entry) => sum + entry.estimatedCalories, 0)
}

function estimateCaloriesFromSteps(steps: number, weightKg: number) {
  return Math.max(0, Math.round(steps * weightKg * 0.00045))
}

function getWorkoutMetric(type: WorkoutType) {
  return workoutTypeMeta[type].metric
}

function formatWorkoutValue(entry: WorkoutEntry) {
  return entry.metric === 'steps'
    ? `${formatNumber(entry.value)} шагов`
    : `${formatNumber(entry.value)} ккал`
}

function formatWorkoutCalories(entry: WorkoutEntry) {
  return `~${formatNumber(entry.estimatedCalories)} ккал`
}

function getSourceLabel(source: EntrySource) {
  return source === 'gpt' ? 'GPT' : 'ручной'
}

function getSourceClass(source: EntrySource) {
  return source === 'gpt'
    ? 'bg-[#dff4e7] text-[#1f6747]'
    : 'bg-[#eef3ef] text-[#597063]'
}

function roundMacro(value: number) {
  return Math.max(0, Math.round(value))
}

function calculateTargets(profile: Profile) {
  const bmr =
    profile.gender === 'male'
      ? 10 * profile.currentWeight + 6.25 * profile.height - 5 * profile.age + 5
      : 10 * profile.currentWeight + 6.25 * profile.height - 5 * profile.age - 161

  const tdee = bmr * activityMultipliers[profile.activity]

  let adjustment = 0

  if (profile.goalType === 'cut') {
    adjustment = -profile.weeklyRate * 1100
  }

  if (profile.goalType === 'bulk') {
    adjustment = profile.weeklyRate * 750
  }

  const recommendedCalories = Math.max(1350, Math.round(tdee + adjustment))
  const recommendedProtein = roundMacro(profile.currentWeight * (profile.goalType === 'cut' ? 2 : 1.8))
  const recommendedFat = Math.max(45, roundMacro(profile.currentWeight * 0.8))
  const recommendedCarbs = Math.max(
    80,
    roundMacro((recommendedCalories - recommendedProtein * 4 - recommendedFat * 9) / 4),
  )

  const active =
    profile.goalMode === 'manual'
      ? {
          calories: profile.manualCalories,
          protein: profile.manualProtein,
          fat: profile.manualFat,
          carbs: profile.manualCarbs,
        }
      : {
          calories: recommendedCalories,
          protein: recommendedProtein,
          fat: recommendedFat,
          carbs: recommendedCarbs,
        }

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    adjustment: Math.round(adjustment),
    recommended: {
      calories: recommendedCalories,
      protein: recommendedProtein,
      fat: recommendedFat,
      carbs: recommendedCarbs,
    },
    active,
  }
}

function calculateDailyCaloriePlan(
  baseGoalCalories: number,
  consumedCalories: number,
  workoutCalories: number,
  goalType: GoalType,
  weeklyRate: number,
) {
  const workoutCreditRatio = goalType === 'cut' ? 0.7 : goalType === 'maintain' ? 0.85 : 1
  const workoutCredit = roundMacro(workoutCalories * workoutCreditRatio)
  const effectiveGoalCalories = baseGoalCalories + workoutCredit
  const safeZoneHalfWidth =
    goalType === 'cut'
      ? Math.max(80, Math.min(140, roundMacro(weeklyRate * 220)))
      : goalType === 'maintain'
        ? 120
        : 140
  const safeZoneMin = Math.max(1200, effectiveGoalCalories - safeZoneHalfWidth)
  const safeZoneMax = effectiveGoalCalories + safeZoneHalfWidth
  const scaleMax = Math.max(1, consumedCalories, effectiveGoalCalories, safeZoneMax)
  const toPercent = (value: number) => Math.min(100, Math.max(0, (value / scaleMax) * 100))

  return {
    workoutCreditRatio,
    workoutCredit,
    effectiveGoalCalories,
    safeZoneMin,
    safeZoneMax,
    foodPercent: toPercent(consumedCalories),
    baseGoalPercent: toPercent(baseGoalCalories),
    effectiveGoalPercent: toPercent(effectiveGoalCalories),
    safeZoneStartPercent: toPercent(safeZoneMin),
    safeZoneEndPercent: toPercent(safeZoneMax),
  }
}

function buildHistory(
  mealHistory: MealHistory,
  weightHistory: WeightHistoryEntry[],
  workoutHistory: WorkoutHistory,
  todayKey: string,
  totals: NutritionTotals,
  currentWeight: number,
  workoutEntries: WorkoutEntry[],
): DailyRecord[] {
  const sortedWeightHistory = [...weightHistory].sort((a, b) => a.date.localeCompare(b.date))
  const weightMap = new Map(sortedWeightHistory.map((entry) => [entry.date, entry.value]))
  const dateSet = new Set<string>([
    ...Object.keys(mealHistory),
    ...Object.keys(workoutHistory),
    ...sortedWeightHistory.map((entry) => entry.date),
    todayKey,
  ])
  const zeroTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 }
  let lastKnownWeight = sortedWeightHistory[0]?.value ?? currentWeight

  return [...dateSet]
    .sort((a, b) => a.localeCompare(b))
    .map((date) => {
      const dayTotals = date === todayKey ? totals : mealHistory[date] ? sumMeals(mealHistory[date]) : zeroTotals
      const dayWorkoutEntries = date === todayKey ? workoutEntries : workoutHistory[date] ?? []
      const weight = date === todayKey ? currentWeight : weightMap.get(date) ?? lastKnownWeight

      lastKnownWeight = weight

      return {
        date,
        calories: dayTotals.calories,
        protein: dayTotals.protein,
        fat: dayTotals.fat,
        carbs: dayTotals.carbs,
        weight,
        steps: sumWorkoutMetric(dayWorkoutEntries, 'steps'),
        workouts: dayWorkoutEntries.length,
        workoutCalories: sumWorkoutCalories(dayWorkoutEntries),
      }
    })
}

function upsertWeightHistoryEntry(weightHistory: WeightHistoryEntry[], date: string, value: number) {
  const nextHistory = weightHistory.filter((entry) => entry.date !== date)

  nextHistory.push({ date, value })
  nextHistory.sort((a, b) => a.date.localeCompare(b.date))

  return nextHistory
}

function filterHistory<T extends { date: string }>(history: T[], range: StatsRange) {
  const amount = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const fromDate = new Date()

  fromDate.setHours(0, 0, 0, 0)
  fromDate.setDate(fromDate.getDate() - (amount - 1))

  return history.filter((record) => record.date >= toIsoDate(fromDate))
}

function getChartPoints(values: number[], width = 320, height = 140) {
  if (values.length === 0) {
    return ''
  }

  if (values.length === 1) {
    return `${width / 2},${height - 12}`
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width
      const y = height - ((value - min) / range) * (height - 24) - 12
      return `${x},${y}`
    })
    .join(' ')
}

function capitalize(value: string) {
  if (!value) {
    return value
  }

  return value[0].toUpperCase() + value.slice(1)
}

function buildFoodDraftTitle(names: string[]) {
  const cleanedNames = names.map((name) => name.trim()).filter(Boolean)

  if (cleanedNames.length === 0) {
    return 'Блюдо'
  }

  if (cleanedNames.length === 1) {
    return cleanedNames[0]
  }

  if (cleanedNames.length === 2) {
    return `${cleanedNames[0]} с ${cleanedNames[1].toLowerCase()}`
  }

  const [first, second, ...rest] = cleanedNames
  const tail = [second.toLowerCase(), ...rest.map((item) => item.toLowerCase())]

  return `${first} с ${tail.slice(0, -1).join(', ')} и ${tail[tail.length - 1]}`
}

function detectWorkoutType(prompt: string, fallback: WorkoutType): WorkoutType {
  if (/шаг|ходьб|прогул|пешк/.test(prompt)) {
    return 'walking'
  }

  if (/йог|растяж|мобил|recovery/.test(prompt)) {
    return 'mobility'
  }

  if (/бег|кардио|дорожк|вел|эллипс|интервал|спринт/.test(prompt)) {
    return 'cardio'
  }

  if (/присед|жим|тяга|подтяг|отжим|гантел|штанг|подход|сет|повтор/.test(prompt)) {
    return 'strength'
  }

  return fallback
}

function buildWorkoutTitle(prompt: string, type: WorkoutType) {
  if (type === 'walking') {
    return 'Шаги'
  }

  if (/присед/.test(prompt)) {
    return 'Приседания'
  }

  if (/жим/.test(prompt)) {
    return 'Жим'
  }

  if (/тяга/.test(prompt)) {
    return 'Тяга'
  }

  if (/подтяг/.test(prompt)) {
    return 'Подтягивания'
  }

  if (/отжим/.test(prompt)) {
    return 'Отжимания'
  }

  if (/бег|дорожк/.test(prompt)) {
    return 'Бег'
  }

  if (/вел/.test(prompt)) {
    return 'Велотренировка'
  }

  if (/йог/.test(prompt)) {
    return 'Йога'
  }

  if (/растяж|мобил/.test(prompt)) {
    return 'Растяжка'
  }

  return workoutTypeMeta[type].label
}

function buildWorkoutDraftFromPrompt(
  prompt: string,
  fallbackType: WorkoutType,
  currentWeight: number,
): WorkoutDraft | null {
  const cleanedPrompt = prompt.trim().toLowerCase().replace(/[.!?]/g, '')

  if (!cleanedPrompt) {
    return null
  }

  const type = detectWorkoutType(cleanedPrompt, fallbackType)
  const metric = getWorkoutMetric(type)
  const stepsMatch = cleanedPrompt.match(/(\d[\d\s]{2,})\s*шаг/)
  const caloriesMatch = cleanedPrompt.match(/(\d+)\s*(?:ккал|кал)/)
  const repsMatch = cleanedPrompt.match(/(\d+)\s*(?:раз(?:а)?|повтор\w*)/)
  const setsMatch = cleanedPrompt.match(/(\d+)\s*(?:подход\w*|сет\w*)/)
  const minutesMatch = cleanedPrompt.match(/(\d+)\s*(?:мин|минут\w*)/)

  let value = 0

  if (metric === 'steps') {
    value = stepsMatch
      ? Number(stepsMatch[1].replace(/\s+/g, ''))
      : Math.max(2000, Number(minutesMatch?.[1] ?? 0) * 100 || workoutTypeMeta[type].defaultValue)
  } else if (caloriesMatch) {
    value = Number(caloriesMatch[1])
  } else if (minutesMatch) {
    const minutes = Number(minutesMatch[1])
    const perMinute = type === 'strength' ? 7 : type === 'mobility' ? 3 : 9
    value = Math.round(minutes * perMinute)
  } else if (repsMatch && setsMatch) {
    value = Math.max(80, Math.round(Number(repsMatch[1]) * Number(setsMatch[1]) * 2.2))
  } else {
    value = workoutTypeMeta[type].defaultValue
  }

  const title = buildWorkoutTitle(cleanedPrompt, type)
  const summaryPrefix = caloriesMatch || stepsMatch ? 'Зафиксировал черновик.' : 'Оценил нагрузку по описанию.'
  const estimatedCalories = metric === 'steps' ? estimateCaloriesFromSteps(value, currentWeight) : value

  return {
    entry: {
      id: createId('workout-gpt'),
      type,
      title,
      details: capitalize(prompt.trim()),
      value,
      metric,
      estimatedCalories,
      source: 'gpt',
    },
    summary: `${summaryPrefix} «${title}» · ${metric === 'steps' ? `${formatNumber(value)} шагов` : `${formatNumber(value)} ккал`} · ~${formatNumber(estimatedCalories)} ккал.`,
  }
}

function buildDraftFromPrompt(prompt: string, mealId: string): ChatDraft | null {
  const cleanedPrompt = prompt.trim().toLowerCase().replace(/[.!?]/g, '')

  if (!cleanedPrompt) {
    return null
  }

  const segments = cleanedPrompt
    .split(/,|;| и /)
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (!segments.length) {
    return null
  }

  const items = segments.map((segment) => {
    const gramsMatch = segment.match(/(\d+)\s*г(?:рамм|р)?/)
    const matchedFood = foodCatalog.find((food) => segment.includes(food.key))
    const grams = gramsMatch ? Number(gramsMatch[1]) : matchedFood?.defaultGrams ?? 150

    if (!matchedFood) {
      const genericName = capitalize(segment.replace(/\d+\s*г(?:рамм|р)?/g, '').trim()) || 'Блюдо'

      return {
        id: createId('gpt'),
        name: genericName,
        grams,
        calories: roundMacro(grams * 0.95),
        protein: roundMacro(grams * 0.06),
        fat: roundMacro(grams * 0.03),
        carbs: roundMacro(grams * 0.1),
        source: 'gpt' as const,
      }
    }

    return {
      id: createId('gpt'),
      name: matchedFood.label,
      grams,
      calories: roundMacro((matchedFood.calories * grams) / 100),
      protein: roundMacro((matchedFood.protein * grams) / 100),
      fat: roundMacro((matchedFood.fat * grams) / 100),
      carbs: roundMacro((matchedFood.carbs * grams) / 100),
      source: 'gpt' as const,
    }
  })

  const totals = sumEntries(items)
  const title = buildFoodDraftTitle(items.map((item) => item.name))

  return {
    mealId,
    title,
    totals,
    items,
    summary: `Подготовил «${title}» для приема пищи «${mealLabels[mealId]}».`,
  }
}

function Surface({ children, className = '' }: SurfaceProps) {
  return (
    <section
      className={`rounded-[26px] border border-[#dce6de] bg-white/96 p-4 shadow-[0_24px_60px_-44px_rgba(24,92,63,0.18)] sm:p-5 ${className}`}
    >
      {children}
    </section>
  )
}

function MacroIcon({ macro, className = 'h-4 w-4' }: { macro: MacroKey; className?: string }) {
  if (macro === 'calories') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3c1.7 2.1 2.4 3.9 2.4 5.5s-.8 3-2.4 4.2c-1.6-1.2-2.4-2.6-2.4-4.2S10.3 5.1 12 3Z" />
        <path d="M12 10.7c3 1.6 4.6 3.5 4.6 5.8a4.6 4.6 0 0 1-9.2 0c0-2.2 1.5-4 4.6-5.8Z" />
      </svg>
    )
  }

  if (macro === 'protein') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4.5 9.5v5" />
        <path d="M7 8v8" />
        <path d="M17 8v8" />
        <path d="M19.5 9.5v5" />
        <path d="M9.5 12h5" />
      </svg>
    )
  }

  if (macro === 'fat') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3.5c2.9 3.3 4.8 6 4.8 8.5a4.8 4.8 0 0 1-9.6 0c0-2.5 1.9-5.2 4.8-8.5Z" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 16c5.2 0 8.5-3.1 9.7-9-5.8.2-9.2 3.4-9.7 9Z" />
      <path d="M9 18c3.2 0 5.5-2.2 6.7-6" />
    </svg>
  )
}

function MacroPill({ macro, value, goal, compact = false }: MacroPillProps) {
  const meta = macroMeta[macro]

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full font-semibold ${meta.chipClass} ${
        compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-2 text-xs'
      }`}
    >
      <span className={`flex items-center justify-center rounded-full ${meta.iconBg} ${meta.iconColor} ${compact ? 'size-5' : 'size-6'}`}>
        <MacroIcon macro={macro} className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      </span>
      <span>{goal !== undefined ? `${value}/${goal}` : value}</span>
    </span>
  )
}

function MacroCard({ macro, current, goal }: MacroCardProps) {
  const meta = macroMeta[macro]
  const progress = Math.min(100, Math.round((current / goal) * 100))

  return (
    <article className={`rounded-[22px] border p-3.5 sm:p-4 ${meta.tintClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`flex size-8 items-center justify-center rounded-full ${meta.iconBg} ${meta.iconColor} sm:size-9`}>
            <MacroIcon macro={macro} />
          </span>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#627568] sm:text-sm">{meta.label}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold sm:px-3 sm:text-xs ${meta.badgeBg} ${meta.badgeText}`}>
          {progress}%
        </span>
      </div>

      <p className="mt-3 text-xl font-semibold text-[#102018] sm:text-2xl">{formatNumber(current)}</p>
      <p className="mt-1 text-xs text-[#5d6e62] sm:text-sm">из {formatNumber(goal)}</p>

      <div className="mt-3 h-2 rounded-full bg-[#e6eeea] sm:mt-4">
        <div className={`h-full rounded-full ${meta.barClass}`} style={{ width: `${progress}%` }} />
      </div>
    </article>
  )
}

function MetricCard({ label, value, note }: MetricCardProps) {
  return (
    <article className="rounded-[20px] border border-[#dce6de] bg-[#fafcfb] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#67796d] sm:text-sm">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#102018] sm:mt-3 sm:text-3xl">{value}</p>
      <p className="mt-1.5 text-xs leading-5 text-[#617165] sm:mt-2 sm:text-sm sm:leading-6">{note}</p>
    </article>
  )
}

const formFieldClassName =
  'h-12 rounded-2xl border border-[#d5e2d9] bg-[#fbfdfb] px-4 text-[#102018] outline-none transition focus:border-[#4d9469]'

const formFieldWhiteClassName =
  'h-12 rounded-2xl border border-[#d5e2d9] bg-white px-4 text-[#102018] outline-none transition focus:border-[#4d9469]'

const readOnlyFieldClassName =
  'h-12 rounded-2xl border border-[#dfe7e2] bg-[#f1f5f2] px-4 text-[#6e7e74] outline-none'

function FieldGroup({ label, hint, children }: FieldGroupProps) {
  return (
    <label className="grid gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6d836f]">{label}</span>
      {children}
      {hint ? <span className="text-xs leading-5 text-[#708276]">{hint}</span> : null}
    </label>
  )
}

function App() {
  const todayKey = toIsoDate(new Date())
  const [activeTab, setActiveTab] = useState<AppTab>('today')
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [addMode, setAddMode] = useState<AddMode>('manual')
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured)
  const [hasLoadedRemoteState, setHasLoadedRemoteState] = useState(!isFirebaseConfigured)
  const [cloudReady, setCloudReady] = useState(false)
  const [authLoadSlow, setAuthLoadSlow] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(isFirebaseConfigured ? 'idle' : 'local')
  const [cloudError, setCloudError] = useState<string | null>(null)
  const [statsRange, setStatsRange] = useState<StatsRange>('30d')
  const [profile, setProfile] = useState<Profile>(() => readStorage('calories.profile', initialProfile))
  const [mealHistory, setMealHistory] = useState<MealHistory>(() => getInitialMealHistory(todayKey))
  const [workoutHistory, setWorkoutHistory] = useState<WorkoutHistory>(getInitialWorkoutHistory)
  const [weightHistory, setWeightHistory] = useState<WeightHistoryEntry[]>(getInitialWeightHistory)
  const [manualForm, setManualForm] = useState<ManualForm>(() => createDefaultManualForm())
  const [chatMealId, setChatMealId] = useState(() => getSuggestedMealId())
  const [chatPrompt, setChatPrompt] = useState('')
  const [chatDraft, setChatDraft] = useState<ChatDraft | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(initialChatMessages)
  const [foodChatPending, setFoodChatPending] = useState(false)
  const [workoutAddMode, setWorkoutAddMode] = useState<AddMode>('manual')
  const [workoutForm, setWorkoutForm] = useState<WorkoutForm>(createDefaultWorkoutForm)
  const [workoutChatType, setWorkoutChatType] = useState<WorkoutType>('strength')
  const [workoutChatPrompt, setWorkoutChatPrompt] = useState('')
  const [workoutChatDraft, setWorkoutChatDraft] = useState<WorkoutDraft | null>(null)
  const [workoutChatMessages, setWorkoutChatMessages] = useState<ChatMessage[]>(initialChatMessages)
  const [workoutChatPending, setWorkoutChatPending] = useState(false)
  const [weightInput, setWeightInput] = useState(formatWeight(initialProfile.currentWeight))
  const [pendingWeightConfirmation, setPendingWeightConfirmation] = useState<number | null>(null)
  const [pendingMealDeletion, setPendingMealDeletion] = useState<PendingMealDeletion>(null)
  const [pendingWorkoutDeletion, setPendingWorkoutDeletion] = useState<PendingWorkoutDeletion>(null)
  const meals = mealHistory[todayKey] ?? cloneMeals()
  const workouts = workoutHistory[todayKey] ?? []

  useEffect(() => {
    window.localStorage.setItem('calories.mealHistory', JSON.stringify(mealHistory))
    window.localStorage.setItem('calories.meals', JSON.stringify(meals))
  }, [mealHistory, meals])

  useEffect(() => {
    window.localStorage.setItem('calories.workoutHistory', JSON.stringify(workoutHistory))
  }, [workoutHistory])

  useEffect(() => {
    window.localStorage.setItem('calories.profile', JSON.stringify(profile))
  }, [profile])

  useEffect(() => {
    window.localStorage.setItem('calories.weightHistory', JSON.stringify(weightHistory))
  }, [weightHistory])

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setAuthReady(true)
      setHasLoadedRemoteState(true)
      setSyncStatus('local')
      setCloudReady(false)
      return
    }

    let ignore = false
    let unsubscribe: () => void = () => {}

    const startAuthObserver = () => {
      unsubscribe = observeAuthState(async (nextUser) => {
        if (ignore) {
          return
        }

        setUser(nextUser)
        setCloudError(null)

        if (!nextUser) {
          setHasLoadedRemoteState(false)
          setSyncStatus('idle')
          setCloudReady(false)
          setAuthReady(true)
          return
        }

        setAuthReady(false)
        setSyncStatus('loading')
        setHasLoadedRemoteState(false)
        setCloudReady(false)

        try {
          const remoteState = await loadUserState(nextUser.uid)

          if (ignore) {
            return
          }

          if (remoteState?.profile) {
            setProfile(remoteState.profile as Profile)
          }

          if (remoteState?.mealHistory) {
            setMealHistory(sanitizeMealHistory(remoteState.mealHistory as MealHistory))
          } else if (remoteState?.meals) {
            const sanitizedLegacyMeals = sanitizeMeals(remoteState.meals as Meal[])

            setMealHistory(
              sanitizedLegacyMeals.some((meal) => meal.items.length > 0)
                ? { [todayKey]: sanitizedLegacyMeals }
                : {},
            )
          } else {
            setMealHistory({})
          }

          if (remoteState?.workoutHistory) {
            setWorkoutHistory(sanitizeWorkoutHistory(remoteState.workoutHistory as WorkoutHistory))
          } else {
            setWorkoutHistory({})
          }

          if (remoteState?.weightHistory) {
            setWeightHistory(remoteState.weightHistory as WeightHistoryEntry[])
          } else {
            setWeightHistory([])
          }

          setCloudReady(true)
          setSyncStatus('saved')
        } catch (error) {
          if (!ignore) {
            setCloudError(getFirebaseErrorMessage(error, 'Не удалось загрузить данные из Firebase.'))
            setSyncStatus('error')
          }
        } finally {
          if (!ignore) {
            setHasLoadedRemoteState(true)
            setAuthReady(true)
          }
        }
      })
    }

    void (async () => {
      try {
        await resolvePendingRedirectSignIn()
      } catch (error) {
        if (!ignore) {
          setCloudError(getFirebaseErrorMessage(error, 'Не удалось завершить вход через Google.'))
        }
      }

      if (!ignore) {
        startAuthObserver()
      }
    })()

    return () => {
      ignore = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isFirebaseConfigured || authReady) {
      setAuthLoadSlow(false)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setAuthLoadSlow(true)
    }, 5000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [authReady])

  useEffect(() => {
    setWeightInput(formatWeight(profile.currentWeight))
  }, [profile.currentWeight])

  useEffect(() => {
    if (!isFirebaseConfigured || !user || !authReady || !hasLoadedRemoteState || !cloudReady) {
      return
    }

    let active = true
    const timeoutId = window.setTimeout(async () => {
      try {
        setSyncStatus('saving')
        await saveUserState(user, { profile, mealHistory, workoutHistory, weightHistory })

        if (active) {
          setSyncStatus('saved')
          setCloudError(null)
        }
      } catch (error) {
        if (active) {
          setSyncStatus('error')
          setCloudError(getFirebaseErrorMessage(error, 'Не удалось сохранить изменения в Firebase.'))
        }
      }
    }, 700)

    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [authReady, cloudReady, hasLoadedRemoteState, mealHistory, profile, user, weightHistory, workoutHistory])

  const targets = calculateTargets(profile)
  const dayTotals = sumMeals(meals)
  const workoutsTodayCount = workouts.length
  const stepsToday = sumWorkoutMetric(workouts, 'steps')
  const workoutBurnToday = sumWorkoutCalories(workouts)
  const caloriePlan = calculateDailyCaloriePlan(
    targets.active.calories,
    dayTotals.calories,
    workoutBurnToday,
    profile.goalType,
    profile.weeklyRate,
  )
  const caloriesLeft = caloriePlan.effectiveGoalCalories - dayTotals.calories
  const calorieProgress = Math.min(100, Math.round(caloriePlan.foodPercent))
  const trackedWeightHistory = upsertWeightHistoryEntry(weightHistory, todayKey, profile.currentWeight)
  const history = buildHistory(
    mealHistory,
    trackedWeightHistory,
    workoutHistory,
    todayKey,
    dayTotals,
    profile.currentWeight,
    workouts,
  )
  const visibleHistory = filterHistory(history, statsRange)
  const nutritionHistory = visibleHistory.filter((record) => record.calories > 0)
  const visibleWeightHistory = filterHistory(trackedWeightHistory, statsRange)
  const rangeDays = statsRange === '7d' ? 7 : statsRange === '30d' ? 30 : 90
  const averageCalories = Math.round(
    nutritionHistory.reduce((sum, record) => sum + record.calories, 0) / Math.max(1, nutritionHistory.length),
  )
  const averageGoalDelta = Math.round(
    nutritionHistory.reduce((sum, record) => {
      const adjustedGoal =
        targets.active.calories + roundMacro(record.workoutCalories * caloriePlan.workoutCreditRatio)

      return sum + (record.calories - adjustedGoal)
    }, 0) / Math.max(1, nutritionHistory.length),
  )
  const stepHistory = visibleHistory.filter((record) => record.steps > 0)
  const averageSteps = Math.round(
    stepHistory.reduce((sum, record) => sum + record.steps, 0) / Math.max(1, stepHistory.length),
  )
  const weightDelta = Number(
    (
      trackedWeightHistory[trackedWeightHistory.length - 1].value -
      (trackedWeightHistory[trackedWeightHistory.length - 2]?.value ?? trackedWeightHistory[trackedWeightHistory.length - 1].value)
    ).toFixed(1),
  )
  const adherenceDays = nutritionHistory.filter(
    (record) => {
      const adjustedGoal =
        targets.active.calories + roundMacro(record.workoutCalories * caloriePlan.workoutCreditRatio)

      return Math.abs(record.calories - adjustedGoal) <= 150
    },
  ).length
  const totalWorkoutCalories = visibleHistory.reduce((sum, record) => sum + record.workoutCalories, 0)
  const totalWorkouts = visibleHistory.reduce((sum, record) => sum + record.workouts, 0)
  const activeDays = visibleHistory.filter(
    (record) => record.calories > 0 || record.workoutCalories > 0,
  ).length
  const periodStartWeight = visibleWeightHistory[0]?.value ?? profile.currentWeight
  const periodEndWeight = visibleWeightHistory[visibleWeightHistory.length - 1]?.value ?? profile.currentWeight
  const weightChange = Number(
    (periodEndWeight - periodStartWeight).toFixed(1),
  )
  const weightPoints = getChartPoints(visibleWeightHistory.map((entry) => entry.value), 320, 150)
  const startingWeight = trackedWeightHistory[0]?.value ?? profile.currentWeight
  const totalWeightShift = Number((profile.currentWeight - startingWeight).toFixed(1))
  const goalAwareWeightChange =
    profile.goalType === 'bulk' ? totalWeightShift : profile.goalType === 'cut' ? -totalWeightShift : totalWeightShift
  const weightChangeLabel =
    profile.goalType === 'bulk' ? 'Набрано веса' : profile.goalType === 'cut' ? 'Скинуто веса' : 'Изменение веса'
  const remainingToTarget = Number(Math.abs(profile.currentWeight - profile.targetWeight).toFixed(1))
  const totalGoalDistance = Math.abs(startingWeight - profile.targetWeight)
  const goalProgress =
    totalGoalDistance > 0
      ? Math.max(0, Math.min(100, Math.round(((totalGoalDistance - remainingToTarget) / totalGoalDistance) * 100)))
      : 100
  const maxCaloriesChartValue = Math.max(
    1,
    caloriePlan.effectiveGoalCalories,
    ...nutritionHistory.map((record) =>
      Math.max(
        record.calories,
        targets.active.calories + roundMacro(record.workoutCalories * caloriePlan.workoutCreditRatio),
      ),
    ),
  )
  const currentDate = todayKey
  const onboardingRequired = profile.hasCompletedOnboarding !== true
  const hasLoggedWeightToday = weightHistory.some((entry) => entry.date === currentDate)
  const totalEntries = meals.reduce((sum, meal) => sum + meal.items.length, 0)
  const activeTabInfo = tabs.find((tab) => tab.id === activeTab) ?? tabs[0]
  const headerTabLabel = onboardingRequired ? 'Анкета' : activeTabInfo.label
  const latestAssistantMessage =
    chatMessages[chatMessages.length - 1]?.text ??
    'Опиши еду обычным языком. Я подготовлю черновик и добавлю его после подтверждения.'
  const latestWorkoutAssistantMessage =
    workoutChatMessages[workoutChatMessages.length - 1]?.text ??
    'Опиши тренировку обычным языком: упражнения, минуты, шаги или сожженные ккал.'
  const remainingCalories = Math.abs(caloriesLeft)
  const safeZoneWidthPercent = Math.max(0, caloriePlan.safeZoneEndPercent - caloriePlan.safeZoneStartPercent)
  const workoutBonusWidthPercent = Math.max(0, caloriePlan.effectiveGoalPercent - caloriePlan.baseGoalPercent)
  const workoutManualMeta = workoutTypeMeta[workoutForm.type]
  const workoutChatMeta = workoutTypeMeta[workoutChatType]
  const canCompleteOnboarding =
    profile.age > 0 &&
    profile.height > 0 &&
    profile.currentWeight > 0 &&
    profile.targetWeight > 0 &&
    profile.weeklyRate > 0 &&
    (profile.goalMode === 'auto' ||
      (profile.manualCalories > 0 &&
        profile.manualProtein > 0 &&
        profile.manualFat > 0 &&
        profile.manualCarbs > 0))
  const syncMeta: Record<SyncStatus, { label: string; className: string }> = {
    local: {
      label: 'Локально',
      className: 'bg-[#eef4ef] text-[#4b6254]',
    },
    idle: {
      label: 'Без sync',
      className: 'bg-[#f3f5f4] text-[#63736a]',
    },
    loading: {
      label: 'Загрузка',
      className: 'bg-[#eef3ff] text-[#355da7]',
    },
    saving: {
      label: 'Сохранение',
      className: 'bg-[#fff4e7] text-[#b4721b]',
    },
    saved: {
      label: 'Сохранено',
      className: 'bg-[#eaf7f0] text-[#246e52]',
    },
    error: {
      label: 'Ошибка',
      className: 'bg-[#fdeceb] text-[#b44a46]',
    },
  }
  const currentSyncMeta = syncMeta[syncStatus]
  const userName = user?.displayName || user?.email || 'Google user'

  const handleGoogleLogin = async () => {
    try {
      setCloudError(null)
      setIsMenuOpen(false)
      await signInWithGoogle()
    } catch (error) {
      setCloudError(getFirebaseErrorMessage(error, 'Не удалось войти через Google.'))
    }
  }

  const handleLogout = async () => {
    try {
      setCloudError(null)
      setIsMenuOpen(false)
      await signOutCurrentUser()
    } catch (error) {
      setCloudError(getFirebaseErrorMessage(error, 'Не удалось выйти из аккаунта.'))
    }
  }

  const handleManualAdd = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const calories = Number(manualForm.calories)
    const grams = Number(manualForm.grams)
    const protein = Number(manualForm.protein)
    const fat = Number(manualForm.fat)
    const carbs = Number(manualForm.carbs)

    if (!manualForm.name.trim() || !Number.isFinite(calories)) {
      return
    }

    const entry: FoodEntry = {
      id: createId('manual'),
      name: manualForm.name.trim(),
      grams: Number.isFinite(grams) ? grams : 0,
      calories,
      protein: Number.isFinite(protein) ? protein : 0,
      fat: Number.isFinite(fat) ? fat : 0,
      carbs: Number.isFinite(carbs) ? carbs : 0,
      source: 'manual',
    }

    setMealHistory((currentHistory) => ({
      ...currentHistory,
      [currentDate]: (currentHistory[currentDate] ?? cloneMeals()).map((meal) =>
        meal.id === manualForm.mealId
          ? { ...meal, items: [...meal.items, entry] }
          : meal,
      ),
    }))

    setManualForm(createDefaultManualForm())
  }

  const handleManualWorkoutAdd = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const value = Number(workoutForm.value)

    if (!workoutForm.title.trim() || !Number.isFinite(value) || value <= 0) {
      return
    }

    const entry: WorkoutEntry = {
      id: createId('workout-manual'),
      type: workoutForm.type,
      title: workoutForm.title.trim(),
      details: workoutForm.details.trim(),
      value,
      metric: getWorkoutMetric(workoutForm.type),
      estimatedCalories:
        getWorkoutMetric(workoutForm.type) === 'steps'
          ? estimateCaloriesFromSteps(value, profile.currentWeight)
          : value,
      source: 'manual',
    }

    setWorkoutHistory((currentHistory) => ({
      ...currentHistory,
      [currentDate]: [...(currentHistory[currentDate] ?? []), entry],
    }))

    setWorkoutForm(createDefaultWorkoutForm())
  }

  const handleChatMealTargetChange = (nextMealId: string) => {
    setChatMealId(nextMealId)

    setChatDraft((currentDraft) =>
      currentDraft
        ? {
            ...currentDraft,
            mealId: nextMealId,
            summary: `Подготовил «${currentDraft.title}» для приема пищи «${mealLabels[nextMealId]}».`,
          }
        : currentDraft,
    )
  }

  const handleGenerateDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const prompt = chatPrompt.trim()

    if (!prompt) {
      return
    }

    setFoodChatPending(true)

    try {
      let draft: ChatDraft | null = null

      try {
        const parsed = await parseFoodPrompt(prompt)

        draft = {
          mealId: chatMealId,
          title: parsed.title,
          items: parsed.items.map((item) => ({
            id: createId('gpt'),
            name: item.name,
            grams: Math.max(0, roundMacro(item.grams)),
            calories: Math.max(0, roundMacro(item.calories)),
            protein: Math.max(0, roundMacro(item.protein)),
            fat: Math.max(0, roundMacro(item.fat)),
            carbs: Math.max(0, roundMacro(item.carbs)),
            source: 'gpt',
          })),
          totals: {
            calories: Math.max(0, roundMacro(parsed.totals.calories)),
            protein: Math.max(0, roundMacro(parsed.totals.protein)),
            fat: Math.max(0, roundMacro(parsed.totals.fat)),
            carbs: Math.max(0, roundMacro(parsed.totals.carbs)),
          },
          summary: parsed.summary || `Подготовил «${parsed.title}» для приема пищи «${mealLabels[chatMealId]}».`,
        }
      } catch {
        const fallbackDraft = buildDraftFromPrompt(prompt, chatMealId)

        if (fallbackDraft) {
          draft = {
            ...fallbackDraft,
            summary: `${fallbackDraft.summary} Сервер чата недоступен, использую локальную оценку.`,
          }
        }
      }

      if (!draft) {
        return
      }

      setChatMessages((currentMessages) => [
        ...currentMessages,
        { id: createId('user'), role: 'user', text: prompt },
        { id: createId('assistant'), role: 'assistant', text: draft.summary },
      ])
      setChatDraft(draft)
      setChatPrompt('')
    } finally {
      setFoodChatPending(false)
    }
  }

  const handleGenerateWorkoutDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const prompt = workoutChatPrompt.trim()

    if (!prompt) {
      return
    }

    setWorkoutChatPending(true)

    try {
      let draft: WorkoutDraft | null = null

      try {
        const parsed = await parseWorkoutPrompt(prompt, workoutChatType, profile.currentWeight)

        draft = {
          entry: {
            id: createId('workout-gpt'),
            type: parsed.entry.type,
            title: parsed.entry.title,
            details: parsed.entry.details,
            value: Math.max(0, roundMacro(parsed.entry.value)),
            metric: parsed.entry.metric as WorkoutMetric,
            estimatedCalories: Math.max(0, roundMacro(parsed.entry.estimatedCalories)),
            source: 'gpt',
          },
          summary: parsed.summary,
        }
      } catch {
        const fallbackDraft = buildWorkoutDraftFromPrompt(prompt, workoutChatType, profile.currentWeight)

        if (fallbackDraft) {
          draft = {
            ...fallbackDraft,
            summary: `${fallbackDraft.summary} Сервер чата недоступен, использую локальную оценку.`,
          }
        }
      }

      if (!draft) {
        return
      }

      setWorkoutChatMessages((currentMessages) => [
        ...currentMessages,
        { id: createId('user'), role: 'user', text: prompt },
        { id: createId('assistant'), role: 'assistant', text: draft.summary },
      ])
      setWorkoutChatDraft(draft)
      setWorkoutChatPrompt('')
    } finally {
      setWorkoutChatPending(false)
    }
  }

  const handleAcceptDraft = () => {
    if (!chatDraft) {
      return
    }

    setMealHistory((currentHistory) => ({
      ...currentHistory,
      [currentDate]: (currentHistory[currentDate] ?? cloneMeals()).map((meal) =>
        meal.id === chatDraft.mealId
          ? { ...meal, items: [...meal.items, ...chatDraft.items] }
          : meal,
      ),
    }))
    setChatMessages((currentMessages) => [
      ...currentMessages,
      {
        id: createId('assistant'),
        role: 'assistant',
        text: `Черновик принят. Позиции добавлены в «${mealLabels[chatDraft.mealId]}».`,
      },
    ])
    setChatDraft(null)
  }

  const handleAcceptWorkoutDraft = () => {
    if (!workoutChatDraft) {
      return
    }

    setWorkoutHistory((currentHistory) => ({
      ...currentHistory,
      [currentDate]: [...(currentHistory[currentDate] ?? []), workoutChatDraft.entry],
    }))
    setWorkoutChatMessages((currentMessages) => [
      ...currentMessages,
      {
        id: createId('assistant'),
        role: 'assistant',
        text: `Черновик принят. Запись добавлена в тренировки за ${formatShortDate(currentDate)}.`,
      },
    ])
    setWorkoutChatDraft(null)
  }

  const handleRequestMealEntryDeletion = (mealId: string, entryId: string, entryName: string) => {
    setPendingMealDeletion({ mealId, entryId, entryName })
  }

  const handleConfirmMealEntryDeletion = () => {
    if (!pendingMealDeletion) {
      return
    }

    setMealHistory((currentHistory) => ({
      ...currentHistory,
      [currentDate]: (currentHistory[currentDate] ?? cloneMeals()).map((meal) =>
        meal.id === pendingMealDeletion.mealId
          ? { ...meal, items: meal.items.filter((item) => item.id !== pendingMealDeletion.entryId) }
          : meal,
      ),
    }))

    setPendingMealDeletion(null)
  }

  const handleRequestWorkoutDeletion = (entryId: string, entryName: string) => {
    setPendingWorkoutDeletion({ entryId, entryName })
  }

  const handleConfirmWorkoutDeletion = () => {
    if (!pendingWorkoutDeletion) {
      return
    }

    setWorkoutHistory((currentHistory) => ({
      ...currentHistory,
      [currentDate]: (currentHistory[currentDate] ?? []).filter(
        (entry) => entry.id !== pendingWorkoutDeletion.entryId,
      ),
    }))

    setPendingWorkoutDeletion(null)
  }

  const handleSaveWeight = () => {
    if (hasLoggedWeightToday) {
      return
    }

    const parsedWeight = parseLocalizedNumber(weightInput)

    if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
      return
    }

    setPendingWeightConfirmation(parsedWeight)
  }

  const handleConfirmWeightSave = () => {
    if (pendingWeightConfirmation === null) {
      return
    }

    setProfile((currentProfile) => ({
      ...currentProfile,
      currentWeight: pendingWeightConfirmation,
      lastWeightEntryDate: currentDate,
    }))

    setWeightHistory((currentHistory) =>
      upsertWeightHistoryEntry(currentHistory, currentDate, pendingWeightConfirmation),
    )

    setPendingWeightConfirmation(null)
  }

  const handleCompleteOnboarding = () => {
    if (!canCompleteOnboarding) {
      return
    }

    setProfile((currentProfile) => ({
      ...currentProfile,
      hasCompletedOnboarding: true,
      lastWeightEntryDate: currentProfile.lastWeightEntryDate ?? currentDate,
    }))

    if (!weightHistory.some((entry) => entry.date === currentDate)) {
      setWeightHistory((currentHistory) =>
        upsertWeightHistoryEntry(currentHistory, currentDate, profile.currentWeight),
      )
    }

    setActiveTab('today')
  }

  const updateProfile = <K extends keyof Profile>(key: K, value: Profile[K]) => {
    setProfile((currentProfile) => ({
      ...currentProfile,
      [key]: value,
    }))
  }

  const renderSetupBanner = () => (
    <Surface className="border-[#efe4c7] bg-[#fffaf2]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#97713b]">
            Firebase не настроен
          </p>
          <p className="mt-2 text-sm leading-6 text-[#6d5a3f] sm:text-base">
            Заполни `.env.local` по шаблону из `.env.example`, затем включи Google Auth и Firestore. Пошаговая инструкция лежит в `FIREBASE_DEPLOY.md`.
          </p>
        </div>

        <span className="rounded-full bg-[#fff2df] px-4 py-2 text-sm font-semibold text-[#9d6a22]">
          сейчас приложение работает локально
        </span>
      </div>
    </Surface>
  )

  const renderAuthGate = () => (
    <div className="mx-auto max-w-lg py-10 sm:py-16">
      <Surface className="border-[#dde7df] bg-white text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#73857a]">
          Вход в приложение
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[#121914] sm:text-4xl">
          Войди через Google
        </h1>
        <p className="mt-3 text-sm leading-6 text-[#64746a] sm:text-base">
          После входа meals и profile будут читаться из Firestore и синхронизироваться между устройствами.
        </p>

        <button
          type="button"
          onClick={handleGoogleLogin}
          className="mx-auto mt-6 inline-flex h-12 items-center justify-center gap-3 rounded-2xl border border-[#dce6de] bg-[#1b5a3d] px-5 text-sm font-semibold text-white transition hover:bg-[#256b49]"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
            <path fill="#fff" d="M21.8 12.2c0-.7-.1-1.4-.2-2H12v3.7h5.5a4.8 4.8 0 0 1-2 3.1v2.6h3.3c1.9-1.8 3-4.4 3-7.4Z" />
            <path fill="#fff" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.6c-.9.6-2.1 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3v2.7A10 10 0 0 0 12 22Z" />
            <path fill="#fff" d="M6.4 13.8a6 6 0 0 1 0-3.6V7.5H3a10 10 0 0 0 0 9l3.4-2.7Z" />
            <path fill="#fff" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.8 9.8 0 0 0 12 2 10 10 0 0 0 3 7.5l3.4 2.7C7.2 7.7 9.4 5.9 12 5.9Z" />
          </svg>
          Войти через Google
        </button>

        {cloudError ? (
          <p className="mt-4 text-sm text-[#b44a46]">{cloudError}</p>
        ) : null}
      </Surface>
    </div>
  )

  const renderAuthLoading = () => (
    <div className="mx-auto max-w-lg py-10 sm:py-16">
      <Surface className="text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#73857a]">
          Firebase
        </p>
        <p className="mt-3 text-base text-[#56665d]">Проверяем сессию и загружаем данные…</p>
        {authLoadSlow ? (
          <p className="mt-3 text-sm leading-6 text-[#6c7b72]">
            Если экран висит слишком долго, обычно не готов Firestore Database или для локального адреса не добавлен домен 127.0.0.1.
          </p>
        ) : null}
      </Surface>
    </div>
  )

  const renderWeightConfirmationModal = () => {
    if (pendingWeightConfirmation === null) {
      return null
    }

    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#101711]/45 p-3 sm:items-center">
        <div className="w-full max-w-md rounded-[28px] border border-[#dce6de] bg-white p-5 shadow-[0_32px_80px_-36px_rgba(16,42,27,0.35)] sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#73857a]">Подтверждение</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-[#121914] sm:text-3xl">
            Сохранить вес?
          </h2>
          <p className="mt-3 text-sm leading-6 text-[#617165] sm:text-base">
            За {formatShortDate(currentDate)} будет сохранено {formatWeight(pendingWeightConfirmation)} кг. После подтверждения поле заблокируется до следующего дня.
          </p>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setPendingWeightConfirmation(null)}
              className="h-11 rounded-2xl border border-[#d5e2d9] bg-white px-4 text-sm font-semibold text-[#385244] transition hover:bg-[#f5faf7]"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleConfirmWeightSave}
              className="h-11 rounded-2xl bg-[#1b5a3d] px-4 text-sm font-semibold text-white transition hover:bg-[#256b49]"
            >
              Подтвердить
            </button>
          </div>
        </div>
      </div>
    )
  }

  const renderMealDeletionConfirmationModal = () => {
    if (!pendingMealDeletion) {
      return null
    }

    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#101711]/45 p-3 sm:items-center">
        <div className="w-full max-w-md rounded-[28px] border border-[#dce6de] bg-white p-5 shadow-[0_32px_80px_-36px_rgba(16,42,27,0.35)] sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#73857a]">Подтверждение</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-[#121914] sm:text-3xl">
            Удалить прием пищи?
          </h2>
          <p className="mt-3 text-sm leading-6 text-[#617165] sm:text-base">
            Запись «{pendingMealDeletion.entryName}» будет удалена из текущего приема пищи.
          </p>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setPendingMealDeletion(null)}
              className="h-11 rounded-2xl border border-[#d5e2d9] bg-white px-4 text-sm font-semibold text-[#385244] transition hover:bg-[#f5faf7]"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleConfirmMealEntryDeletion}
              className="h-11 rounded-2xl bg-[#b44a46] px-4 text-sm font-semibold text-white transition hover:bg-[#9e3f3b]"
            >
              Удалить
            </button>
          </div>
        </div>
      </div>
    )
  }

  const renderWorkoutDeletionConfirmationModal = () => {
    if (!pendingWorkoutDeletion) {
      return null
    }

    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#101711]/45 p-3 sm:items-center">
        <div className="w-full max-w-md rounded-[28px] border border-[#dce6de] bg-white p-5 shadow-[0_32px_80px_-36px_rgba(16,42,27,0.35)] sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#73857a]">Подтверждение</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-[#121914] sm:text-3xl">
            Удалить активность?
          </h2>
          <p className="mt-3 text-sm leading-6 text-[#617165] sm:text-base">
            Запись «{pendingWorkoutDeletion.entryName}» будет удалена из активности за текущий день.
          </p>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setPendingWorkoutDeletion(null)}
              className="h-11 rounded-2xl border border-[#d5e2d9] bg-white px-4 text-sm font-semibold text-[#385244] transition hover:bg-[#f5faf7]"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleConfirmWorkoutDeletion}
              className="h-11 rounded-2xl bg-[#b44a46] px-4 text-sm font-semibold text-white transition hover:bg-[#9e3f3b]"
            >
              Удалить
            </button>
          </div>
        </div>
      </div>
    )
  }

  const renderOnboarding = () => (
    <div className="mx-auto max-w-5xl space-y-6 py-2">
      <Surface>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#73857a]">Анкета</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[#121914] sm:text-4xl">
          Заполни профиль перед стартом
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#64746a] sm:text-base">
          Эти данные нужны для расчета калорий и КБЖУ. После сохранения анкета уйдет в аккаунт и будет использоваться на всех устройствах.
        </p>
      </Surface>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Surface>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">База</p>
              <div className="mt-4 grid gap-3">
                <FieldGroup label="Пол">
                  <select
                    value={profile.gender}
                    onChange={(event) => updateProfile('gender', event.target.value as Gender)}
                    className={formFieldClassName}
                  >
                    <option value="male">Мужчина</option>
                    <option value="female">Женщина</option>
                  </select>
                </FieldGroup>

                <FieldGroup label="Возраст">
                  <input
                    value={profile.age}
                    onChange={(event) => updateProfile('age', Number(event.target.value))}
                    type="number"
                    placeholder="29"
                    className={formFieldClassName}
                  />
                </FieldGroup>

                <FieldGroup label="Рост, см">
                  <input
                    value={profile.height}
                    onChange={(event) => updateProfile('height', Number(event.target.value))}
                    type="number"
                    placeholder="180"
                    className={formFieldClassName}
                  />
                </FieldGroup>

                <FieldGroup label="Текущий вес, кг" hint="Это станет стартовой точкой и первой записью веса за сегодня.">
                  <input
                    value={profile.currentWeight}
                    onChange={(event) => updateProfile('currentWeight', Number(event.target.value))}
                    type="number"
                    step="0.1"
                    placeholder="78.1"
                    className={formFieldClassName}
                  />
                </FieldGroup>

                <FieldGroup label="Целевой вес, кг">
                  <input
                    value={profile.targetWeight}
                    onChange={(event) => updateProfile('targetWeight', Number(event.target.value))}
                    type="number"
                    step="0.1"
                    placeholder="73"
                    className={formFieldClassName}
                  />
                </FieldGroup>
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">Цель и активность</p>
              <div className="mt-4 grid gap-3">
                <FieldGroup label="Цель">
                  <select
                    value={profile.goalType}
                    onChange={(event) => updateProfile('goalType', event.target.value as GoalType)}
                    className={formFieldClassName}
                  >
                    <option value="cut">Снижение веса</option>
                    <option value="maintain">Поддержание</option>
                    <option value="bulk">Набор</option>
                  </select>
                </FieldGroup>

                <FieldGroup label="Темп, кг в неделю">
                  <input
                    value={profile.weeklyRate}
                    onChange={(event) => updateProfile('weeklyRate', Number(event.target.value))}
                    type="number"
                    step="0.1"
                    placeholder="0.4"
                    className={formFieldClassName}
                  />
                </FieldGroup>

                <FieldGroup label="Активность">
                  <select
                    value={profile.activity}
                    onChange={(event) => updateProfile('activity', event.target.value as ActivityLevel)}
                    className={formFieldClassName}
                  >
                    {activityOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FieldGroup>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-[24px] border border-[#dde7df] bg-[#f7fbf8] p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">Цели КБЖУ</p>
                <p className="mt-2 text-sm leading-6 text-[#617165]">
                  Можно оставить автоматический расчет или сразу задать свои значения вручную.
                </p>
              </div>

              <div className="flex gap-2 rounded-full bg-[#eaf1eb] p-1">
                <button
                  type="button"
                  onClick={() => updateProfile('goalMode', 'auto')}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    profile.goalMode === 'auto' ? 'bg-[#19563a] text-white' : 'text-[#4f6255]'
                  }`}
                >
                  Авто
                </button>
                <button
                  type="button"
                  onClick={() => updateProfile('goalMode', 'manual')}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    profile.goalMode === 'manual' ? 'bg-[#19563a] text-white' : 'text-[#4f6255]'
                  }`}
                >
                  Вручную
                </button>
              </div>
            </div>

            {profile.goalMode === 'manual' ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <FieldGroup label="Калории">
                  <input
                    value={profile.manualCalories}
                    onChange={(event) => updateProfile('manualCalories', Number(event.target.value))}
                    type="number"
                    placeholder="2100"
                    className={formFieldWhiteClassName}
                  />
                </FieldGroup>
                <FieldGroup label="Белки, г">
                  <input
                    value={profile.manualProtein}
                    onChange={(event) => updateProfile('manualProtein', Number(event.target.value))}
                    type="number"
                    placeholder="150"
                    className={formFieldWhiteClassName}
                  />
                </FieldGroup>
                <FieldGroup label="Жиры, г">
                  <input
                    value={profile.manualFat}
                    onChange={(event) => updateProfile('manualFat', Number(event.target.value))}
                    type="number"
                    placeholder="68"
                    className={formFieldWhiteClassName}
                  />
                </FieldGroup>
                <FieldGroup label="Углеводы, г">
                  <input
                    value={profile.manualCarbs}
                    onChange={(event) => updateProfile('manualCarbs', Number(event.target.value))}
                    type="number"
                    placeholder="210"
                    className={formFieldWhiteClassName}
                  />
                </FieldGroup>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <MetricCard label="Ккал" value={`${targets.recommended.calories}`} note="рекомендация" />
                <MetricCard label="Белки" value={`${targets.recommended.protein} г`} note="в день" />
                <MetricCard label="Жиры" value={`${targets.recommended.fat} г`} note="в день" />
                <MetricCard label="Углеводы" value={`${targets.recommended.carbs} г`} note="в день" />
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-[#617165]">Изменить эти данные можно будет позже в профиле.</p>
            <button
              type="button"
              onClick={handleCompleteOnboarding}
              disabled={!canCompleteOnboarding}
              className={`h-11 rounded-2xl px-5 text-sm font-semibold transition ${
                canCompleteOnboarding
                  ? 'bg-[#1b5a3d] text-white hover:bg-[#256b49]'
                  : 'cursor-not-allowed bg-[#dfe7e2] text-[#6e7e74]'
              }`}
            >
              Сохранить и начать
            </button>
          </div>
        </Surface>

        <div className="space-y-6">
          <Surface className="bg-[linear-gradient(180deg,#f7fbf8_0%,#f1f7f3_100%)]">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">Расчет сейчас</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[#102018]">
              {formatNumber(targets.active.calories)} ккал в день
            </h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <MetricCard label="BMR" value={`${targets.bmr}`} note="базовый обмен" />
              <MetricCard label="TDEE" value={`${targets.tdee}`} note="поддержание с активностью" />
              <MetricCard
                label="Коррекция"
                value={`${targets.adjustment > 0 ? '+' : ''}${targets.adjustment}`}
                note="добавка или дефицит под цель"
              />
              <MetricCard
                label="Активная цель"
                value={profile.goalMode === 'auto' ? 'авто' : 'ручная'}
                note="какой режим сейчас используется"
              />
            </div>
          </Surface>

          <Surface>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">Что важно указать</p>
            <div className="mt-4 space-y-3 text-sm leading-6 text-[#617165]">
              {[
                'Пол, возраст, рост и текущий вес нужны для стартового расчета расхода.',
                'Цель и общий уровень активности нужны для стартового расчета поддержки и дефицита.',
                'Шаги и конкретные тренировки лучше заносить по факту на главном экране, а не угадывать средней цифрой.',
                'Если хочешь полностью контролировать КБЖУ сам, включи ручной режим и задай свои цифры.',
              ].map((item) => (
                <div key={item} className="rounded-[22px] border border-[#dde7df] bg-[#f7fbf8] p-4">
                  {item}
                </div>
              ))}
            </div>
          </Surface>
        </div>
      </div>
    </div>
  )

  const renderToday = () => (
    <div className="space-y-4 sm:space-y-5">
      <Surface className="bg-white">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7a8b80]">
                Калории сегодня
              </p>

              <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h1 className="text-[2.8rem] font-semibold tracking-[-0.08em] text-[#121914] sm:text-[3.8rem]">
                    {formatNumber(dayTotals.calories)}
                  </h1>
                  <p className="text-sm text-[#68786d]">из {formatNumber(caloriePlan.effectiveGoalCalories)} ккал с учетом тренировки</p>
                </div>

                <span
                  className={`inline-flex rounded-full px-4 py-2 text-sm font-semibold ${
                    caloriesLeft >= 0 ? 'bg-[#eef5f0] text-[#2d6650]' : 'bg-[#fff1ec] text-[#b44a46]'
                  }`}
                >
                  {caloriesLeft >= 0 ? 'Осталось' : 'Перебор'} {formatNumber(remainingCalories)} ккал
                </span>
              </div>
            </div>

            <div className="mt-5 rounded-[22px] border border-[#e6ece7] bg-[#f9fbf9] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[#18211b]">Дневной прогресс</p>
                  <p className="mt-1 text-sm text-[#68786d]">
                    {caloriesLeft >= 0
                      ? `Еще ${formatNumber(remainingCalories)} ккал до лимита с учетом тренировки`
                      : `Выше лимита на ${formatNumber(remainingCalories)} ккал`}
                  </p>
                </div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7a8b80]">
                  {calorieProgress}%
                </p>
              </div>

              <div className="relative mt-3 h-2.5 overflow-hidden rounded-full bg-[#e4ebe6]">
                {workoutBonusWidthPercent > 0 ? (
                  <div
                    className="absolute inset-y-0 bg-[#bfe4cd]"
                    style={{
                      left: `${caloriePlan.baseGoalPercent}%`,
                      width: `${workoutBonusWidthPercent}%`,
                    }}
                  />
                ) : null}
                <div
                  className="absolute inset-y-0 w-px bg-[#8ea494]"
                  style={{ left: `${caloriePlan.baseGoalPercent}%` }}
                />
                <div
                  className="absolute inset-y-[1px] rounded-full border border-[#5d9c75]/55 bg-[#e6f5ec]/80"
                  style={{
                    left: `${caloriePlan.safeZoneStartPercent}%`,
                    width: `${safeZoneWidthPercent}%`,
                  }}
                />
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${
                    dayTotals.calories > caloriePlan.safeZoneMax ? 'bg-[#e46c3f]' : 'bg-[#f4a340]'
                  }`}
                  style={{ width: `${caloriePlan.foodPercent}%` }}
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7b8a80] sm:text-xs">
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5">
                  <span className="size-2 rounded-full bg-[#f4a340]" />
                  {formatNumber(dayTotals.calories)} съедено
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5">
                  <span className="size-2 rounded-full bg-[#8ea494]" />
                  {formatNumber(targets.active.calories)} база
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5">
                  <span className="size-2 rounded-full bg-[#78bb93]" />
                  +{formatNumber(caloriePlan.workoutCredit)} тренировка
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5">
                  <span className="size-2 rounded-full border border-[#5d9c75] bg-[#e6f5ec]" />
                  safe {formatNumber(caloriePlan.safeZoneMin)}-{formatNumber(caloriePlan.safeZoneMax)}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7b8a80] sm:text-xs">
                <span>{formatNumber(dayTotals.calories)} съедено</span>
                <span>{formatNumber(caloriePlan.effectiveGoalCalories)} лимит дня</span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                <div className="rounded-[16px] border border-[#e5ece7] bg-white px-3 py-2.5 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7b8a80]">База</p>
                  <p className="mt-1 text-base font-semibold text-[#121914]">{formatNumber(targets.active.calories)}</p>
                </div>
                <div className="rounded-[16px] border border-[#e5ece7] bg-white px-3 py-2.5 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7b8a80]">Тренировка</p>
                  <p className="mt-1 text-base font-semibold text-[#1c6b47]">+{formatNumber(caloriePlan.workoutCredit)}</p>
                </div>
                <div className="rounded-[16px] border border-[#e5ece7] bg-white px-3 py-2.5 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7b8a80]">Safe</p>
                  <p className="mt-1 text-base font-semibold text-[#121914]">
                    {formatNumber(caloriePlan.safeZoneMin)}-{formatNumber(caloriePlan.safeZoneMax)}
                  </p>
                </div>
                <div className="hidden rounded-[16px] border border-[#e5ece7] bg-white px-3 py-2.5 text-center sm:block">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7b8a80]">Осталось</p>
                  <p className="mt-1 text-base font-semibold text-[#121914]">{formatNumber(remainingCalories)}</p>
                </div>
              </div>

              <p className="mt-3 text-xs leading-5 text-[#708276] sm:text-sm">
                Тренировочные ккал возвращаю в питание не полностью, а примерно на {Math.round(caloriePlan.workoutCreditRatio * 100)}%: так безопаснее, потому что часы и формулы часто завышают расход, а часть активности уже сидит в общем уровне активности.
              </p>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <MacroPill macro="protein" value={dayTotals.protein} goal={targets.active.protein} />
              <MacroPill macro="fat" value={dayTotals.fat} goal={targets.active.fat} />
              <MacroPill macro="carbs" value={dayTotals.carbs} goal={targets.active.carbs} />
            </div>
          </div>

          <div className="xl:w-[25rem] xl:shrink-0">
            <div className="rounded-[22px] border border-[#e6ece7] bg-[#fafcfb] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7a8b80]">
                    Вес сегодня
                  </p>
                  <p className="mt-2 text-3xl font-semibold tracking-[-0.06em] text-[#121914]">
                    {formatWeight(profile.currentWeight)} кг
                  </p>
                </div>

                <span className="rounded-full bg-[#eef5f0] px-3 py-2 text-xs font-semibold text-[#2d6650]">
                  {weightDelta < 0 ? '-' : '+'}{formatWeight(Math.abs(weightDelta))} кг
                </span>
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  value={weightInput}
                  onChange={(event) => setWeightInput(event.target.value)}
                  type="text"
                  inputMode="decimal"
                  disabled={hasLoggedWeightToday}
                  placeholder="78,1"
                  className={`h-11 flex-1 rounded-2xl border px-4 text-sm outline-none transition ${
                    hasLoggedWeightToday
                      ? 'cursor-not-allowed border-[#dfe7e2] bg-[#f1f5f2] text-[#7a8b80]'
                      : 'border-[#d5e2d9] bg-white text-[#102018] focus:border-[#4d9469]'
                  }`}
                />
                <button
                  type="button"
                  onClick={handleSaveWeight}
                  disabled={hasLoggedWeightToday}
                  className={`h-11 rounded-2xl px-4 text-sm font-semibold transition ${
                    hasLoggedWeightToday
                      ? 'cursor-not-allowed bg-[#dfe7e2] text-[#6e7e74]'
                      : 'bg-[#1b5a3d] text-white hover:bg-[#256b49]'
                  }`}
                >
                  {hasLoggedWeightToday ? 'Сохранено' : 'Сохранить'}
                </button>
              </div>

              <p className="mt-3 text-xs leading-5 text-[#708276] sm:text-sm">
                {hasLoggedWeightToday
                  ? `Вес за ${formatShortDate(currentDate)} уже сохранен.`
                  : 'Вес можно сохранить один раз в день после подтверждения.'}
              </p>
            </div>
          </div>
        </div>
      </Surface>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MacroCard macro="calories" current={dayTotals.calories} goal={caloriePlan.effectiveGoalCalories} />
        <MacroCard macro="protein" current={dayTotals.protein} goal={targets.active.protein} />
        <MacroCard macro="fat" current={dayTotals.fat} goal={targets.active.fat} />
        <MacroCard macro="carbs" current={dayTotals.carbs} goal={targets.active.carbs} />
      </div>

      <Surface>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6d836f]">
              Добавление
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-[#102018] sm:text-[2rem]">
              Добавить еду
            </h2>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <select
              value={addMode === 'chat' ? chatDraft?.mealId ?? chatMealId : manualForm.mealId}
              onChange={(event) => {
                if (addMode === 'chat') {
                  handleChatMealTargetChange(event.target.value)
                  return
                }

                setManualForm((currentForm) => ({ ...currentForm, mealId: event.target.value }))
              }}
              className="h-11 rounded-2xl border border-[#d5e2d9] bg-white px-4 text-sm text-[#264735] outline-none"
            >
              {meals.map((meal) => (
                <option key={meal.id} value={meal.id}>
                  {meal.title}
                </option>
              ))}
            </select>

            <div className="flex gap-2 rounded-full bg-[#eef3ef] p-1">
              <button
                type="button"
                onClick={() => setAddMode('manual')}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  addMode === 'manual' ? 'bg-[#1b5a3d] text-white' : 'text-[#476053]'
                }`}
              >
                Вручную
              </button>
              <button
                type="button"
                onClick={() => setAddMode('chat')}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  addMode === 'chat' ? 'bg-[#1b5a3d] text-white' : 'text-[#476053]'
                }`}
              >
                GPT
              </button>
            </div>
          </div>
        </div>

        {addMode === 'manual' ? (
          <form onSubmit={handleManualAdd} className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <input
              value={manualForm.name}
              onChange={(event) => setManualForm((currentForm) => ({ ...currentForm, name: event.target.value }))}
              placeholder="Название"
              className="h-11 rounded-2xl border border-[#d5e2d9] bg-[#fbfdfb] px-4 text-sm text-[#102018] outline-none transition focus:border-[#4d9469]"
            />
            <input
              value={manualForm.grams}
              onChange={(event) => setManualForm((currentForm) => ({ ...currentForm, grams: event.target.value }))}
              type="number"
              placeholder="Граммы"
              className="h-11 rounded-2xl border border-[#d5e2d9] bg-[#fbfdfb] px-4 text-sm text-[#102018] outline-none transition focus:border-[#4d9469]"
            />
            <input
              value={manualForm.calories}
              onChange={(event) => setManualForm((currentForm) => ({ ...currentForm, calories: event.target.value }))}
              type="number"
              placeholder="Калории"
              className="h-11 rounded-2xl border border-[#d5e2d9] bg-[#fbfdfb] px-4 text-sm text-[#102018] outline-none transition focus:border-[#4d9469]"
            />

            <div className="sm:col-span-2 xl:col-span-1">
              <div className="flex h-11 items-center rounded-2xl border border-[#d5e2d9] bg-[#fbfdfb] px-4 text-sm text-[#5d6e62]">
                <MacroIcon macro="protein" className="mr-2 h-4 w-4 text-[#2967db]" />
                <input
                  value={manualForm.protein}
                  onChange={(event) => setManualForm((currentForm) => ({ ...currentForm, protein: event.target.value }))}
                  type="number"
                  placeholder="Белки"
                  className="w-full bg-transparent text-[#102018] outline-none"
                />
              </div>
            </div>
            <div className="sm:col-span-2 xl:col-span-1">
              <div className="flex h-11 items-center rounded-2xl border border-[#d5e2d9] bg-[#fbfdfb] px-4 text-sm text-[#5d6e62]">
                <MacroIcon macro="fat" className="mr-2 h-4 w-4 text-[#b78617]" />
                <input
                  value={manualForm.fat}
                  onChange={(event) => setManualForm((currentForm) => ({ ...currentForm, fat: event.target.value }))}
                  type="number"
                  placeholder="Жиры"
                  className="w-full bg-transparent text-[#102018] outline-none"
                />
              </div>
            </div>
            <div className="sm:col-span-2 xl:col-span-1">
              <div className="flex h-11 items-center rounded-2xl border border-[#d5e2d9] bg-[#fbfdfb] px-4 text-sm text-[#5d6e62]">
                <MacroIcon macro="carbs" className="mr-2 h-4 w-4 text-[#24845c]" />
                <input
                  value={manualForm.carbs}
                  onChange={(event) => setManualForm((currentForm) => ({ ...currentForm, carbs: event.target.value }))}
                  type="number"
                  placeholder="Углеводы"
                  className="w-full bg-transparent text-[#102018] outline-none"
                />
              </div>
            </div>
            <button
              type="submit"
              className="h-11 rounded-2xl bg-[#102018] px-5 text-sm font-semibold text-white transition hover:bg-[#1d3126] sm:col-span-2 xl:col-span-1"
            >
              Добавить
            </button>
          </form>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-[#66776b]">
              {foodChatPending ? 'Считаю КБЖУ по описанию…' : chatDraft ? chatDraft.summary : latestAssistantMessage}
            </p>

            <form onSubmit={handleGenerateDraft} className="grid gap-3 xl:grid-cols-[1fr_auto]">
              <textarea
                value={chatPrompt}
                onChange={(event) => setChatPrompt(event.target.value)}
                rows={3}
                disabled={foodChatPending}
                placeholder="180 г гречки, 150 г курицы и салат"
                className="w-full rounded-[20px] border border-[#d5e2d9] bg-white px-4 py-3 text-sm text-[#102018] outline-none transition focus:border-[#4d9469]"
              />
              <button
                type="submit"
                disabled={foodChatPending}
                className="h-11 rounded-2xl bg-[#1b5a3d] px-5 text-sm font-semibold text-white transition hover:bg-[#256b49] xl:h-auto"
              >
                {foodChatPending ? 'Считаю…' : 'Подготовить'}
              </button>
            </form>

            {chatDraft ? (
              <div className="rounded-[20px] border border-[#d7e5db] bg-[#fbfdfb] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#73857a]">Черновик блюда</p>
                    <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-[#102018]">{chatDraft.title}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <MacroPill macro="calories" value={chatDraft.totals.calories} compact />
                      <MacroPill macro="protein" value={chatDraft.totals.protein} compact />
                      <MacroPill macro="fat" value={chatDraft.totals.fat} compact />
                      <MacroPill macro="carbs" value={chatDraft.totals.carbs} compact />
                    </div>
                  </div>

                  <div className="flex min-w-[13rem] flex-col gap-2">
                    <span className="rounded-full bg-[#e2f4e7] px-3 py-1 text-center text-[11px] font-semibold text-[#1f6547] sm:text-xs">
                      {chatDraft.items.length} поз.
                    </span>
                    <select
                      value={chatDraft.mealId}
                      onChange={(event) => handleChatMealTargetChange(event.target.value)}
                      className="h-10 rounded-2xl border border-[#d5e2d9] bg-white px-3 text-sm text-[#264735] outline-none"
                    >
                      {meals.map((meal) => (
                        <option key={meal.id} value={meal.id}>
                          {meal.title}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-[#66776b]">Можно поменять, куда вставить блюдо, прямо перед подтверждением.</p>
                  </div>
                </div>

                <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {chatDraft.items.map((item) => (
                    <li key={item.id} className="rounded-[16px] border border-[#e3ebe5] bg-white px-3 py-3 text-sm text-[#334a3d]">
                      <p className="font-semibold">{item.name}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-[#7a8b7f] sm:text-xs">{item.grams} г</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <MacroPill macro="calories" value={item.calories} compact />
                        <MacroPill macro="protein" value={item.protein} compact />
                        <MacroPill macro="fat" value={item.fat} compact />
                        <MacroPill macro="carbs" value={item.carbs} compact />
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleAcceptDraft}
                    className="h-10 rounded-2xl bg-[#1b5a3d] px-4 text-sm font-semibold text-white transition hover:bg-[#256b49]"
                  >
                    Принять
                  </button>
                  <button
                    type="button"
                    onClick={() => setChatDraft(null)}
                    className="h-10 rounded-2xl border border-[#d5e2d9] bg-white px-4 text-sm font-medium text-[#385244] transition hover:bg-[#f5faf7]"
                  >
                    Очистить
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Surface>

      <Surface>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6d836f]">
              Лог
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-[#102018] sm:text-[2rem]">
              Приемы пищи
            </h2>
          </div>

          <div className="rounded-full bg-[#eef5ef] px-3 py-2 text-xs font-semibold text-[#446050]">
            {totalEntries} записей
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
          {meals.map((meal) => {
            const mealTotals = sumEntries(meal.items)
            const tone = mealTones[meal.id]

            return (
              <article key={meal.id} className={`rounded-[24px] border p-4 shadow-[0_16px_40px_-34px_rgba(21,77,54,0.16)] ${tone.card}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-semibold tracking-[-0.04em] text-[#102018] sm:text-2xl">
                      {meal.title}
                    </h3>
                    <p className="mt-1 text-xs text-[#627367] sm:text-sm">{meal.items.length} позиций</p>
                  </div>

                  <div className={`rounded-[18px] px-3 py-2.5 text-right ${tone.total}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em]">Итого</p>
                    <p className="mt-1 text-base font-semibold sm:text-lg">{mealTotals.calories} ккал</p>
                  </div>
                </div>

                <ul className="mt-4 space-y-2.5">
                  {meal.items.length === 0 ? (
                    <li className="rounded-[18px] border border-dashed border-[#d6e1da] bg-white/70 p-3.5 text-sm text-[#708276]">
                      Пока пусто. Добавь еду вручную или через GPT.
                    </li>
                  ) : null}
                  {meal.items.map((item) => (
                    <li key={item.id} className="rounded-[18px] border border-[#dde7df] bg-white/88 p-3.5">
                      <div className="flex flex-wrap items-start justify-between gap-2.5">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-[#102018] sm:text-base">{item.name}</p>
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${getSourceClass(item.source)}`}>
                              {getSourceLabel(item.source)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-[#66776b] sm:text-sm">{item.grams} г</p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <MacroPill macro="calories" value={item.calories} compact />
                          <button
                            type="button"
                            onClick={() => handleRequestMealEntryDeletion(meal.id, item.id, item.name)}
                            className="inline-flex h-8 items-center justify-center rounded-full border border-[#e5d8d8] bg-[#fff6f5] px-3 text-[11px] font-semibold text-[#b44a46] transition hover:bg-[#fdeceb]"
                          >
                            Удалить
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <MacroPill macro="protein" value={item.protein} compact />
                        <MacroPill macro="fat" value={item.fat} compact />
                        <MacroPill macro="carbs" value={item.carbs} compact />
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            )
          })}
        </div>
      </Surface>

      <Surface>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6d836f]">
              Активность
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-[#102018] sm:text-[2rem]">
              Тренировки и шаги
            </h2>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <select
              value={workoutAddMode === 'chat' ? workoutChatType : workoutForm.type}
              onChange={(event) => {
                const nextType = event.target.value as WorkoutType

                if (workoutAddMode === 'chat') {
                  setWorkoutChatType(nextType)
                  return
                }

                setWorkoutForm((currentForm) => ({ ...currentForm, type: nextType }))
              }}
              className="h-11 rounded-2xl border border-[#d5e2d9] bg-white px-4 text-sm text-[#264735] outline-none"
            >
              {workoutTypes.map((type) => (
                <option key={type} value={type}>
                  {workoutTypeMeta[type].label}
                </option>
              ))}
            </select>

            <div className="flex gap-2 rounded-full bg-[#eef3ef] p-1">
              <button
                type="button"
                onClick={() => setWorkoutAddMode('manual')}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  workoutAddMode === 'manual' ? 'bg-[#1b5a3d] text-white' : 'text-[#476053]'
                }`}
              >
                Вручную
              </button>
              <button
                type="button"
                onClick={() => setWorkoutAddMode('chat')}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  workoutAddMode === 'chat' ? 'bg-[#1b5a3d] text-white' : 'text-[#476053]'
                }`}
              >
                GPT
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-[20px] border border-[#dde7df] bg-[#f7fbf8] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#728579]">Сессии за день</p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#102018]">{workoutsTodayCount}</p>
          </div>
          <div className="rounded-[20px] border border-[#dde7df] bg-[#f7fbf8] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#728579]">Шаги занесены</p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#102018]">{formatNumber(stepsToday)}</p>
          </div>
          <div className="rounded-[20px] border border-[#dde7df] bg-[#f7fbf8] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#728579]">Расход занесен</p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#102018]">{formatNumber(workoutBurnToday)} ккал</p>
          </div>
        </div>

        <p className="mt-4 text-sm leading-6 text-[#617165]">
          Лучше логировать активность по факту дня: силовую или кардио как одну сессию, а шаги отдельной записью, когда есть итоговая цифра.
        </p>

        {workoutAddMode === 'manual' ? (
          <form onSubmit={handleManualWorkoutAdd} className="mt-4 grid gap-3 xl:grid-cols-[1fr_0.85fr_0.75fr_auto]">
            <input
              value={workoutForm.title}
              onChange={(event) => setWorkoutForm((currentForm) => ({ ...currentForm, title: event.target.value }))}
              placeholder="Название тренировки"
              className="h-11 rounded-2xl border border-[#d5e2d9] bg-[#fbfdfb] px-4 text-sm text-[#102018] outline-none transition focus:border-[#4d9469]"
            />
            <input
              value={workoutForm.details}
              onChange={(event) => setWorkoutForm((currentForm) => ({ ...currentForm, details: event.target.value }))}
              placeholder={workoutTypeMeta[workoutForm.type].note}
              className="h-11 rounded-2xl border border-[#d5e2d9] bg-[#fbfdfb] px-4 text-sm text-[#102018] outline-none transition focus:border-[#4d9469]"
            />
            <div className="flex h-11 items-center rounded-2xl border border-[#d5e2d9] bg-[#fbfdfb] px-4 text-sm text-[#5d6e62]">
              <span className="mr-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#728579]">
                {workoutManualMeta.inputLabel}
              </span>
              <input
                value={workoutForm.value}
                onChange={(event) => setWorkoutForm((currentForm) => ({ ...currentForm, value: event.target.value }))}
                type="number"
                placeholder={workoutManualMeta.inputPlaceholder}
                className="w-full bg-transparent text-[#102018] outline-none"
              />
            </div>
            <button
              type="submit"
              className="h-11 rounded-2xl bg-[#102018] px-5 text-sm font-semibold text-white transition hover:bg-[#1d3126]"
            >
              Добавить
            </button>
          </form>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-[#66776b]">
              {workoutChatPending
                ? 'Разбираю активность и считаю расход…'
                : workoutChatDraft
                  ? workoutChatDraft.summary
                  : latestWorkoutAssistantMessage}
            </p>

            <form onSubmit={handleGenerateWorkoutDraft} className="grid gap-3 xl:grid-cols-[1fr_auto]">
              <textarea
                value={workoutChatPrompt}
                onChange={(event) => setWorkoutChatPrompt(event.target.value)}
                rows={3}
                disabled={workoutChatPending}
                placeholder={workoutChatMeta.chatPlaceholder}
                className="w-full rounded-[20px] border border-[#d5e2d9] bg-white px-4 py-3 text-sm text-[#102018] outline-none transition focus:border-[#4d9469]"
              />
              <button
                type="submit"
                disabled={workoutChatPending}
                className="h-11 rounded-2xl bg-[#1b5a3d] px-5 text-sm font-semibold text-white transition hover:bg-[#256b49] xl:h-auto"
              >
                {workoutChatPending ? 'Считаю…' : 'Подготовить'}
              </button>
            </form>

            {workoutChatDraft ? (
              <div className="rounded-[20px] border border-[#d7e5db] bg-[#fbfdfb] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#102018]">Черновик тренировки</p>
                    <p className="mt-1 text-xs text-[#66776b]">{workoutChatDraft.entry.title}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-[11px] font-semibold sm:text-xs ${workoutTypeMeta[workoutChatDraft.entry.type].chipClass}`}>
                    {workoutTypeMeta[workoutChatDraft.entry.type].label}
                  </span>
                </div>

                <div className={`mt-3 rounded-[18px] border p-4 ${workoutTypeMeta[workoutChatDraft.entry.type].panelClass}`}>
                  <p className="text-sm font-semibold text-[#102018]">{formatWorkoutValue(workoutChatDraft.entry)}</p>
                  <p className="mt-1 text-xs text-[#5f7066]">{formatWorkoutCalories(workoutChatDraft.entry)}</p>
                  {workoutChatDraft.entry.details ? (
                    <p className="mt-2 text-sm leading-6 text-[#5e7064]">{workoutChatDraft.entry.details}</p>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleAcceptWorkoutDraft}
                    className="h-10 rounded-2xl bg-[#1b5a3d] px-4 text-sm font-semibold text-white transition hover:bg-[#256b49]"
                  >
                    Принять
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkoutChatDraft(null)}
                    className="h-10 rounded-2xl border border-[#d5e2d9] bg-white px-4 text-sm font-medium text-[#385244] transition hover:bg-[#f5faf7]"
                  >
                    Очистить
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Surface>

      <Surface>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6d836f]">
              Лог
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-[#102018] sm:text-[2rem]">
              Активность за день
            </h2>
          </div>

          <div className="rounded-full bg-[#eef5ef] px-3 py-2 text-xs font-semibold text-[#446050]">
            {workoutsTodayCount} записей
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {workouts.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-[#d6e1da] bg-white/70 p-4 text-sm text-[#708276] md:col-span-2 xl:col-span-3">
              Пока пусто. Добавь тренировку, прогулку или шаги вручную либо через GPT.
            </div>
          ) : null}
          {workouts.map((entry) => (
            <article key={entry.id} className={`rounded-[22px] border p-4 ${workoutTypeMeta[entry.type].panelClass}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${workoutTypeMeta[entry.type].chipClass}`}>
                      {workoutTypeMeta[entry.type].label}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${getSourceClass(entry.source)}`}>
                      {getSourceLabel(entry.source)}
                    </span>
                  </div>
                  <p className="mt-3 text-lg font-semibold tracking-[-0.03em] text-[#102018]">{entry.title}</p>
                  {entry.details ? (
                    <p className="mt-2 text-sm leading-6 text-[#5e7064]">{entry.details}</p>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="rounded-[18px] bg-white/80 px-3 py-2 text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#728579]">Итог</p>
                    <p className="mt-1 text-base font-semibold text-[#102018]">{formatWorkoutValue(entry)}</p>
                    <p className="mt-1 text-xs text-[#5f7066]">{formatWorkoutCalories(entry)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRequestWorkoutDeletion(entry.id, entry.title)}
                    className="inline-flex h-8 items-center justify-center rounded-full border border-[#e5d8d8] bg-[#fff6f5] px-3 text-[11px] font-semibold text-[#b44a46] transition hover:bg-[#fdeceb]"
                  >
                    Удалить
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </Surface>
    </div>
  )

  const renderStats = () => {
    const weightValues = visibleWeightHistory.map((entry) => entry.value)
    const minWeight = Math.min(...weightValues)
    const maxWeight = Math.max(...weightValues)
    const weightRange = maxWeight - minWeight || 1

    return (
      <div className="space-y-6">
        <Surface>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">
                Аналитика за период
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[#102018] sm:text-4xl">
                Статистика
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#617165] sm:text-base">
                Только реальные записи из дневника: вес, калории и активность за выбранный период.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                { value: '7d' as const, label: '7 дней' },
                { value: '30d' as const, label: '30 дней' },
                { value: '90d' as const, label: '90 дней' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStatsRange(option.value)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    statsRange === option.value
                      ? 'bg-[#19563a] text-white'
                      : 'bg-[#eef4ef] text-[#47604f] hover:bg-[#e4eee7]'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </Surface>

        <div className="grid gap-4 lg:grid-cols-4">
          <MetricCard
            label={weightChangeLabel}
            value={`${formatSignedWeight(goalAwareWeightChange)} кг`}
            note={`${formatWeight(startingWeight)} -> ${formatWeight(profile.currentWeight)} кг с первого замера`}
          />
          <MetricCard
            label="До цели"
            value={`${formatWeight(remainingToTarget)} кг`}
            note={
              remainingToTarget <= 0.1
                ? `Цель ${formatWeight(profile.targetWeight)} кг уже достигнута`
                : `${goalProgress}% пути закрыто · цель ${formatWeight(profile.targetWeight)} кг`
            }
          />
          <MetricCard
            label="Средние калории"
            value={nutritionHistory.length > 0 ? `${formatNumber(averageCalories)} ккал` : 'Нет данных'}
            note={
              nutritionHistory.length > 0
                ? `${formatSignedCalories(averageGoalDelta)} ккал к среднему лимиту · ${adherenceDays}/${nutritionHistory.length} дней в коридоре`
                : 'Появится после первых записей еды'
            }
          />
          <MetricCard
            label="Активность"
            value={`~${formatNumber(totalWorkoutCalories)} ккал`}
            note={
              totalWorkouts > 0 || activeDays > 0
                ? `${totalWorkouts} записей · ${activeDays}/${rangeDays} активных дней${averageSteps > 0 ? ` · ${formatNumber(averageSteps)} шагов в среднем` : ''}`
                : 'Появится после первых тренировок или шагов'
            }
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Surface>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">
                  Вес
                </p>
                <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[#102018]">
                  {formatWeight(profile.currentWeight)} кг сейчас
                </h2>
              </div>
              <p className="text-sm text-[#617165]">
                {visibleWeightHistory.length} точек · {formatSignedWeight(weightChange)} кг за период
              </p>
            </div>

            <div className="mt-6 rounded-[24px] border border-[#dde7df] bg-[#f7fbf8] p-4">
              <svg viewBox="0 0 320 150" className="h-52 w-full" role="img" aria-label="График веса">
                <line x1="0" y1="24" x2="320" y2="24" stroke="#dbe7df" strokeDasharray="4 6" />
                <line x1="0" y1="75" x2="320" y2="75" stroke="#e3ece5" strokeDasharray="4 6" />
                <line x1="0" y1="126" x2="320" y2="126" stroke="#dbe7df" strokeDasharray="4 6" />
                <polyline
                  fill="none"
                  stroke="#28714d"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="4"
                  points={weightPoints}
                />
                {visibleWeightHistory.map((record, index) => {
                  const x = visibleWeightHistory.length === 1 ? 160 : (index / (visibleWeightHistory.length - 1)) * 320
                  const y = 150 - ((record.value - minWeight) / weightRange) * (150 - 24) - 12

                  return (
                    <circle
                      key={record.date}
                      cx={x}
                      cy={y}
                      r={index === visibleWeightHistory.length - 1 ? 5.5 : 4}
                      fill={index === visibleWeightHistory.length - 1 ? '#19563a' : '#ffffff'}
                      stroke="#2f7a51"
                      strokeWidth="3"
                    />
                  )
                })}
              </svg>

              <div className="mt-3 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-[#74867a]">
                <span>{formatShortDate(visibleWeightHistory[0].date)}</span>
                <span>{formatShortDate(visibleWeightHistory[Math.floor(visibleWeightHistory.length / 2)].date)}</span>
                <span>{formatShortDate(visibleWeightHistory[visibleWeightHistory.length - 1].date)}</span>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[20px] border border-[#dce6de] bg-[#fafcfb] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#67796d]">Старт периода</p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#102018]">{formatWeight(periodStartWeight)} кг</p>
              </div>
              <div className="rounded-[20px] border border-[#dce6de] bg-[#fafcfb] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#67796d]">Сейчас</p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#102018]">{formatWeight(profile.currentWeight)} кг</p>
              </div>
              <div className="rounded-[20px] border border-[#dce6de] bg-[#fafcfb] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#67796d]">Цель</p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#102018]">{formatWeight(profile.targetWeight)} кг</p>
              </div>
            </div>
          </Surface>

          <Surface>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">
                  Калории по дням
                </p>
                <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[#102018]">
                  {nutritionHistory.length > 0 ? `${adherenceDays}/${nutritionHistory.length} дней в коридоре` : 'Пока нет логов еды'}
                </h2>
              </div>
              <p className="text-sm text-[#617165]">
                {nutritionHistory.length > 0
                  ? `${formatSignedCalories(averageGoalDelta)} ккал к среднему лимиту`
                  : 'После первых записей появится динамика по дням'}
              </p>
            </div>

            {nutritionHistory.length > 0 ? (
              <div className="mt-6 flex h-64 items-end gap-2 rounded-[24px] border border-[#dde7df] bg-[#f7fbf8] px-4 pb-4 pt-6">
                {nutritionHistory.map((record) => {
                  const adjustedGoal =
                    targets.active.calories + roundMacro(record.workoutCalories * caloriePlan.workoutCreditRatio)
                  const delta = record.calories - adjustedGoal
                  const height = Math.max(18, Math.round((record.calories / maxCaloriesChartValue) * 180))
                  const barClass =
                    Math.abs(delta) <= 150
                      ? 'bg-[#59a77c]'
                      : delta < 0
                        ? 'bg-[#8fb8cb]'
                        : 'bg-[#e5a563]'

                  return (
                    <div key={record.date} className="flex flex-1 flex-col items-center justify-end gap-2">
                      <div className="w-full rounded-t-[14px]" style={{ height: `${height}px` }}>
                        <div className={`h-full w-full rounded-t-[14px] ${barClass}`} />
                      </div>
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a8a7f] [writing-mode:vertical-rl] [transform:rotate(180deg)] sm:[writing-mode:horizontal-tb] sm:[transform:none]">
                        {formatShortDate(record.date)}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="mt-6 flex h-64 items-center justify-center rounded-[24px] border border-dashed border-[#d7e1da] bg-[#f7fbf8] px-6 text-center text-sm leading-6 text-[#617165]">
                Здесь появится динамика калорий, когда в дневнике будет хотя бы один день с едой.
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#66786e]">
              <span className="rounded-full bg-[#e8f3ec] px-3 py-2 text-[#2a6f4d]">в коридоре</span>
              <span className="rounded-full bg-[#eaf1f5] px-3 py-2 text-[#547788]">ниже лимита</span>
              <span className="rounded-full bg-[#fbefe4] px-3 py-2 text-[#b7722e]">выше лимита</span>
            </div>

            <p className="mt-4 text-sm text-[#617165]">
              Лимит по дню считается с учетом тренировочного бонуса, как и на экране Today.
            </p>
          </Surface>
        </div>
      </div>
    )
  }

  const renderProfile = () => (
    <div className="space-y-6">
      <Surface>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">
              Профиль и цели
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[#102018] sm:text-4xl">
              Настройки
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#617165] sm:text-base">
              База для расчета цели и дневных КБЖУ.
            </p>
          </div>

          <div className="rounded-[24px] bg-[#eef5ef] px-4 py-3 text-sm text-[#4f6255]">
            изменения сохраняются сразу
          </div>
        </div>
      </Surface>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Surface>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">База</p>
              <div className="mt-4 grid gap-3">
                <FieldGroup label="Пол">
                  <select
                    value={profile.gender}
                    onChange={(event) => updateProfile('gender', event.target.value as Gender)}
                    className={formFieldClassName}
                  >
                    <option value="male">Мужчина</option>
                    <option value="female">Женщина</option>
                  </select>
                </FieldGroup>

                <FieldGroup label="Возраст">
                  <input
                    value={profile.age}
                    onChange={(event) => updateProfile('age', Number(event.target.value))}
                    type="number"
                    placeholder="Возраст"
                    className={formFieldClassName}
                  />
                </FieldGroup>

                <FieldGroup label="Рост, см">
                  <input
                    value={profile.height}
                    onChange={(event) => updateProfile('height', Number(event.target.value))}
                    type="number"
                    placeholder="Рост"
                    className={formFieldClassName}
                  />
                </FieldGroup>

                <FieldGroup label="Текущий вес, кг" hint="Вес обновляется на главном экране и фиксируется один раз в день.">
                  <input
                    value={profile.currentWeight}
                    type="number"
                    readOnly
                    step="0.1"
                    placeholder="Текущий вес"
                    className={readOnlyFieldClassName}
                  />
                </FieldGroup>

                <FieldGroup label="Целевой вес, кг">
                  <input
                    value={profile.targetWeight}
                    onChange={(event) => updateProfile('targetWeight', Number(event.target.value))}
                    type="number"
                    step="0.1"
                    placeholder="Целевой вес"
                    className={formFieldClassName}
                  />
                </FieldGroup>
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">Цель и активность</p>
              <div className="mt-4 grid gap-3">
                <FieldGroup label="Цель">
                  <select
                    value={profile.goalType}
                    onChange={(event) => updateProfile('goalType', event.target.value as GoalType)}
                    className={formFieldClassName}
                  >
                    <option value="cut">Снижение веса</option>
                    <option value="maintain">Поддержание</option>
                    <option value="bulk">Набор</option>
                  </select>
                </FieldGroup>
                <FieldGroup label="Темп, кг в неделю">
                  <input
                    value={profile.weeklyRate}
                    onChange={(event) => updateProfile('weeklyRate', Number(event.target.value))}
                    type="number"
                    step="0.1"
                    placeholder="Темп кг/неделя"
                    className={formFieldClassName}
                  />
                </FieldGroup>
                <FieldGroup label="Активность">
                  <select
                    value={profile.activity}
                    onChange={(event) => updateProfile('activity', event.target.value as ActivityLevel)}
                    className={formFieldClassName}
                  >
                    {activityOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FieldGroup>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-[24px] border border-[#dde7df] bg-[#f7fbf8] p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">
                  Цели КБЖУ
                </p>
                <p className="mt-2 text-sm leading-6 text-[#617165]">
                  Можно оставить автоматический расчет или задать свои цифры вручную.
                </p>
              </div>

              <div className="flex gap-2 rounded-full bg-[#eaf1eb] p-1">
                <button
                  type="button"
                  onClick={() => updateProfile('goalMode', 'auto')}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    profile.goalMode === 'auto' ? 'bg-[#19563a] text-white' : 'text-[#4f6255]'
                  }`}
                >
                  Авто
                </button>
                <button
                  type="button"
                  onClick={() => updateProfile('goalMode', 'manual')}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    profile.goalMode === 'manual' ? 'bg-[#19563a] text-white' : 'text-[#4f6255]'
                  }`}
                >
                  Вручную
                </button>
              </div>
            </div>

            {profile.goalMode === 'manual' ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <FieldGroup label="Калории">
                  <input
                    value={profile.manualCalories}
                    onChange={(event) => updateProfile('manualCalories', Number(event.target.value))}
                    type="number"
                    placeholder="Калории"
                    className={formFieldWhiteClassName}
                  />
                </FieldGroup>
                <FieldGroup label="Белки, г">
                  <input
                    value={profile.manualProtein}
                    onChange={(event) => updateProfile('manualProtein', Number(event.target.value))}
                    type="number"
                    placeholder="Белки"
                    className={formFieldWhiteClassName}
                  />
                </FieldGroup>
                <FieldGroup label="Жиры, г">
                  <input
                    value={profile.manualFat}
                    onChange={(event) => updateProfile('manualFat', Number(event.target.value))}
                    type="number"
                    placeholder="Жиры"
                    className={formFieldWhiteClassName}
                  />
                </FieldGroup>
                <FieldGroup label="Углеводы, г">
                  <input
                    value={profile.manualCarbs}
                    onChange={(event) => updateProfile('manualCarbs', Number(event.target.value))}
                    type="number"
                    placeholder="Углеводы"
                    className={formFieldWhiteClassName}
                  />
                </FieldGroup>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <MetricCard label="Ккал" value={`${targets.recommended.calories}`} note="рекомендация" />
                <MetricCard label="Белки" value={`${targets.recommended.protein} г`} note="в день" />
                <MetricCard label="Жиры" value={`${targets.recommended.fat} г`} note="в день" />
                <MetricCard label="Углеводы" value={`${targets.recommended.carbs} г`} note="в день" />
              </div>
            )}
          </div>
        </Surface>

        <div className="space-y-6">
          <Surface className="bg-[linear-gradient(180deg,#f7fbf8_0%,#f1f7f3_100%)]">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">
              Расчет сейчас
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[#102018]">
              {formatNumber(targets.active.calories)} ккал в день
            </h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <MetricCard label="BMR" value={`${targets.bmr}`} note="базовый обмен" />
              <MetricCard label="TDEE" value={`${targets.tdee}`} note="поддержание с активностью" />
              <MetricCard
                label="Коррекция"
                value={`${targets.adjustment > 0 ? '+' : ''}${targets.adjustment}`}
                note="добавка или дефицит под цель"
              />
              <MetricCard
                label="Активная цель"
                value={profile.goalMode === 'auto' ? 'авто' : 'ручная'}
                note="какой режим сейчас используется"
              />
            </div>
          </Surface>

          <Surface>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">
              Какие данные нужны
            </p>
            <div className="mt-4 space-y-3 text-sm leading-6 text-[#617165]">
              {[
                'Обязательно: пол, возраст, рост, текущий вес, цель, активность.',
                'Очень желательно: целевой вес и темп изменения веса.',
                'Шаги и тренировки удобнее заносить на день в разделе Сегодня, когда есть факт, а не средняя оценка.',
                'Для точности после старта: ежедневный вес и честный лог калорий хотя бы 2-3 недели.',
                'Дополнительно: окружность талии, процент жира и ограничения в питании — это уже опционально.',
              ].map((item) => (
                <div key={item} className="rounded-[22px] border border-[#dde7df] bg-[#f7fbf8] p-4">
                  {item}
                </div>
              ))}
            </div>
          </Surface>

          <Surface>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">
              Почему вес важнее формулы
            </p>
            <p className="mt-4 text-sm leading-7 text-[#617165]">
              Формула нужна только для старта. Затем точность дает связка из ежедневного веса, реальных калорий и активности. Если в течение пары недель вес не идет туда, куда должен, приложение может предложить новую цель точнее любого универсального калькулятора.
            </p>
          </Surface>
        </div>
      </div>
    </div>
  )

  return (
    <div className="px-3 py-3 sm:px-4 sm:py-4 lg:px-6 xl:px-8">
      <div className="mx-auto max-w-[1920px]">
        <header className="sticky top-0 z-20 rounded-[24px] border border-[#dce6de] bg-white/92 p-3 shadow-[0_18px_40px_-28px_rgba(24,92,63,0.18)] backdrop-blur sm:p-4 relative">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6d836f]">FORMA</p>
              <p className="mt-1 text-sm font-medium text-[#33493c]">{headerTabLabel} · {formatShortDate(currentDate)}</p>
            </div>

            <div className="flex items-center gap-2">
              <div className="rounded-[16px] bg-[#eef4ef] px-3 py-2 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#708276]">Цель</p>
                <p className="mt-1 text-sm font-semibold text-[#173625]">{formatNumber(targets.active.calories)} ккал</p>
              </div>

              <button
                type="button"
                onClick={() => setIsMenuOpen((value) => !value)}
                className="flex h-11 w-11 items-center justify-center rounded-[16px] border border-[#d8e3db] bg-white text-[#264735] transition hover:bg-[#f5f8f6]"
                aria-label="Открыть меню"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 7h16" />
                  <path d="M4 12h16" />
                  <path d="M4 17h16" />
                </svg>
              </button>
            </div>
          </div>

          {cloudError ? (
            <div className="mt-3 rounded-[18px] border border-[#f1d1cf] bg-[#fff5f4] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#b44a46]">Firebase</p>
              <p className="mt-1 text-sm leading-6 text-[#9d4541]">{cloudError}</p>
            </div>
          ) : null}

          {isMenuOpen ? (
            <div className="absolute right-0 top-[calc(100%+10px)] z-30 w-[min(18rem,calc(100vw-1.5rem))] rounded-[22px] border border-[#dce6de] bg-white p-3 shadow-[0_28px_70px_-38px_rgba(24,92,63,0.22)]">
              {onboardingRequired ? (
                <div className="rounded-[18px] bg-[#f6f8f7] p-4 text-sm leading-6 text-[#5f7066]">
                  Сначала заполни анкету. После этого откроются дневник, статистика и профиль.
                </div>
              ) : (
                <div className="space-y-2">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(tab.id)
                        setIsMenuOpen(false)
                      }}
                      className={`w-full rounded-[18px] px-4 py-3 text-left transition ${
                        activeTab === tab.id
                          ? 'bg-[#19563a] text-white shadow-[0_18px_40px_-24px_rgba(24,92,63,0.65)]'
                          : 'bg-[#f3f7f4] text-[#496053] hover:bg-[#e7efea]'
                      }`}
                    >
                      <p className="text-sm font-semibold">{tab.label}</p>
                      <p className={`mt-1 text-[11px] ${activeTab === tab.id ? 'text-white/72' : 'text-[#66786c]'}`}>{tab.note}</p>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-3 border-t border-[#e5ece7] pt-3">
                <div className="rounded-[18px] bg-[#f6f8f7] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7a8b80]">Cloud</p>
                      <p className="mt-1 text-sm font-semibold text-[#13211a]">
                        {isFirebaseConfigured ? (user ? userName : 'Нужен вход') : 'Firebase не настроен'}
                      </p>
                      <p className="mt-1 text-[11px] text-[#6d7c72]">
                        {isFirebaseConfigured
                          ? user?.email ?? 'Войди через Google, чтобы читать и писать данные в Firestore.'
                          : 'Заполни .env.local и следуй FIREBASE_DEPLOY.md'}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${currentSyncMeta.className}`}>
                      {currentSyncMeta.label}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {isFirebaseConfigured ? (
                      user ? (
                        <button
                          type="button"
                          onClick={handleLogout}
                          className="h-10 rounded-2xl border border-[#d8e3db] bg-white px-4 text-sm font-semibold text-[#2f4c3d] transition hover:bg-[#eef4ef]"
                        >
                          Выйти
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleGoogleLogin}
                          className="h-10 rounded-2xl bg-[#1b5a3d] px-4 text-sm font-semibold text-white transition hover:bg-[#256b49]"
                        >
                          Войти через Google
                        </button>
                      )
                    ) : (
                      <span className="inline-flex items-center rounded-2xl bg-[#fff2df] px-3 py-2 text-xs font-semibold text-[#9d6a22]">
                        Нужны env и Firebase project
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </header>

        <main className="mt-4 sm:mt-5">
          {!isFirebaseConfigured ? renderSetupBanner() : null}
          {isFirebaseConfigured && !authReady ? renderAuthLoading() : null}
          {isFirebaseConfigured && authReady && !user ? renderAuthGate() : null}

          {!isFirebaseConfigured || (isFirebaseConfigured && authReady && user) ? (
            onboardingRequired ? (
              renderOnboarding()
            ) : (
              <>
                {activeTab === 'today' ? renderToday() : null}
                {activeTab === 'stats' ? renderStats() : null}
                {activeTab === 'profile' ? renderProfile() : null}
              </>
            )
          ) : null}
        </main>

        {renderWeightConfirmationModal()}
        {renderMealDeletionConfirmationModal()}
        {renderWorkoutDeletionConfirmationModal()}
      </div>
    </div>
  )
}

export default App
