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
const openAiModel = 'gpt-4o-mini'

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

const foodSchema = {
  name: 'food_parser',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'summary', 'totals', 'items'],
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
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
  const system = [
    'Ты считаешь КБЖУ для трекера калорий.',
    'Разбери сообщение пользователя на отдельные продукты и верни суммарные значения для каждого продукта.',
    'Отдельно придумай короткое название всего блюда или набора еды, которое можно показать как один прием пищи.',
    'Посчитай общие КБЖУ по всему блюду в totals.',
    'Если пользователь не указал граммовку, оцени реалистично по контексту.',
    'Если продукт сухой крупы указан как сухой вес, считай именно сухой вес.',
    'Ответ должен быть только JSON по заданной схеме.',
    'Язык ответа: русский.',
  ].join(' ')

  const result = await callOpenAiJson<ParsedFoodResponse>(system, prompt, foodSchema)

  return {
    title: typeof result.title === 'string' && result.title.trim() ? result.title.trim() : 'Блюдо',
    summary: typeof result.summary === 'string' && result.summary.trim() ? result.summary.trim() : 'Подготовил черновик еды.',
    totals: {
      calories: clampNumber(result.totals?.calories),
      protein: clampNumber(result.totals?.protein),
      fat: clampNumber(result.totals?.fat),
      carbs: clampNumber(result.totals?.carbs),
    },
    items: result.items.map((item) => ({
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'Блюдо',
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
  const system = [
    'Ты разбираешь описание активности для фитнес-трекера.',
    'Выбери один тип активности: strength, cardio, walking, mobility.',
    'Если пользователь пишет про шаги или прогулку, metric должен быть steps и value должен быть количеством шагов.',
    'Во всех остальных случаях metric должен быть calories и value должен быть оценкой расхода калорий за сессию.',
    'estimatedCalories должен всегда быть заполнен.',
    'title должен быть коротким названием активности, details — коротким человекочитаемым описанием.',
    'Ответ должен быть только JSON по заданной схеме.',
    'Язык ответа: русский.',
  ].join(' ')

  const result = await callOpenAiJson<ParsedWorkoutResponse>(system, prompt, workoutSchema)
  const metric = result.entry.metric === 'steps' ? 'steps' : 'calories'
  const value = clampNumber(result.entry.value, metric === 'steps' ? 6000 : 180)

  return {
    summary:
      typeof result.summary === 'string' && result.summary.trim()
        ? result.summary.trim()
        : 'Подготовил черновик активности.',
    entry: {
      type: ['strength', 'cardio', 'walking', 'mobility'].includes(result.entry.type)
        ? result.entry.type
        : fallbackType,
      title:
        typeof result.entry.title === 'string' && result.entry.title.trim()
          ? result.entry.title.trim()
          : fallbackType === 'walking'
            ? 'Шаги'
            : 'Тренировка',
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