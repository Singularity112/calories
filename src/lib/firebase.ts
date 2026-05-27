import { getApp, getApps, initializeApp } from 'firebase/app'
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getRedirectResult,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth'
import { doc, getDoc, getFirestore, setDoc } from 'firebase/firestore'
import { getActiveLocale, type Locale } from './i18n'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const isFirebaseConfigured = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.projectId,
  firebaseConfig.appId,
].every((value) => typeof value === 'string' && value.length > 0)

const app = isFirebaseConfigured
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null

const googleProvider = new GoogleAuthProvider()

googleProvider.setCustomParameters({ prompt: 'select_account' })

export const auth = app ? getAuth(app) : null
export const db = app ? getFirestore(app) : null
const openAiApiKey = import.meta.env.VITE_OPENAI_API_KEY
const openAiModel = import.meta.env.VITE_OPENAI_MODEL?.trim() || 'gpt-4.1'

if (auth) {
  void setPersistence(auth, browserLocalPersistence)
}

export type RemoteUserState = {
  profile?: unknown
  meals?: unknown
  mealHistory?: unknown
  workoutHistory?: unknown
  weightHistory?: unknown
  updatedAt?: string
}

export type ParsedFoodResponse = {
  title: string
  summary: string
  commentary: string
  totals: {
    calories: number
    protein: number
    fat: number
    carbs: number
  }
  items: Array<{
    name: string
    grams: number
    calories: number
    protein: number
    fat: number
    carbs: number
  }>
}

export type ParsedWorkoutType = 'strength' | 'cardio' | 'walking' | 'mobility'

export type ParsedWorkoutResponse = {
  summary: string
  entry: {
    type: ParsedWorkoutType
    title: string
    details: string
    value: number
    metric: 'calories' | 'steps'
    estimatedCalories: number
  }
}

const aiLocaleCopy: Record<
  Locale,
  {
    responseLanguage: string
    foodDefaultTitle: string
    foodDefaultSummary: string
    foodDefaultCommentary: string
    workoutDefaultSummary: string
    walkingTitle: string
    workoutTitle: string
  }
> = {
  en: {
    responseLanguage: 'English',
    foodDefaultTitle: 'Meal',
    foodDefaultSummary: 'Prepared a food draft.',
    foodDefaultCommentary: 'Counted the items as written and used standard reference values for the estimate.',
    workoutDefaultSummary: 'Prepared an activity draft.',
    walkingTitle: 'Steps',
    workoutTitle: 'Workout',
  },
  ru: {
    responseLanguage: 'Russian',
    foodDefaultTitle: 'Блюдо',
    foodDefaultSummary: 'Подготовил черновик еды.',
    foodDefaultCommentary: 'Посчитал позиции как они написаны и использовал стандартные справочные значения.',
    workoutDefaultSummary: 'Подготовил черновик активности.',
    walkingTitle: 'Шаги',
    workoutTitle: 'Тренировка',
  },
  uk: {
    responseLanguage: 'Ukrainian',
    foodDefaultTitle: 'Страва',
    foodDefaultSummary: 'Підготував чернетку їжі.',
    foodDefaultCommentary: 'Порахував позиції так, як вони вказані, і використав стандартні довідкові значення.',
    workoutDefaultSummary: 'Підготував чернетку активності.',
    walkingTitle: 'Кроки',
    workoutTitle: 'Тренування',
  },
  pl: {
    responseLanguage: 'Polish',
    foodDefaultTitle: 'Posilek',
    foodDefaultSummary: 'Przygotowalem szkic posilku.',
    foodDefaultCommentary: 'Policzylem pozycje tak, jak zostaly opisane, i uzylem standardowych wartosci referencyjnych.',
    workoutDefaultSummary: 'Przygotowalem szkic aktywnosci.',
    walkingTitle: 'Kroki',
    workoutTitle: 'Trening',
  },
}

function getAiLocaleCopy() {
  return aiLocaleCopy[getActiveLocale()] ?? aiLocaleCopy.en
}

const foodSchema = {
  name: 'food_parser',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'summary', 'commentary', 'totals', 'items'],
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
      commentary: { type: 'string' },
      totals: {
        type: 'object',
        additionalProperties: false,
        required: ['calories', 'protein', 'fat', 'carbs'],
        properties: {
          calories: { type: 'number' },
          protein: { type: 'number' },
          fat: { type: 'number' },
          carbs: { type: 'number' },
        },
      },
      items: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'grams', 'calories', 'protein', 'fat', 'carbs'],
          properties: {
            name: { type: 'string' },
            grams: { type: 'number' },
            calories: { type: 'number' },
            protein: { type: 'number' },
            fat: { type: 'number' },
            carbs: { type: 'number' },
          },
        },
      },
    },
  },
} as const

const workoutSchema = {
  name: 'workout_parser',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'entry'],
    properties: {
      summary: { type: 'string' },
      entry: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'title', 'details', 'value', 'metric', 'estimatedCalories'],
        properties: {
          type: { type: 'string', enum: ['strength', 'cardio', 'walking', 'mobility'] },
          title: { type: 'string' },
          details: { type: 'string' },
          value: { type: 'number' },
          metric: { type: 'string', enum: ['calories', 'steps'] },
          estimatedCalories: { type: 'number' },
        },
      },
    },
  },
} as const

function ensureOpenAiConfigured() {
  if (typeof openAiApiKey !== 'string' || !openAiApiKey.trim()) {
    throw new Error('OpenAI API key is missing. Add VITE_OPENAI_API_KEY to .env.local.')
  }

  return openAiApiKey.trim()
}

function stripJsonFence(value: string) {
  return value.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
}

function clampNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback
}

function estimateCaloriesFromSteps(steps: number, weightKg: number) {
  return Math.max(0, Math.round(steps * weightKg * 0.00045))
}

async function callOpenAiJson<T>(system: string, prompt: string, schema: object) {
  const apiKey = ensureOpenAiConfigured()

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: openAiModel,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: schema,
      },
    }),
  })

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    error?: { message?: string }
  }

  if (!response.ok) {
    throw new Error(payload.error?.message || 'OpenAI request failed.')
  }

  const content = payload.choices?.[0]?.message?.content

  if (!content) {
    throw new Error('OpenAI returned an empty response.')
  }

  return JSON.parse(stripJsonFence(content)) as T
}

function getUserDoc(userId: string) {
  if (!db) {
    throw new Error('Firestore is not configured')
  }

  return doc(db, 'users', userId)
}

function getUserStateDoc(userId: string) {
  if (!db) {
    throw new Error('Firestore is not configured')
  }

  return doc(db, 'users', userId, 'private', 'state')
}

export function observeAuthState(callback: (user: User | null) => void) {
  if (!auth) {
    callback(null)
    return () => undefined
  }

  return onAuthStateChanged(auth, callback)
}

export async function resolvePendingRedirectSignIn() {
  if (!auth) {
    return null
  }

  return getRedirectResult(auth)
}

export async function signInWithGoogle() {
  if (!auth) {
    throw new Error('Firebase is not configured')
  }

  try {
    await signInWithPopup(auth, googleProvider)
  } catch (error) {
    const errorCode = (error as { code?: string }).code

    if (
      errorCode === 'auth/popup-blocked' ||
      errorCode === 'auth/cancelled-popup-request' ||
      errorCode === 'auth/operation-not-supported-in-this-environment'
    ) {
      await signInWithRedirect(auth, googleProvider)
      return
    }

    throw error
  }
}

export async function signOutCurrentUser() {
  if (!auth) {
    return
  }

  await signOut(auth)
}

export async function loadUserState(userId: string) {
  if (!db) {
    return null
  }

  const stateSnapshot = await getDoc(getUserStateDoc(userId))

  if (!stateSnapshot.exists()) {
    return null
  }

  return stateSnapshot.data() as RemoteUserState
}

export async function saveUserState(
  user: Pick<User, 'uid' | 'email' | 'displayName' | 'photoURL'>,
  data: {
    profile: unknown
    mealHistory: unknown
    workoutHistory: unknown
    weightHistory: unknown
  },
) {
  if (!db) {
    return
  }

  const updatedAt = new Date().toISOString()

  await Promise.all([
    setDoc(
      getUserDoc(user.uid),
      {
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        photoURL: user.photoURL ?? null,
        updatedAt,
      },
      { merge: true },
    ),
    setDoc(
      getUserStateDoc(user.uid),
      {
        ...data,
        updatedAt,
      },
      { merge: true },
    ),
  ])
}

export async function parseFoodPrompt(prompt: string) {
  const localeCopy = getAiLocaleCopy()
  const system = [
    'You calculate calories and macros for a calorie tracker.',
    'Split the user message into separate food items and return totals for the full meal.',
    'Also create a short title for the whole meal or food set so it can be shown as a single meal entry.',
    'Add commentary with 1-3 short sentences explaining the key assumptions behind the calculation, for example dry vs cooked weight, estimated grams, or what reference values you used.',
    'Put the overall calories, protein, fat, and carbs into totals.',
    'If the user did not provide weights, estimate them realistically from context.',
    'If a dry grain or cereal is given as a dry weight, treat it as dry weight.',
    'If the portion is obviously very large or calorie or carb heavy, you may add playful sarcastic remark',
    'Return JSON only and follow the provided schema exactly.',
    `Response language: ${localeCopy.responseLanguage}.`,
  ].join(' ')

  const result = await callOpenAiJson<ParsedFoodResponse>(system, prompt, foodSchema)

  return {
    title: typeof result.title === 'string' && result.title.trim() ? result.title.trim() : localeCopy.foodDefaultTitle,
    summary:
      typeof result.summary === 'string' && result.summary.trim() ? result.summary.trim() : localeCopy.foodDefaultSummary,
    commentary:
      typeof result.commentary === 'string' && result.commentary.trim()
        ? result.commentary.trim()
        : localeCopy.foodDefaultCommentary,
    totals: {
      calories: clampNumber(result.totals?.calories),
      protein: clampNumber(result.totals?.protein),
      fat: clampNumber(result.totals?.fat),
      carbs: clampNumber(result.totals?.carbs),
    },
    items: result.items.map((item) => ({
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : localeCopy.foodDefaultTitle,
      grams: clampNumber(item.grams, 100),
      calories: clampNumber(item.calories),
      protein: clampNumber(item.protein),
      fat: clampNumber(item.fat),
      carbs: clampNumber(item.carbs),
    })),
  }
}

export async function parseWorkoutPrompt(
  prompt: string,
  fallbackType: ParsedWorkoutType,
  currentWeight: number,
) {
  const localeCopy = getAiLocaleCopy()
  const system = [
    'You parse activity descriptions for a fitness tracker.',
    'Choose one activity type: strength, cardio, walking, mobility.',
    'If the user describes steps or a walk, metric must be steps and value must be the number of steps.',
    'In all other cases metric must be calories and value must be the estimated calorie burn for the session.',
    'estimatedCalories must always be filled.',
    'title should be a short activity name and details should be a short human-readable description.',
    'Return JSON only and follow the provided schema exactly.',
    `Response language: ${localeCopy.responseLanguage}.`,
  ].join(' ')

  const result = await callOpenAiJson<ParsedWorkoutResponse>(system, prompt, workoutSchema)
  const metric = result.entry.metric === 'steps' ? 'steps' : 'calories'
  const value = clampNumber(result.entry.value, metric === 'steps' ? 6000 : 180)

  return {
    summary:
      typeof result.summary === 'string' && result.summary.trim()
        ? result.summary.trim()
        : localeCopy.workoutDefaultSummary,
    entry: {
      type: ['strength', 'cardio', 'walking', 'mobility'].includes(result.entry.type)
        ? result.entry.type
        : fallbackType,
      title:
        typeof result.entry.title === 'string' && result.entry.title.trim()
          ? result.entry.title.trim()
          : fallbackType === 'walking'
            ? localeCopy.walkingTitle
            : localeCopy.workoutTitle,
      details: typeof result.entry.details === 'string' ? result.entry.details.trim() : '',
      value,
      metric,
      estimatedCalories:
        metric === 'steps'
          ? estimateCaloriesFromSteps(value, currentWeight)
          : clampNumber(result.entry.estimatedCalories, value),
    },
  }
}