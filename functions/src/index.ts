import { initializeApp } from 'firebase-admin/app'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'

initializeApp()

const openAiApiKey = defineSecret('OPENAI_API_KEY')
const openAiModel = 'gpt-4o-mini'
const workoutTypes = new Set(['strength', 'cardio', 'walking', 'mobility'])

const foodSchema = {
  name: 'food_parser',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'items'],
    properties: {
      summary: { type: 'string' },
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

type FoodResult = {
  summary: string
  items: Array<{
    name: string
    grams: number
    calories: number
    protein: number
    fat: number
    carbs: number
  }>
}

type WorkoutResult = {
  summary: string
  entry: {
    type: 'strength' | 'cardio' | 'walking' | 'mobility'
    title: string
    details: string
    value: number
    metric: 'calories' | 'steps'
    estimatedCalories: number
  }
}

function ensureAuthenticated(auth: unknown) {
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Нужна авторизация для использования AI-чата.')
  }
}

function ensurePrompt(prompt: unknown) {
  const nextPrompt = typeof prompt === 'string' ? prompt.trim() : ''

  if (!nextPrompt) {
    throw new HttpsError('invalid-argument', 'Пустой prompt.')
  }

  if (nextPrompt.length > 1200) {
    throw new HttpsError('invalid-argument', 'Слишком длинное описание.')
  }

  return nextPrompt
}

function clampNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback
}

function estimateCaloriesFromSteps(steps: number, weightKg: number) {
  return Math.max(0, Math.round(steps * weightKg * 0.00045))
}

function stripJsonFence(value: string) {
  return value.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
}

async function callOpenAiJson<T>(system: string, prompt: string, schema: object) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiApiKey.value()}`,
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
    throw new HttpsError('internal', payload.error?.message || 'OpenAI request failed.')
  }

  const content = payload.choices?.[0]?.message?.content

  if (!content) {
    throw new HttpsError('internal', 'OpenAI returned an empty response.')
  }

  return JSON.parse(stripJsonFence(content)) as T
}

function sanitizeFoodResult(result: FoodResult) {
  if (!Array.isArray(result.items) || result.items.length === 0) {
    throw new HttpsError('internal', 'AI не вернул продукты.')
  }

  return {
    summary: typeof result.summary === 'string' && result.summary.trim() ? result.summary.trim() : 'Подготовил черновик еды.',
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

function sanitizeWorkoutResult(result: WorkoutResult, fallbackType: string, currentWeight: number) {
  const nextType = workoutTypes.has(result.entry.type) ? result.entry.type : fallbackType
  const metric = result.entry.metric === 'steps' ? 'steps' : 'calories'
  const value = clampNumber(result.entry.value, metric === 'steps' ? 6000 : 180)
  const estimatedCalories =
    metric === 'steps'
      ? estimateCaloriesFromSteps(value, currentWeight)
      : clampNumber(result.entry.estimatedCalories || value, value)

  return {
    summary:
      typeof result.summary === 'string' && result.summary.trim()
        ? result.summary.trim()
        : 'Подготовил черновик активности.',
    entry: {
      type: nextType as WorkoutResult['entry']['type'],
      title:
        typeof result.entry.title === 'string' && result.entry.title.trim()
          ? result.entry.title.trim()
          : nextType === 'walking'
            ? 'Шаги'
            : 'Тренировка',
      details: typeof result.entry.details === 'string' ? result.entry.details.trim() : '',
      value,
      metric,
      estimatedCalories,
    },
  }
}

export const parseFoodPrompt = onCall({ secrets: [openAiApiKey] }, async (request) => {
  ensureAuthenticated(request.auth)
  const prompt = ensurePrompt(request.data?.prompt)

  const system = [
    'Ты считаешь КБЖУ для трекера калорий.',
    'Разбери сообщение пользователя на отдельные продукты и верни суммарные значения для каждого продукта.',
    'Если пользователь не указал граммовку, оцени реалистично по контексту.',
    'Если продукт сухой крупы указан как сухой вес, считай именно сухой вес.',
    'Ответ должен быть только JSON по заданной схеме.',
    'Язык ответа: русский.',
  ].join(' ')

  const result = await callOpenAiJson<FoodResult>(system, prompt, foodSchema)
  return sanitizeFoodResult(result)
})

export const parseWorkoutPrompt = onCall({ secrets: [openAiApiKey] }, async (request) => {
  ensureAuthenticated(request.auth)

  const prompt = ensurePrompt(request.data?.prompt)
  const fallbackType = typeof request.data?.fallbackType === 'string' ? request.data.fallbackType : 'strength'
  const currentWeight = clampNumber(request.data?.currentWeight, 75)

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

  const result = await callOpenAiJson<WorkoutResult>(system, prompt, workoutSchema)
  return sanitizeWorkoutResult(result, fallbackType, currentWeight)
})
