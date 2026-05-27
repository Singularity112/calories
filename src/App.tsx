import { useEffect, useState, type ReactNode } from 'react'
import type { User } from 'firebase/auth'
import {
  type Locale,
  defaultLocale,
  formatNumber,
  formatShortDate,
  formatWeight,
  getActiveLocale,
  localeOptions,
  localeStorageKey,
  parseLocalizedNumber,
  readStoredLocale,
  setActiveLocale,
} from './lib/i18n'
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
  commentary: string
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
  patterns: string[]
  label: string
  defaultGrams: number
  calories: number
  protein: number
  fat: number
  carbs: number
  dryNutrition?: NutritionTotals
}

const englishCopy = {
  tabs: {
    today: { label: 'Today', note: 'Food, weight, and quick entry' },
    stats: { label: 'Stats', note: 'Week, month, and trends' },
    profile: { label: 'Profile', note: 'Goals and macro targets' },
  },
  macros: {
    calories: 'Calories',
    protein: 'Protein',
    fat: 'Fat',
    carbs: 'Carbs',
  },
  activityOptions: {
    low: { label: 'Sedentary', note: 'office work, low step count' },
    moderate: { label: 'Moderate', note: 'a lot of walking and 2-3 workouts' },
    high: { label: 'Active', note: 'frequent workouts and high NEAT' },
    athlete: { label: 'Very active', note: 'sports almost every day' },
  },
  workoutTypes: {
    strength: {
      label: 'Strength',
      note: 'sets, reps, exercises',
      inputLabel: 'Burned, kcal',
      inputPlaceholder: '220',
      chatPlaceholder: 'I did 4 sets of 20 squats and leg press',
      defaultTitle: 'Workout',
    },
    cardio: {
      label: 'Cardio',
      note: 'run, bike, treadmill, intervals',
      inputLabel: 'Burned, kcal',
      inputPlaceholder: '320',
      chatPlaceholder: 'I ran for 35 minutes at an easy pace',
      defaultTitle: 'Cardio',
    },
    walking: {
      label: 'Steps',
      note: 'walk, hike, long walk',
      inputLabel: 'Steps',
      inputPlaceholder: '8500',
      chatPlaceholder: 'Today I walked 9600 steps',
      defaultTitle: 'Steps',
    },
    mobility: {
      label: 'Recovery',
      note: 'stretching, yoga, mobility',
      inputLabel: 'Burned, kcal',
      inputPlaceholder: '90',
      chatPlaceholder: 'I did 25 minutes of stretching after training',
      defaultTitle: 'Recovery',
    },
  },
  meals: {
    breakfast: {
      title: 'Breakfast',
      time: '08:00-10:00',
      note: 'Start the day with the first protein portion.',
    },
    lunch: {
      title: 'Lunch',
      time: '12:30-14:30',
      note: 'Main meal and energy base.',
    },
    dinner: {
      title: 'Dinner',
      time: '18:30-20:30',
      note: 'A bit lighter on calories, not on protein.',
    },
    snacks: {
      title: 'Snacks',
      time: 'Flexible',
      note: 'Control hunger without breaking the calorie budget.',
    },
  },
  sources: {
    manual: 'manual',
    gpt: 'GPT',
  },
  goals: {
    cut: 'Weight loss',
    maintain: 'Maintenance',
    bulk: 'Gain',
  },
  genders: {
    male: 'Male',
    female: 'Female',
  },
  goalModes: {
    auto: 'Auto',
    manual: 'Manual',
  },
  common: {
    cancel: 'Cancel',
    confirm: 'Confirm',
    delete: 'Delete',
    save: 'Save',
    saved: 'Saved',
    clear: 'Clear',
    accept: 'Accept',
    add: 'Add',
    prepare: 'Prepare',
    preparing: 'Working…',
    manual: 'Manual',
    recommendation: 'recommended',
    perDay: 'per day',
    result: 'Result',
    total: 'Total',
    draft: 'Draft',
    log: 'Log',
  },
  units: {
    kcal: 'kcal',
    grams: 'g',
    kg: 'kg',
    steps: 'steps',
    points: 'points',
  },
  localeMenu: {
    label: 'Language',
  },
  setupBanner: {
    title: 'Firebase is not configured',
    description:
      'Fill out .env.local from .env.example, then enable Google Auth and Firestore. The step-by-step guide is in FIREBASE_DEPLOY.md.',
    badge: 'the app is currently running locally',
  },
  authGate: {
    eyebrow: 'App sign-in',
    title: 'Sign in with Google',
    description:
      'After sign-in, meals and profile will load from Firestore and sync between devices.',
    button: 'Sign in with Google',
  },
  authLoading: {
    eyebrow: 'Firebase',
    description: 'Checking the session and loading data…',
    slowHint:
      'If this screen hangs too long, Firestore Database is usually not ready yet or 127.0.0.1 is missing from Authorized domains.',
  },
  menu: {
    open: 'Open menu',
    onboardingNotice:
      'Finish onboarding first. After that, the diary, stats, and profile will unlock.',
    cloud: 'Cloud',
    needsLogin: 'Sign-in required',
    firebaseNotConfigured: 'Firebase is not configured',
    loginHint: 'Sign in with Google to read and write data in Firestore.',
    envHint: 'Fill out .env.local and follow FIREBASE_DEPLOY.md',
    envRequired: 'env and Firebase project required',
    goal: 'Goal',
    googleUser: 'Google user',
    logout: 'Sign out',
    login: 'Sign in with Google',
  },
  sync: {
    local: 'Local',
    idle: 'No sync',
    loading: 'Loading',
    saving: 'Saving',
    saved: 'Saved',
    error: 'Error',
  },
  errors: {
    firebasePermission:
      'Firebase denied access to data. Check Firestore Database and the published rules.',
    firestorePrecondition:
      'Firestore is not ready yet. Create the Database in Firebase Console and try again.',
    firebaseUnavailable: 'Firebase is unavailable right now. Check the network and try again.',
    firebaseLoad: 'Could not load data from Firebase.',
    firebaseSave: 'Could not save changes to Firebase.',
    unauthorizedDomain:
      'This domain is not allowed for Google sign-in. Add 127.0.0.1 to Authorized domains.',
    popupClosed: 'Google sign-in was closed before completion.',
    networkFailed: 'Could not reach Firebase. Check the network and project settings.',
    googleLogin: 'Could not sign in with Google.',
    googleLogout: 'Could not sign out of the account.',
    googleRedirect: 'Could not complete Google sign-in.',
  },
  modals: {
    eyebrow: 'Confirmation',
    saveWeightTitle: 'Save weight?',
    saveWeightDescription: (date: string, weight: string) =>
      `For ${date}, ${weight} kg will be saved. After confirmation the field will lock until the next day.`,
    deleteMealTitle: 'Delete meal entry?',
    deleteMealDescription: (name: string) =>
      `The entry "${name}" will be removed from the current meal.`,
    deleteWorkoutTitle: 'Delete activity?',
    deleteWorkoutDescription: (name: string) =>
      `The entry "${name}" will be removed from the activity for the current day.`,
  },
  onboarding: {
    eyebrow: 'Onboarding',
    title: 'Fill in your profile before starting',
    description:
      'These data are needed to calculate calories and macros. After saving, the profile will be stored in the account and used on all devices.',
    base: 'Base',
    goalActivity: 'Goal and activity',
    gender: 'Gender',
    age: 'Age',
    height: 'Height, cm',
    currentWeight: 'Current weight, kg',
    currentWeightHint: 'This becomes the starting point and the first weight entry for today.',
    targetWeight: 'Target weight, kg',
    goal: 'Goal',
    rate: 'Rate, kg per week',
    activity: 'Activity',
    macroGoals: 'Macro targets',
    macroGoalsDescription:
      'You can keep the automatic calculation or set your own values right away.',
    editLater: 'You can change these data later in profile.',
    saveAndStart: 'Save and start',
    currentCalculation: 'Current calculation',
    whatMatters: 'What matters to set up',
    checklist: [
      'Gender, age, height, and current weight are needed for the starting expenditure estimate.',
      'Goal and overall activity level are needed for the starting maintenance and deficit estimate.',
      'It is better to log steps and specific workouts on the main screen from the actual day instead of guessing with an average.',
      'If you want full control over macros, switch to manual mode and set your own numbers.',
    ],
  },
  metrics: {
    bmr: 'basal metabolism',
    tdee: 'maintenance with activity',
    adjustment: 'Adjustment',
    adjustmentNote: 'surplus or deficit for the goal',
    activeGoal: 'Active goal',
    activeGoalNote: 'which mode is used right now',
    auto: 'auto',
    manual: 'manual',
  },
  today: {
    caloriesEyebrow: 'Calories today',
    consumedOfGoal: (goal: string) => `of ${goal} kcal including workout`,
    remaining: 'Remaining',
    over: 'Over by',
    dailyProgress: 'Daily progress',
    dailyProgressRemaining: (calories: string) => `${calories} kcal left to the limit including workout`,
    dailyProgressOver: (calories: string) => `${calories} kcal above the limit`,
    legendConsumed: (calories: string) => `${calories} eaten`,
    legendBase: (calories: string) => `${calories} base`,
    legendWorkout: (calories: string) => `+${calories} workout`,
    legendSafe: (min: string, max: string) => `safe ${min}-${max}`,
    dayLimit: (calories: string) => `${calories} daily limit`,
    baseShort: 'Base',
    workoutShort: 'Workout',
    safeShort: 'Safe',
    remainingShort: 'Remaining',
    workoutCreditNote: (percent: number) =>
      `I only return about ${percent}% of workout calories back into food. This is safer because watches and formulas often overestimate burn, and part of the activity is already included in the overall activity level.`,
    weightEyebrow: 'Weight today',
    weightSaved: 'Saved',
    weightSave: 'Save',
    weightSavedHint: (date: string) => `Weight for ${date} has already been saved.`,
    weightSaveHint: 'Weight can be saved once per day after confirmation.',
    addEyebrow: 'Add',
    addTitle: 'Add food',
    namePlaceholder: 'Name',
    gramsPlaceholder: 'Grams',
    caloriesPlaceholder: 'Calories',
    proteinPlaceholder: 'Protein',
    fatPlaceholder: 'Fat',
    carbsPlaceholder: 'Carbs',
    foodPending: 'Estimating macros from the description…',
    foodPlaceholder: '180 g buckwheat, 150 g chicken and salad',
    draftTitle: 'Meal draft',
    draftCommentaryTitle: 'How I counted it',
    draftItems: (count: number) => `${count} items`,
    draftTargetHint: 'You can change the target meal right before confirmation.',
    mealsTitle: 'Meals',
    entriesCount: (count: number) => `${count} entries`,
    mealItemsCount: (count: number) => `${count} items`,
    mealEmpty: 'Nothing here yet. Add food manually or via GPT.',
    activityEyebrow: 'Activity',
    activityTitle: 'Workouts and steps',
    sessionsToday: 'Sessions today',
    stepsLogged: 'Steps logged',
    burnLogged: 'Burn logged',
    activityHint:
      'It is better to log activity from the actual day: strength or cardio as one session, and steps as a separate entry when you have the final number.',
    workoutTitlePlaceholder: 'Workout name',
    workoutPending: 'Analyzing activity and estimating the burn…',
    workoutDraftTitle: 'Workout draft',
    dailyActivityTitle: 'Activity for the day',
    dailyActivityCount: (count: number) => `${count} entries`,
    dailyActivityEmpty:
      'Nothing here yet. Add a workout, walk, or steps manually or via GPT.',
  },
  stats: {
    eyebrow: 'Analytics for the period',
    title: 'Stats',
    description: 'Only real diary entries: weight, calories, and activity for the selected period.',
    ranges: {
      '7d': '7 days',
      '30d': '30 days',
      '90d': '90 days',
    },
    weightGained: 'Weight gained',
    weightLost: 'Weight lost',
    weightChanged: 'Weight change',
    toGoal: 'To goal',
    averageCalories: 'Average calories',
    activity: 'Activity',
    noData: 'No data',
    appearsAfterFood: 'Will appear after the first food entries',
    appearsAfterWorkouts: 'Will appear after the first workouts or steps',
    weight: 'Weight',
    currentWeightNow: (weight: string) => `${weight} kg now`,
    pointsAndChange: (count: number, change: string) => `${count} points · ${change} kg for the period`,
    chartAria: 'Weight chart',
    periodStart: 'Period start',
    current: 'Current',
    goal: 'Goal',
    caloriesByDay: 'Calories by day',
    adherenceTitle: (adherence: number, total: number) => `${adherence}/${total} days in range`,
    noFoodLogs: 'No food logs yet',
    dailyLimitDelta: (delta: string) => `${delta} kcal to the average limit`,
    afterFirstEntries: 'The day-by-day trend will appear after the first entries',
    chartEmpty:
      'The calorie trend will appear here when there is at least one day with food in the diary.',
    inRange: 'in range',
    belowLimit: 'below limit',
    aboveLimit: 'above limit',
    limitNote: 'The daily limit here already includes the workout bonus, same as on Today.',
    goalReached: (goalWeight: string) => `Goal of ${goalWeight} kg has already been reached`,
    goalProgress: (progress: number, goalWeight: string) => `${progress}% done · goal ${goalWeight} kg`,
    averageCaloriesNote: (delta: string, adherence: number, total: number) =>
      `${delta} kcal to the average limit · ${adherence}/${total} days in range`,
    activityNote: (entries: number, activeDays: number, rangeDays: number, averageSteps: string | null) =>
      `${entries} entries · ${activeDays}/${rangeDays} active days${averageSteps ? ` · ${averageSteps} avg steps` : ''}`,
  },
  profile: {
    eyebrow: 'Profile and goals',
    title: 'Settings',
    description: 'Base inputs for the goal and daily macro calculation.',
    autosave: 'changes save automatically',
    base: 'Base',
    goalActivity: 'Goal and activity',
    currentWeightHint: 'Weight is updated on the main screen and saved once per day.',
    macroGoals: 'Macro targets',
    macroGoalsDescription: 'You can keep the automatic calculation or set your own values manually.',
    currentCalculation: 'Current calculation',
    whatDataMatter: 'What data matter',
    whatDataChecklist: [
      'Required: gender, age, height, current weight, goal, activity.',
      'Highly recommended: target weight and the pace of weight change.',
      'It is easier to log steps and workouts for the actual day in Today when you have real numbers instead of a rough average.',
      'For accuracy after the start: daily weight and an honest calorie log for at least 2-3 weeks.',
      'Optional extras: waist size, body fat percentage, and nutrition restrictions.',
    ],
    formulaTitle: 'Why weight matters more than the formula',
    formulaBody:
      'The formula is only the starting point. Accuracy comes from the combination of daily weight, real calories, and activity. If after a couple of weeks the weight is not moving where it should, the app can suggest a better target than any universal calculator.',
  },
  drafts: {
    defaultMealName: 'Meal',
    withWord: 'with',
    andWord: 'and',
    preparedMeal: (title: string, meal: string) => `Prepared "${title}" for "${meal}".`,
    mealAccepted: (meal: string) => `Draft accepted. Items were added to "${meal}".`,
    localFallback: 'Chat server is unavailable, using a local estimate.',
    foodCommentaryFallback: 'Counted the items using the built-in food reference values.',
    foodCommentaryEstimatedWeights:
      'Some weights were estimated from context because grams were not provided for every item.',
    foodCommentaryDryWeight: (food: string) => `Counted ${food} as dry weight because you explicitly wrote it that way.`,
    foodCommentaryCookedWeight: (food: string) =>
      `Counted ${food} as cooked or ready weight because there was no dry or raw note.`,
    foodCommentaryHeavy: (calories: string, carbs: string) =>
      `Around ${calories} kcal and ${carbs} g carbs here. That is less "light bite" and more "carb presentation deck".`,
    workoutLogged: 'Prepared a draft.',
    workoutEstimated: 'Estimated the load from the description.',
    workoutAccepted: (date: string) => `Draft accepted. The entry was added to workouts for ${date}.`,
    assistantFood:
      'Describe food in plain language. I will prepare a draft and add it after confirmation.',
    assistantWorkout:
      'Describe the workout in plain language: exercises, minutes, steps, or burned kcal.',
    changeMealTarget: (title: string, meal: string) => `Prepared "${title}" for "${meal}".`,
  },
  workoutTitles: {
    walking: 'Steps',
    squats: 'Squats',
    press: 'Press',
    deadlift: 'Deadlift',
    pullups: 'Pull-ups',
    pushups: 'Push-ups',
    running: 'Run',
    cycling: 'Cycling',
    yoga: 'Yoga',
    stretching: 'Stretching',
  },
}

const appCopy: Record<Locale, typeof englishCopy> = {
  en: englishCopy,
  ru: {
    tabs: {
      today: { label: 'Сегодня', note: 'Еда, вес и быстрый ввод' },
      stats: { label: 'Статистика', note: 'Неделя, месяц и тренды' },
      profile: { label: 'Профиль', note: 'Цели и расчет КБЖУ' },
    },
    macros: {
      calories: 'Калории',
      protein: 'Белки',
      fat: 'Жиры',
      carbs: 'Углеводы',
    },
    activityOptions: {
      low: { label: 'Сидячий', note: 'офис, мало шагов' },
      moderate: { label: 'Умеренный', note: 'много ходьбы и 2-3 тренировки' },
      high: { label: 'Активный', note: 'частые тренировки и высокий NEAT' },
      athlete: { label: 'Очень активный', note: 'спорт почти каждый день' },
    },
    workoutTypes: {
      strength: {
        label: 'Силовая',
        note: 'подходы, повторения, упражнения',
        inputLabel: 'Сожжено, ккал',
        inputPlaceholder: '220',
        chatPlaceholder: 'Я присел 20 раз по 4 подхода и сделал жим ногами',
        defaultTitle: 'Тренировка',
      },
      cardio: {
        label: 'Кардио',
        note: 'бег, велосипед, дорожка, интервалы',
        inputLabel: 'Сожжено, ккал',
        inputPlaceholder: '320',
        chatPlaceholder: 'Пробежал 35 минут в спокойном темпе',
        defaultTitle: 'Кардио',
      },
      walking: {
        label: 'Шаги',
        note: 'прогулка, поход пешком, длительная ходьба',
        inputLabel: 'Шаги',
        inputPlaceholder: '8500',
        chatPlaceholder: 'Сегодня прошел 9600 шагов',
        defaultTitle: 'Шаги',
      },
      mobility: {
        label: 'Восстановление',
        note: 'растяжка, йога, мобилити',
        inputLabel: 'Сожжено, ккал',
        inputPlaceholder: '90',
        chatPlaceholder: 'Сделал 25 минут растяжки после тренировки',
        defaultTitle: 'Восстановление',
      },
    },
    meals: {
      breakfast: {
        title: 'Завтрак',
        time: '08:00-10:00',
        note: 'Старт дня и первая порция белка.',
      },
      lunch: {
        title: 'Обед',
        time: '12:30-14:30',
        note: 'Основной прием пищи и база по энергии.',
      },
      dinner: {
        title: 'Ужин',
        time: '18:30-20:30',
        note: 'Чуть легче по калориям, но не по белку.',
      },
      snacks: {
        title: 'Перекусы',
        time: 'Свободно',
        note: 'Контроль голода без срыва в калории.',
      },
    },
    sources: { manual: 'ручной', gpt: 'GPT' },
    goals: { cut: 'Снижение веса', maintain: 'Поддержание', bulk: 'Набор' },
    genders: { male: 'Мужчина', female: 'Женщина' },
    goalModes: { auto: 'Авто', manual: 'Вручную' },
    common: {
      cancel: 'Отмена',
      confirm: 'Подтвердить',
      delete: 'Удалить',
      save: 'Сохранить',
      saved: 'Сохранено',
      clear: 'Очистить',
      accept: 'Принять',
      add: 'Добавить',
      prepare: 'Подготовить',
      preparing: 'Считаю…',
      manual: 'Вручную',
      recommendation: 'рекомендация',
      perDay: 'в день',
      result: 'Итог',
      total: 'Итого',
      draft: 'Черновик',
      log: 'Лог',
    },
    units: { kcal: 'ккал', grams: 'г', kg: 'кг', steps: 'шагов', points: 'точек' },
    localeMenu: { label: 'Язык' },
    setupBanner: {
      title: 'Firebase не настроен',
      description:
        'Заполни .env.local по шаблону из .env.example, затем включи Google Auth и Firestore. Пошаговая инструкция лежит в FIREBASE_DEPLOY.md.',
      badge: 'сейчас приложение работает локально',
    },
    authGate: {
      eyebrow: 'Вход в приложение',
      title: 'Войди через Google',
      description:
        'После входа meals и profile будут читаться из Firestore и синхронизироваться между устройствами.',
      button: 'Войти через Google',
    },
    authLoading: {
      eyebrow: 'Firebase',
      description: 'Проверяем сессию и загружаем данные…',
      slowHint:
        'Если экран висит слишком долго, обычно не готов Firestore Database или для локального адреса не добавлен домен 127.0.0.1.',
    },
    menu: {
      open: 'Открыть меню',
      onboardingNotice:
        'Сначала заполни анкету. После этого откроются дневник, статистика и профиль.',
      cloud: 'Cloud',
      needsLogin: 'Нужен вход',
      firebaseNotConfigured: 'Firebase не настроен',
      loginHint: 'Войди через Google, чтобы читать и писать данные в Firestore.',
      envHint: 'Заполни .env.local и следуй FIREBASE_DEPLOY.md',
      envRequired: 'Нужны env и Firebase project',
      goal: 'Цель',
      googleUser: 'Google user',
      logout: 'Выйти',
      login: 'Войти через Google',
    },
    sync: {
      local: 'Локально',
      idle: 'Без sync',
      loading: 'Загрузка',
      saving: 'Сохранение',
      saved: 'Сохранено',
      error: 'Ошибка',
    },
    errors: {
      firebasePermission:
        'Firebase отклонил доступ к данным. Проверь Firestore Database и опубликованные rules.',
      firestorePrecondition:
        'Firestore еще не готов. Создай Database в Firebase Console и попробуй снова.',
      firebaseUnavailable: 'Firebase сейчас недоступен. Проверь сеть и повтори попытку.',
      firebaseLoad: 'Не удалось загрузить данные из Firebase.',
      firebaseSave: 'Не удалось сохранить изменения в Firebase.',
      unauthorizedDomain:
        'Домен не разрешен для Google login. Добавь 127.0.0.1 в Authorized domains.',
      popupClosed: 'Вход через Google был закрыт до завершения.',
      networkFailed: 'Не удалось связаться с Firebase. Проверь сеть и настройки проекта.',
      googleLogin: 'Не удалось войти через Google.',
      googleLogout: 'Не удалось выйти из аккаунта.',
      googleRedirect: 'Не удалось завершить вход через Google.',
    },
    modals: {
      eyebrow: 'Подтверждение',
      saveWeightTitle: 'Сохранить вес?',
      saveWeightDescription: (date: string, weight: string) =>
        `За ${date} будет сохранено ${weight} кг. После подтверждения поле заблокируется до следующего дня.`,
      deleteMealTitle: 'Удалить прием пищи?',
      deleteMealDescription: (name: string) => `Запись «${name}» будет удалена из текущего приема пищи.`,
      deleteWorkoutTitle: 'Удалить активность?',
      deleteWorkoutDescription: (name: string) =>
        `Запись «${name}» будет удалена из активности за текущий день.`,
    },
    onboarding: {
      eyebrow: 'Анкета',
      title: 'Заполни профиль перед стартом',
      description:
        'Эти данные нужны для расчета калорий и КБЖУ. После сохранения анкета уйдет в аккаунт и будет использоваться на всех устройствах.',
      base: 'База',
      goalActivity: 'Цель и активность',
      gender: 'Пол',
      age: 'Возраст',
      height: 'Рост, см',
      currentWeight: 'Текущий вес, кг',
      currentWeightHint: 'Это станет стартовой точкой и первой записью веса за сегодня.',
      targetWeight: 'Целевой вес, кг',
      goal: 'Цель',
      rate: 'Темп, кг в неделю',
      activity: 'Активность',
      macroGoals: 'Цели КБЖУ',
      macroGoalsDescription:
        'Можно оставить автоматический расчет или сразу задать свои значения вручную.',
      editLater: 'Изменить эти данные можно будет позже в профиле.',
      saveAndStart: 'Сохранить и начать',
      currentCalculation: 'Расчет сейчас',
      whatMatters: 'Что важно указать',
      checklist: [
        'Пол, возраст, рост и текущий вес нужны для стартового расчета расхода.',
        'Цель и общий уровень активности нужны для стартового расчета поддержки и дефицита.',
        'Шаги и конкретные тренировки лучше заносить по факту на главном экране, а не угадывать средней цифрой.',
        'Если хочешь полностью контролировать КБЖУ сам, включи ручной режим и задай свои цифры.',
      ],
    },
    metrics: {
      bmr: 'базовый обмен',
      tdee: 'поддержание с активностью',
      adjustment: 'Коррекция',
      adjustmentNote: 'добавка или дефицит под цель',
      activeGoal: 'Активная цель',
      activeGoalNote: 'какой режим сейчас используется',
      auto: 'авто',
      manual: 'ручная',
    },
    today: {
      caloriesEyebrow: 'Калории сегодня',
      consumedOfGoal: (goal: string) => `из ${goal} ккал с учетом тренировки`,
      remaining: 'Осталось',
      over: 'Перебор',
      dailyProgress: 'Дневной прогресс',
      dailyProgressRemaining: (calories: string) => `Еще ${calories} ккал до лимита с учетом тренировки`,
      dailyProgressOver: (calories: string) => `Выше лимита на ${calories} ккал`,
      legendConsumed: (calories: string) => `${calories} съедено`,
      legendBase: (calories: string) => `${calories} база`,
      legendWorkout: (calories: string) => `+${calories} тренировка`,
      legendSafe: (min: string, max: string) => `safe ${min}-${max}`,
      dayLimit: (calories: string) => `${calories} лимит дня`,
      baseShort: 'База',
      workoutShort: 'Тренировка',
      safeShort: 'Safe',
      remainingShort: 'Осталось',
      workoutCreditNote: (percent: number) =>
        `Тренировочные ккал возвращаю в питание не полностью, а примерно на ${percent}%: так безопаснее, потому что часы и формулы часто завышают расход, а часть активности уже сидит в общем уровне активности.`,
      weightEyebrow: 'Вес сегодня',
      weightSaved: 'Сохранено',
      weightSave: 'Сохранить',
      weightSavedHint: (date: string) => `Вес за ${date} уже сохранен.`,
      weightSaveHint: 'Вес можно сохранить один раз в день после подтверждения.',
      addEyebrow: 'Добавление',
      addTitle: 'Добавить еду',
      namePlaceholder: 'Название',
      gramsPlaceholder: 'Граммы',
      caloriesPlaceholder: 'Калории',
      proteinPlaceholder: 'Белки',
      fatPlaceholder: 'Жиры',
      carbsPlaceholder: 'Углеводы',
      foodPending: 'Считаю КБЖУ по описанию…',
      foodPlaceholder: '180 г гречки, 150 г курицы и салат',
      draftTitle: 'Черновик блюда',
      draftCommentaryTitle: 'Как посчитал',
      draftItems: (count: number) => `${count} поз.`,
      draftTargetHint: 'Можно поменять, куда вставить блюдо, прямо перед подтверждением.',
      mealsTitle: 'Приемы пищи',
      entriesCount: (count: number) => `${count} записей`,
      mealItemsCount: (count: number) => `${count} позиций`,
      mealEmpty: 'Пока пусто. Добавь еду вручную или через GPT.',
      activityEyebrow: 'Активность',
      activityTitle: 'Тренировки и шаги',
      sessionsToday: 'Сессии за день',
      stepsLogged: 'Шаги занесены',
      burnLogged: 'Расход занесен',
      activityHint:
        'Лучше логировать активность по факту дня: силовую или кардио как одну сессию, а шаги отдельной записью, когда есть итоговая цифра.',
      workoutTitlePlaceholder: 'Название тренировки',
      workoutPending: 'Разбираю активность и считаю расход…',
      workoutDraftTitle: 'Черновик тренировки',
      dailyActivityTitle: 'Активность за день',
      dailyActivityCount: (count: number) => `${count} записей`,
      dailyActivityEmpty:
        'Пока пусто. Добавь тренировку, прогулку или шаги вручную либо через GPT.',
    },
    stats: {
      eyebrow: 'Аналитика за период',
      title: 'Статистика',
      description: 'Только реальные записи из дневника: вес, калории и активность за выбранный период.',
      ranges: { '7d': '7 дней', '30d': '30 дней', '90d': '90 дней' },
      weightGained: 'Набрано веса',
      weightLost: 'Скинуто веса',
      weightChanged: 'Изменение веса',
      toGoal: 'До цели',
      averageCalories: 'Средние калории',
      activity: 'Активность',
      noData: 'Нет данных',
      appearsAfterFood: 'Появится после первых записей еды',
      appearsAfterWorkouts: 'Появится после первых тренировок или шагов',
      weight: 'Вес',
      currentWeightNow: (weight: string) => `${weight} кг сейчас`,
      pointsAndChange: (count: number, change: string) => `${count} точек · ${change} кг за период`,
      chartAria: 'График веса',
      periodStart: 'Старт периода',
      current: 'Сейчас',
      goal: 'Цель',
      caloriesByDay: 'Калории по дням',
      adherenceTitle: (adherence: number, total: number) => `${adherence}/${total} дней в коридоре`,
      noFoodLogs: 'Пока нет логов еды',
      dailyLimitDelta: (delta: string) => `${delta} ккал к среднему лимиту`,
      afterFirstEntries: 'После первых записей появится динамика по дням',
      chartEmpty:
        'Здесь появится динамика калорий, когда в дневнике будет хотя бы один день с едой.',
      inRange: 'в коридоре',
      belowLimit: 'ниже лимита',
      aboveLimit: 'выше лимита',
      limitNote: 'Лимит по дню считается с учетом тренировочного бонуса, как и на экране Today.',
      goalReached: (goalWeight: string) => `Цель ${goalWeight} кг уже достигнута`,
      goalProgress: (progress: number, goalWeight: string) => `${progress}% пути закрыто · цель ${goalWeight} кг`,
      averageCaloriesNote: (delta: string, adherence: number, total: number) =>
        `${delta} ккал к среднему лимиту · ${adherence}/${total} дней в коридоре`,
      activityNote: (entries: number, activeDays: number, rangeDays: number, averageSteps: string | null) =>
        `${entries} записей · ${activeDays}/${rangeDays} активных дней${averageSteps ? ` · ${averageSteps} шагов в среднем` : ''}`,
    },
    profile: {
      eyebrow: 'Профиль и цели',
      title: 'Настройки',
      description: 'База для расчета цели и дневных КБЖУ.',
      autosave: 'изменения сохраняются сразу',
      base: 'База',
      goalActivity: 'Цель и активность',
      currentWeightHint: 'Вес обновляется на главном экране и фиксируется один раз в день.',
      macroGoals: 'Цели КБЖУ',
      macroGoalsDescription:
        'Можно оставить автоматический расчет или задать свои цифры вручную.',
      currentCalculation: 'Расчет сейчас',
      whatDataMatter: 'Какие данные нужны',
      whatDataChecklist: [
        'Обязательно: пол, возраст, рост, текущий вес, цель, активность.',
        'Очень желательно: целевой вес и темп изменения веса.',
        'Шаги и тренировки удобнее заносить на день в разделе Сегодня, когда есть факт, а не средняя оценка.',
        'Для точности после старта: ежедневный вес и честный лог калорий хотя бы 2-3 недели.',
        'Дополнительно: окружность талии, процент жира и ограничения в питании — это уже опционально.',
      ],
      formulaTitle: 'Почему вес важнее формулы',
      formulaBody:
        'Формула нужна только для старта. Затем точность дает связка из ежедневного веса, реальных калорий и активности. Если в течение пары недель вес не идет туда, куда должен, приложение может предложить новую цель точнее любого универсального калькулятора.',
    },
    drafts: {
      defaultMealName: 'Блюдо',
      withWord: 'с',
      andWord: 'и',
      preparedMeal: (title: string, meal: string) => `Подготовил «${title}» для приема пищи «${meal}».`,
      mealAccepted: (meal: string) => `Черновик принят. Позиции добавлены в «${meal}».`,
      localFallback: 'Сервер чата недоступен, использую локальную оценку.',
      foodCommentaryFallback: 'Посчитал позиции по встроенным справочным значениям продуктов.',
      foodCommentaryEstimatedWeights:
        'Часть граммовок оценил по контексту, потому что не для всех позиций был указан вес.',
      foodCommentaryDryWeight: (food: string) => `Посчитал ${food} как сухой вес, потому что ты это явно указал.`,
      foodCommentaryCookedWeight: (food: string) =>
        `Посчитал ${food} как готовый вес, потому что пометки про сухой или сырой вес не было.`,
      foodCommentaryHeavy: (calories: string, carbs: string) =>
        `Тут около ${calories} ккал и ${carbs} г углеводов. Это уже не перекус, а полноценный доклад по углеводам.`,
      workoutLogged: 'Зафиксировал черновик.',
      workoutEstimated: 'Оценил нагрузку по описанию.',
      workoutAccepted: (date: string) => `Черновик принят. Запись добавлена в тренировки за ${date}.`,
      assistantFood:
        'Опиши еду обычным языком. Я подготовлю черновик и добавлю его после подтверждения.',
      assistantWorkout:
        'Опиши тренировку обычным языком: упражнения, минуты, шаги или сожженные ккал.',
      changeMealTarget: (title: string, meal: string) => `Подготовил «${title}» для приема пищи «${meal}».`,
    },
    workoutTitles: {
      walking: 'Шаги',
      squats: 'Приседания',
      press: 'Жим',
      deadlift: 'Тяга',
      pullups: 'Подтягивания',
      pushups: 'Отжимания',
      running: 'Бег',
      cycling: 'Велотренировка',
      yoga: 'Йога',
      stretching: 'Растяжка',
    },
  },
  uk: {
    tabs: {
      today: { label: 'Сьогодні', note: 'Їжа, вага і швидке додавання' },
      stats: { label: 'Статистика', note: 'Тиждень, місяць і тренди' },
      profile: { label: 'Профіль', note: 'Цілі та розрахунок КБЖВ' },
    },
    macros: {
      calories: 'Калорії',
      protein: 'Білки',
      fat: 'Жири',
      carbs: 'Вуглеводи',
    },
    activityOptions: {
      low: { label: 'Низька', note: 'офіс, мало кроків' },
      moderate: { label: 'Помірна', note: 'багато ходьби та 2-3 тренування' },
      high: { label: 'Активна', note: 'часті тренування та високий NEAT' },
      athlete: { label: 'Дуже активна', note: 'спорт майже щодня' },
    },
    workoutTypes: {
      strength: {
        label: 'Силова',
        note: 'підходи, повтори, вправи',
        inputLabel: 'Спалено, ккал',
        inputPlaceholder: '220',
        chatPlaceholder: 'Я зробив 4 підходи по 20 присідань і жим ногами',
        defaultTitle: 'Тренування',
      },
      cardio: {
        label: 'Кардіо',
        note: 'біг, велосипед, доріжка, інтервали',
        inputLabel: 'Спалено, ккал',
        inputPlaceholder: '320',
        chatPlaceholder: 'Я біг 35 хвилин у спокійному темпі',
        defaultTitle: 'Кардіо',
      },
      walking: {
        label: 'Кроки',
        note: 'прогулянка, похід пішки, тривала ходьба',
        inputLabel: 'Кроки',
        inputPlaceholder: '8500',
        chatPlaceholder: 'Сьогодні я пройшов 9600 кроків',
        defaultTitle: 'Кроки',
      },
      mobility: {
        label: 'Відновлення',
        note: 'розтяжка, йога, мобільність',
        inputLabel: 'Спалено, ккал',
        inputPlaceholder: '90',
        chatPlaceholder: 'Я зробив 25 хвилин розтяжки після тренування',
        defaultTitle: 'Відновлення',
      },
    },
    meals: {
      breakfast: { title: 'Сніданок', time: '08:00-10:00', note: 'Початок дня і перша порція білка.' },
      lunch: { title: 'Обід', time: '12:30-14:30', note: 'Основний прийом їжі та база енергії.' },
      dinner: { title: 'Вечеря', time: '18:30-20:30', note: 'Трохи легше за калоріями, але не за білком.' },
      snacks: { title: 'Перекуси', time: 'Вільно', note: 'Контроль голоду без зриву по калоріях.' },
    },
    sources: { manual: 'вручну', gpt: 'GPT' },
    goals: { cut: 'Схуднення', maintain: 'Підтримка', bulk: 'Набір' },
    genders: { male: 'Чоловік', female: 'Жінка' },
    goalModes: { auto: 'Авто', manual: 'Вручну' },
    common: {
      cancel: 'Скасувати',
      confirm: 'Підтвердити',
      delete: 'Видалити',
      save: 'Зберегти',
      saved: 'Збережено',
      clear: 'Очистити',
      accept: 'Прийняти',
      add: 'Додати',
      prepare: 'Підготувати',
      preparing: 'Рахую…',
      manual: 'Вручну',
      recommendation: 'рекомендація',
      perDay: 'на день',
      result: 'Підсумок',
      total: 'Разом',
      draft: 'Чернетка',
      log: 'Лог',
    },
    units: { kcal: 'ккал', grams: 'г', kg: 'кг', steps: 'кроків', points: 'точок' },
    localeMenu: { label: 'Мова' },
    setupBanner: {
      title: 'Firebase не налаштований',
      description:
        'Заповни .env.local за шаблоном з .env.example, потім увімкни Google Auth і Firestore. Покрокова інструкція є в FIREBASE_DEPLOY.md.',
      badge: 'зараз застосунок працює локально',
    },
    authGate: {
      eyebrow: 'Вхід у застосунок',
      title: 'Увійди через Google',
      description:
        'Після входу meals і profile будуть читатися з Firestore і синхронізуватися між пристроями.',
      button: 'Увійти через Google',
    },
    authLoading: {
      eyebrow: 'Firebase',
      description: 'Перевіряємо сесію та завантажуємо дані…',
      slowHint:
        'Якщо цей екран висить занадто довго, зазвичай ще не готовий Firestore Database або для локальної адреси не додано домен 127.0.0.1.',
    },
    menu: {
      open: 'Відкрити меню',
      onboardingNotice: 'Спочатку заповни анкету. Після цього відкриються щоденник, статистика та профіль.',
      cloud: 'Cloud',
      needsLogin: 'Потрібен вхід',
      firebaseNotConfigured: 'Firebase не налаштований',
      loginHint: 'Увійди через Google, щоб читати і записувати дані в Firestore.',
      envHint: 'Заповни .env.local і дотримуйся FIREBASE_DEPLOY.md',
      envRequired: 'Потрібні env і Firebase project',
      goal: 'Ціль',
      googleUser: 'Google user',
      logout: 'Вийти',
      login: 'Увійти через Google',
    },
    sync: {
      local: 'Локально',
      idle: 'Без sync',
      loading: 'Завантаження',
      saving: 'Збереження',
      saved: 'Збережено',
      error: 'Помилка',
    },
    errors: {
      firebasePermission:
        'Firebase відхилив доступ до даних. Перевір Firestore Database і опубліковані rules.',
      firestorePrecondition:
        'Firestore ще не готовий. Створи Database у Firebase Console і спробуй ще раз.',
      firebaseUnavailable: 'Firebase зараз недоступний. Перевір мережу і спробуй ще раз.',
      firebaseLoad: 'Не вдалося завантажити дані з Firebase.',
      firebaseSave: 'Не вдалося зберегти зміни у Firebase.',
      unauthorizedDomain:
        'Домен не дозволений для Google login. Додай 127.0.0.1 у Authorized domains.',
      popupClosed: 'Вхід через Google було закрито до завершення.',
      networkFailed: 'Не вдалося зʼєднатися з Firebase. Перевір мережу і налаштування проєкту.',
      googleLogin: 'Не вдалося увійти через Google.',
      googleLogout: 'Не вдалося вийти з акаунта.',
      googleRedirect: 'Не вдалося завершити вхід через Google.',
    },
    modals: {
      eyebrow: 'Підтвердження',
      saveWeightTitle: 'Зберегти вагу?',
      saveWeightDescription: (date: string, weight: string) =>
        `За ${date} буде збережено ${weight} кг. Після підтвердження поле заблокується до наступного дня.`,
      deleteMealTitle: 'Видалити прийом їжі?',
      deleteMealDescription: (name: string) => `Запис «${name}» буде видалено з поточного прийому їжі.`,
      deleteWorkoutTitle: 'Видалити активність?',
      deleteWorkoutDescription: (name: string) =>
        `Запис «${name}» буде видалено з активності за поточний день.`,
    },
    onboarding: {
      eyebrow: 'Анкета',
      title: 'Заповни профіль перед стартом',
      description:
        'Ці дані потрібні для розрахунку калорій і КБЖВ. Після збереження анкета піде в акаунт і буде використовуватися на всіх пристроях.',
      base: 'База',
      goalActivity: 'Ціль і активність',
      gender: 'Стать',
      age: 'Вік',
      height: 'Зріст, см',
      currentWeight: 'Поточна вага, кг',
      currentWeightHint: 'Це стане стартовою точкою і першим записом ваги за сьогодні.',
      targetWeight: 'Цільова вага, кг',
      goal: 'Ціль',
      rate: 'Темп, кг на тиждень',
      activity: 'Активність',
      macroGoals: 'Цілі КБЖВ',
      macroGoalsDescription: 'Можна залишити автоматичний розрахунок або одразу задати свої значення вручну.',
      editLater: 'Змінити ці дані можна буде пізніше у профілі.',
      saveAndStart: 'Зберегти і почати',
      currentCalculation: 'Розрахунок зараз',
      whatMatters: 'Що важливо вказати',
      checklist: [
        'Стать, вік, зріст і поточна вага потрібні для стартового розрахунку витрати.',
        'Ціль і загальний рівень активності потрібні для стартового розрахунку підтримки і дефіциту.',
        'Кроки і конкретні тренування краще заносити за фактом на головному екрані, а не вгадувати середнім числом.',
        'Якщо хочеш повністю контролювати КБЖВ самостійно, увімкни ручний режим і задай свої цифри.',
      ],
    },
    metrics: {
      bmr: 'базовий обмін',
      tdee: 'підтримка з активністю',
      adjustment: 'Корекція',
      adjustmentNote: 'добавка або дефіцит під ціль',
      activeGoal: 'Активна ціль',
      activeGoalNote: 'який режим зараз використовується',
      auto: 'авто',
      manual: 'ручна',
    },
    today: {
      caloriesEyebrow: 'Калорії сьогодні',
      consumedOfGoal: (goal: string) => `з ${goal} ккал з урахуванням тренування`,
      remaining: 'Залишилось',
      over: 'Перебір',
      dailyProgress: 'Денний прогрес',
      dailyProgressRemaining: (calories: string) => `Ще ${calories} ккал до ліміту з урахуванням тренування`,
      dailyProgressOver: (calories: string) => `Вище ліміту на ${calories} ккал`,
      legendConsumed: (calories: string) => `${calories} зʼїдено`,
      legendBase: (calories: string) => `${calories} база`,
      legendWorkout: (calories: string) => `+${calories} тренування`,
      legendSafe: (min: string, max: string) => `safe ${min}-${max}`,
      dayLimit: (calories: string) => `${calories} ліміт дня`,
      baseShort: 'База',
      workoutShort: 'Тренування',
      safeShort: 'Safe',
      remainingShort: 'Залишилось',
      workoutCreditNote: (percent: number) =>
        `Тренувальні ккал повертаю в харчування не повністю, а приблизно на ${percent}%: так безпечніше, бо годинники і формули часто завищують витрати, а частина активності вже сидить у загальному рівні активності.`,
      weightEyebrow: 'Вага сьогодні',
      weightSaved: 'Збережено',
      weightSave: 'Зберегти',
      weightSavedHint: (date: string) => `Вага за ${date} вже збережена.`,
      weightSaveHint: 'Вагу можна зберегти один раз на день після підтвердження.',
      addEyebrow: 'Додавання',
      addTitle: 'Додати їжу',
      namePlaceholder: 'Назва',
      gramsPlaceholder: 'Грами',
      caloriesPlaceholder: 'Калорії',
      proteinPlaceholder: 'Білки',
      fatPlaceholder: 'Жири',
      carbsPlaceholder: 'Вуглеводи',
      foodPending: 'Рахую КБЖВ за описом…',
      foodPlaceholder: '180 г гречки, 150 г курки і салат',
      draftTitle: 'Чернетка страви',
      draftCommentaryTitle: 'Як порахував',
      draftItems: (count: number) => `${count} поз.`,
      draftTargetHint: 'Можна змінити, куди вставити страву, прямо перед підтвердженням.',
      mealsTitle: 'Прийоми їжі',
      entriesCount: (count: number) => `${count} записів`,
      mealItemsCount: (count: number) => `${count} позицій`,
      mealEmpty: 'Поки порожньо. Додай їжу вручну або через GPT.',
      activityEyebrow: 'Активність',
      activityTitle: 'Тренування і кроки',
      sessionsToday: 'Сесії за день',
      stepsLogged: 'Кроки занесено',
      burnLogged: 'Витрату занесено',
      activityHint:
        'Краще логувати активність за фактом дня: силове або кардіо як одну сесію, а кроки окремим записом, коли є підсумкова цифра.',
      workoutTitlePlaceholder: 'Назва тренування',
      workoutPending: 'Розбираю активність і рахую витрату…',
      workoutDraftTitle: 'Чернетка тренування',
      dailyActivityTitle: 'Активність за день',
      dailyActivityCount: (count: number) => `${count} записів`,
      dailyActivityEmpty: 'Поки порожньо. Додай тренування, прогулянку або кроки вручну чи через GPT.',
    },
    stats: {
      eyebrow: 'Аналітика за період',
      title: 'Статистика',
      description: 'Лише реальні записи зі щоденника: вага, калорії та активність за вибраний період.',
      ranges: { '7d': '7 днів', '30d': '30 днів', '90d': '90 днів' },
      weightGained: 'Набрано ваги',
      weightLost: 'Скинуто ваги',
      weightChanged: 'Зміна ваги',
      toGoal: 'До цілі',
      averageCalories: 'Середні калорії',
      activity: 'Активність',
      noData: 'Немає даних',
      appearsAfterFood: 'Зʼявиться після перших записів їжі',
      appearsAfterWorkouts: 'Зʼявиться після перших тренувань або кроків',
      weight: 'Вага',
      currentWeightNow: (weight: string) => `${weight} кг зараз`,
      pointsAndChange: (count: number, change: string) => `${count} точок · ${change} кг за період`,
      chartAria: 'Графік ваги',
      periodStart: 'Старт періоду',
      current: 'Зараз',
      goal: 'Ціль',
      caloriesByDay: 'Калорії по днях',
      adherenceTitle: (adherence: number, total: number) => `${adherence}/${total} днів у коридорі`,
      noFoodLogs: 'Поки немає логів їжі',
      dailyLimitDelta: (delta: string) => `${delta} ккал до середнього ліміту`,
      afterFirstEntries: 'Після перших записів зʼявиться динаміка по днях',
      chartEmpty: 'Тут зʼявиться динаміка калорій, коли у щоденнику буде хоча б один день з їжею.',
      inRange: 'у коридорі',
      belowLimit: 'нижче ліміту',
      aboveLimit: 'вище ліміту',
      limitNote: 'Ліміт по дню рахується з урахуванням тренувального бонусу, як і на екрані Today.',
      goalReached: (goalWeight: string) => `Ціль ${goalWeight} кг уже досягнута`,
      goalProgress: (progress: number, goalWeight: string) => `${progress}% шляху закрито · ціль ${goalWeight} кг`,
      averageCaloriesNote: (delta: string, adherence: number, total: number) =>
        `${delta} ккал до середнього ліміту · ${adherence}/${total} днів у коридорі`,
      activityNote: (entries: number, activeDays: number, rangeDays: number, averageSteps: string | null) =>
        `${entries} записів · ${activeDays}/${rangeDays} активних днів${averageSteps ? ` · ${averageSteps} кроків у середньому` : ''}`,
    },
    profile: {
      eyebrow: 'Профіль і цілі',
      title: 'Налаштування',
      description: 'База для розрахунку цілі та денних КБЖВ.',
      autosave: 'зміни зберігаються одразу',
      base: 'База',
      goalActivity: 'Ціль і активність',
      currentWeightHint: 'Вага оновлюється на головному екрані й фіксується один раз на день.',
      macroGoals: 'Цілі КБЖВ',
      macroGoalsDescription: 'Можна залишити автоматичний розрахунок або задати свої цифри вручну.',
      currentCalculation: 'Розрахунок зараз',
      whatDataMatter: 'Які дані потрібні',
      whatDataChecklist: [
        'Обовʼязково: стать, вік, зріст, поточна вага, ціль, активність.',
        'Дуже бажано: цільова вага і темп зміни ваги.',
        'Кроки і тренування зручніше заносити за день у розділі Сьогодні, коли є факт, а не середня оцінка.',
        'Для точності після старту: щоденна вага і чесний лог калорій хоча б 2-3 тижні.',
        'Додатково: обхват талії, відсоток жиру і обмеження в харчуванні — це вже опційно.',
      ],
      formulaTitle: 'Чому вага важливіша за формулу',
      formulaBody:
        'Формула потрібна лише для старту. Потім точність дає звʼязка з щоденної ваги, реальних калорій і активності. Якщо протягом кількох тижнів вага не рухається туди, куди треба, застосунок може запропонувати нову ціль точніше за будь-який універсальний калькулятор.',
    },
    drafts: {
      defaultMealName: 'Страва',
      withWord: 'з',
      andWord: 'і',
      preparedMeal: (title: string, meal: string) => `Підготував «${title}» для прийому їжі «${meal}».`,
      mealAccepted: (meal: string) => `Чернетку прийнято. Позиції додані в «${meal}».`,
      localFallback: 'Сервер чату недоступний, використовую локальну оцінку.',
      foodCommentaryFallback: 'Порахував позиції за вбудованими довідковими значеннями продуктів.',
      foodCommentaryEstimatedWeights:
        'Частину грамів оцінив за контекстом, бо вага була вказана не для всіх позицій.',
      foodCommentaryDryWeight: (food: string) => `Порахував ${food} як суху вагу, бо ти це прямо вказав.`,
      foodCommentaryCookedWeight: (food: string) =>
        `Порахував ${food} як готову вагу, бо не було позначки про суху чи сиру вагу.`,
      foodCommentaryHeavy: (calories: string, carbs: string) =>
        `Тут близько ${calories} ккал і ${carbs} г вуглеводів. Це вже не перекус, а окрема презентація про вуглеводи.`,
      workoutLogged: 'Зафіксував чернетку.',
      workoutEstimated: 'Оцінив навантаження за описом.',
      workoutAccepted: (date: string) => `Чернетку прийнято. Запис додано до тренувань за ${date}.`,
      assistantFood: 'Опиши їжу звичайною мовою. Я підготую чернетку і додам її після підтвердження.',
      assistantWorkout:
        'Опиши тренування звичайною мовою: вправи, хвилини, кроки або спалені ккал.',
      changeMealTarget: (title: string, meal: string) => `Підготував «${title}» для прийому їжі «${meal}».`,
    },
    workoutTitles: {
      walking: 'Кроки',
      squats: 'Присідання',
      press: 'Жим',
      deadlift: 'Тяга',
      pullups: 'Підтягування',
      pushups: 'Віджимання',
      running: 'Біг',
      cycling: 'Велотренування',
      yoga: 'Йога',
      stretching: 'Розтяжка',
    },
  },
  pl: {
    tabs: {
      today: { label: 'Dzisiaj', note: 'Jedzenie, waga i szybkie dodawanie' },
      stats: { label: 'Statystyki', note: 'Tydzień, miesiąc i trendy' },
      profile: { label: 'Profil', note: 'Cele i wyliczenie makro' },
    },
    macros: { calories: 'Kalorie', protein: 'Białko', fat: 'Tłuszcze', carbs: 'Węglowodany' },
    activityOptions: {
      low: { label: 'Niska', note: 'biuro, mało kroków' },
      moderate: { label: 'Umiarkowana', note: 'dużo chodzenia i 2-3 treningi' },
      high: { label: 'Aktywna', note: 'częste treningi i wysoki NEAT' },
      athlete: { label: 'Bardzo aktywna', note: 'sport prawie codziennie' },
    },
    workoutTypes: {
      strength: {
        label: 'Siłowy',
        note: 'serie, powtórzenia, ćwiczenia',
        inputLabel: 'Spalone, kcal',
        inputPlaceholder: '220',
        chatPlaceholder: 'Zrobiłem 4 serie po 20 przysiadów i leg press',
        defaultTitle: 'Trening',
      },
      cardio: {
        label: 'Cardio',
        note: 'bieg, rower, bieżnia, interwały',
        inputLabel: 'Spalone, kcal',
        inputPlaceholder: '320',
        chatPlaceholder: 'Biegałem 35 minut w spokojnym tempie',
        defaultTitle: 'Cardio',
      },
      walking: {
        label: 'Kroki',
        note: 'spacer, marsz, długi chód',
        inputLabel: 'Kroki',
        inputPlaceholder: '8500',
        chatPlaceholder: 'Dzisiaj zrobiłem 9600 kroków',
        defaultTitle: 'Kroki',
      },
      mobility: {
        label: 'Regeneracja',
        note: 'rozciąganie, joga, mobility',
        inputLabel: 'Spalone, kcal',
        inputPlaceholder: '90',
        chatPlaceholder: 'Zrobiłem 25 minut rozciągania po treningu',
        defaultTitle: 'Regeneracja',
      },
    },
    meals: {
      breakfast: { title: 'Śniadanie', time: '08:00-10:00', note: 'Start dnia i pierwsza porcja białka.' },
      lunch: { title: 'Obiad', time: '12:30-14:30', note: 'Główny posiłek i baza energii.' },
      dinner: { title: 'Kolacja', time: '18:30-20:30', note: 'Trochę lżej kalorycznie, ale nie pod względem białka.' },
      snacks: { title: 'Przekąski', time: 'Dowolnie', note: 'Kontrola głodu bez rozwalenia kalorii.' },
    },
    sources: { manual: 'ręcznie', gpt: 'GPT' },
    goals: { cut: 'Redukcja', maintain: 'Utrzymanie', bulk: 'Masa' },
    genders: { male: 'Mężczyzna', female: 'Kobieta' },
    goalModes: { auto: 'Auto', manual: 'Ręcznie' },
    common: {
      cancel: 'Anuluj',
      confirm: 'Potwierdź',
      delete: 'Usuń',
      save: 'Zapisz',
      saved: 'Zapisano',
      clear: 'Wyczyść',
      accept: 'Akceptuj',
      add: 'Dodaj',
      prepare: 'Przygotuj',
      preparing: 'Liczę…',
      manual: 'Ręcznie',
      recommendation: 'rekomendacja',
      perDay: 'dziennie',
      result: 'Wynik',
      total: 'Razem',
      draft: 'Szkic',
      log: 'Log',
    },
    units: { kcal: 'kcal', grams: 'g', kg: 'kg', steps: 'kroków', points: 'punktów' },
    localeMenu: { label: 'Język' },
    setupBanner: {
      title: 'Firebase nie jest skonfigurowany',
      description:
        'Uzupełnij .env.local według .env.example, a potem włącz Google Auth i Firestore. Instrukcja krok po kroku jest w FIREBASE_DEPLOY.md.',
      badge: 'aplikacja działa teraz lokalnie',
    },
    authGate: {
      eyebrow: 'Logowanie do aplikacji',
      title: 'Zaloguj się przez Google',
      description:
        'Po zalogowaniu meals i profile będą czytane z Firestore i synchronizowane między urządzeniami.',
      button: 'Zaloguj się przez Google',
    },
    authLoading: {
      eyebrow: 'Firebase',
      description: 'Sprawdzamy sesję i ładujemy dane…',
      slowHint:
        'Jeśli ten ekran wisi zbyt długo, zwykle Firestore Database nie jest jeszcze gotowy albo dla lokalnego adresu nie dodano domeny 127.0.0.1.',
    },
    menu: {
      open: 'Otwórz menu',
      onboardingNotice: 'Najpierw wypełnij onboarding. Potem odblokują się dziennik, statystyki i profil.',
      cloud: 'Cloud',
      needsLogin: 'Wymagane logowanie',
      firebaseNotConfigured: 'Firebase nie jest skonfigurowany',
      loginHint: 'Zaloguj się przez Google, aby czytać i zapisywać dane w Firestore.',
      envHint: 'Uzupełnij .env.local i postępuj według FIREBASE_DEPLOY.md',
      envRequired: 'Potrzebne env i Firebase project',
      goal: 'Cel',
      googleUser: 'Google user',
      logout: 'Wyloguj się',
      login: 'Zaloguj się przez Google',
    },
    sync: {
      local: 'Lokalnie',
      idle: 'Bez sync',
      loading: 'Ładowanie',
      saving: 'Zapisywanie',
      saved: 'Zapisano',
      error: 'Błąd',
    },
    errors: {
      firebasePermission:
        'Firebase odrzucił dostęp do danych. Sprawdź Firestore Database i opublikowane rules.',
      firestorePrecondition:
        'Firestore nie jest jeszcze gotowy. Utwórz Database w Firebase Console i spróbuj ponownie.',
      firebaseUnavailable: 'Firebase jest teraz niedostępny. Sprawdź sieć i spróbuj ponownie.',
      firebaseLoad: 'Nie udało się wczytać danych z Firebase.',
      firebaseSave: 'Nie udało się zapisać zmian w Firebase.',
      unauthorizedDomain:
        'Domena nie jest dozwolona dla Google login. Dodaj 127.0.0.1 do Authorized domains.',
      popupClosed: 'Logowanie Google zostało zamknięte przed zakończeniem.',
      networkFailed: 'Nie udało się połączyć z Firebase. Sprawdź sieć i ustawienia projektu.',
      googleLogin: 'Nie udało się zalogować przez Google.',
      googleLogout: 'Nie udało się wylogować z konta.',
      googleRedirect: 'Nie udało się dokończyć logowania Google.',
    },
    modals: {
      eyebrow: 'Potwierdzenie',
      saveWeightTitle: 'Zapisać wagę?',
      saveWeightDescription: (date: string, weight: string) =>
        `Dla ${date} zostanie zapisane ${weight} kg. Po potwierdzeniu pole zablokuje się do następnego dnia.`,
      deleteMealTitle: 'Usunąć wpis posiłku?',
      deleteMealDescription: (name: string) => `Wpis „${name}” zostanie usunięty z bieżącego posiłku.`,
      deleteWorkoutTitle: 'Usunąć aktywność?',
      deleteWorkoutDescription: (name: string) => `Wpis „${name}” zostanie usunięty z aktywności za bieżący dzień.`,
    },
    onboarding: {
      eyebrow: 'Onboarding',
      title: 'Uzupełnij profil przed startem',
      description:
        'Te dane są potrzebne do obliczenia kalorii i makro. Po zapisaniu profil trafi do konta i będzie używany na wszystkich urządzeniach.',
      base: 'Baza',
      goalActivity: 'Cel i aktywność',
      gender: 'Płeć',
      age: 'Wiek',
      height: 'Wzrost, cm',
      currentWeight: 'Aktualna waga, kg',
      currentWeightHint: 'To będzie punkt startowy i pierwszy zapis wagi na dziś.',
      targetWeight: 'Docelowa waga, kg',
      goal: 'Cel',
      rate: 'Tempo, kg na tydzień',
      activity: 'Aktywność',
      macroGoals: 'Cele makro',
      macroGoalsDescription: 'Możesz zostawić automatyczne wyliczenie albo od razu wpisać własne wartości ręcznie.',
      editLater: 'Te dane można później zmienić w profilu.',
      saveAndStart: 'Zapisz i zacznij',
      currentCalculation: 'Obliczenie teraz',
      whatMatters: 'Co warto podać',
      checklist: [
        'Płeć, wiek, wzrost i aktualna waga są potrzebne do startowego wyliczenia wydatku.',
        'Cel i ogólny poziom aktywności są potrzebne do startowego wyliczenia utrzymania i deficytu.',
        'Kroki i konkretne treningi lepiej wpisywać faktycznie na głównym ekranie, a nie zgadywać średnią wartością.',
        'Jeśli chcesz całkowicie sam kontrolować makro, włącz tryb ręczny i wpisz własne liczby.',
      ],
    },
    metrics: {
      bmr: 'podstawowa przemiana materii',
      tdee: 'utrzymanie z aktywnością',
      adjustment: 'Korekta',
      adjustmentNote: 'nadwyżka lub deficyt pod cel',
      activeGoal: 'Aktywny cel',
      activeGoalNote: 'który tryb jest teraz używany',
      auto: 'auto',
      manual: 'ręczny',
    },
    today: {
      caloriesEyebrow: 'Kalorie dzisiaj',
      consumedOfGoal: (goal: string) => `z ${goal} kcal z uwzględnieniem treningu`,
      remaining: 'Zostało',
      over: 'Nadwyżka',
      dailyProgress: 'Postęp dnia',
      dailyProgressRemaining: (calories: string) => `Jeszcze ${calories} kcal do limitu z uwzględnieniem treningu`,
      dailyProgressOver: (calories: string) => `Powyżej limitu o ${calories} kcal`,
      legendConsumed: (calories: string) => `${calories} zjedzone`,
      legendBase: (calories: string) => `${calories} baza`,
      legendWorkout: (calories: string) => `+${calories} trening`,
      legendSafe: (min: string, max: string) => `safe ${min}-${max}`,
      dayLimit: (calories: string) => `${calories} limit dnia`,
      baseShort: 'Baza',
      workoutShort: 'Trening',
      safeShort: 'Safe',
      remainingShort: 'Zostało',
      workoutCreditNote: (percent: number) =>
        `Kalorie z treningu oddaję do jedzenia nie w całości, tylko mniej więcej w ${percent}%: tak jest bezpieczniej, bo zegarki i wzory często zawyżają wydatek, a część aktywności już siedzi w ogólnym poziomie aktywności.`,
      weightEyebrow: 'Waga dzisiaj',
      weightSaved: 'Zapisano',
      weightSave: 'Zapisz',
      weightSavedHint: (date: string) => `Waga za ${date} została już zapisana.`,
      weightSaveHint: 'Wagę można zapisać raz dziennie po potwierdzeniu.',
      addEyebrow: 'Dodawanie',
      addTitle: 'Dodaj jedzenie',
      namePlaceholder: 'Nazwa',
      gramsPlaceholder: 'Gramy',
      caloriesPlaceholder: 'Kalorie',
      proteinPlaceholder: 'Białko',
      fatPlaceholder: 'Tłuszcze',
      carbsPlaceholder: 'Węglowodany',
      foodPending: 'Liczę makro na podstawie opisu…',
      foodPlaceholder: '180 g kaszy gryczanej, 150 g kurczaka i sałatka',
      draftTitle: 'Szkic posiłku',
      draftCommentaryTitle: 'Jak to policzyłem',
      draftItems: (count: number) => `${count} poz.`,
      draftTargetHint: 'Możesz zmienić, do którego posiłku dodać danie, tuż przed potwierdzeniem.',
      mealsTitle: 'Posiłki',
      entriesCount: (count: number) => `${count} wpisów`,
      mealItemsCount: (count: number) => `${count} pozycji`,
      mealEmpty: 'Na razie pusto. Dodaj jedzenie ręcznie albo przez GPT.',
      activityEyebrow: 'Aktywność',
      activityTitle: 'Treningi i kroki',
      sessionsToday: 'Sesje dzisiaj',
      stepsLogged: 'Kroki zapisane',
      burnLogged: 'Wydatek zapisany',
      activityHint:
        'Najlepiej logować aktywność według faktycznego dnia: siłowy lub cardio jako jedną sesję, a kroki jako osobny wpis, kiedy masz końcową liczbę.',
      workoutTitlePlaceholder: 'Nazwa treningu',
      workoutPending: 'Analizuję aktywność i liczę wydatek…',
      workoutDraftTitle: 'Szkic treningu',
      dailyActivityTitle: 'Aktywność za dzień',
      dailyActivityCount: (count: number) => `${count} wpisów`,
      dailyActivityEmpty: 'Na razie pusto. Dodaj trening, spacer albo kroki ręcznie lub przez GPT.',
    },
    stats: {
      eyebrow: 'Analityka za okres',
      title: 'Statystyki',
      description: 'Tylko realne wpisy z dziennika: waga, kalorie i aktywność za wybrany okres.',
      ranges: { '7d': '7 dni', '30d': '30 dni', '90d': '90 dni' },
      weightGained: 'Przyrost wagi',
      weightLost: 'Spadek wagi',
      weightChanged: 'Zmiana wagi',
      toGoal: 'Do celu',
      averageCalories: 'Średnie kalorie',
      activity: 'Aktywność',
      noData: 'Brak danych',
      appearsAfterFood: 'Pojawi się po pierwszych wpisach jedzenia',
      appearsAfterWorkouts: 'Pojawi się po pierwszych treningach lub krokach',
      weight: 'Waga',
      currentWeightNow: (weight: string) => `${weight} kg teraz`,
      pointsAndChange: (count: number, change: string) => `${count} punktów · ${change} kg w okresie`,
      chartAria: 'Wykres wagi',
      periodStart: 'Początek okresu',
      current: 'Teraz',
      goal: 'Cel',
      caloriesByDay: 'Kalorie po dniach',
      adherenceTitle: (adherence: number, total: number) => `${adherence}/${total} dni w korytarzu`,
      noFoodLogs: 'Brak logów jedzenia',
      dailyLimitDelta: (delta: string) => `${delta} kcal do średniego limitu`,
      afterFirstEntries: 'Po pierwszych wpisach pojawi się dynamika dzienna',
      chartEmpty: 'Tutaj pojawi się dynamika kalorii, gdy w dzienniku będzie chociaż jeden dzień z jedzeniem.',
      inRange: 'w korytarzu',
      belowLimit: 'poniżej limitu',
      aboveLimit: 'powyżej limitu',
      limitNote: 'Limit dnia liczony jest z uwzględnieniem bonusu treningowego, tak samo jak na ekranie Today.',
      goalReached: (goalWeight: string) => `Cel ${goalWeight} kg został już osiągnięty`,
      goalProgress: (progress: number, goalWeight: string) => `${progress}% drogi zamknięte · cel ${goalWeight} kg`,
      averageCaloriesNote: (delta: string, adherence: number, total: number) =>
        `${delta} kcal do średniego limitu · ${adherence}/${total} dni w korytarzu`,
      activityNote: (entries: number, activeDays: number, rangeDays: number, averageSteps: string | null) =>
        `${entries} wpisów · ${activeDays}/${rangeDays} aktywnych dni${averageSteps ? ` · ${averageSteps} kroków średnio` : ''}`,
    },
    profile: {
      eyebrow: 'Profil i cele',
      title: 'Ustawienia',
      description: 'Baza do wyliczenia celu i dziennych makro.',
      autosave: 'zmiany zapisują się od razu',
      base: 'Baza',
      goalActivity: 'Cel i aktywność',
      currentWeightHint: 'Waga jest aktualizowana na ekranie głównym i zapisywana raz dziennie.',
      macroGoals: 'Cele makro',
      macroGoalsDescription: 'Możesz zostawić automatyczne wyliczenie albo wpisać własne wartości ręcznie.',
      currentCalculation: 'Obliczenie teraz',
      whatDataMatter: 'Jakie dane są potrzebne',
      whatDataChecklist: [
        'Obowiązkowe: płeć, wiek, wzrost, aktualna waga, cel, aktywność.',
        'Bardzo wskazane: waga docelowa i tempo zmiany wagi.',
        'Kroki i treningi wygodniej wpisywać za dzień w sekcji Dzisiaj, kiedy masz realny wynik, a nie średnią ocenę.',
        'Dla dokładności po starcie: codzienna waga i uczciwy log kalorii przez co najmniej 2-3 tygodnie.',
        'Dodatkowo: obwód talii, procent tkanki tłuszczowej i ograniczenia żywieniowe — to już opcjonalnie.',
      ],
      formulaTitle: 'Dlaczego waga jest ważniejsza niż wzór',
      formulaBody:
        'Wzór jest potrzebny tylko na start. Później dokładność daje połączenie codziennej wagi, realnych kalorii i aktywności. Jeśli przez kilka tygodni waga nie idzie tam, gdzie powinna, aplikacja może zaproponować lepszy cel niż jakikolwiek uniwersalny kalkulator.',
    },
    drafts: {
      defaultMealName: 'Posiłek',
      withWord: 'z',
      andWord: 'i',
      preparedMeal: (title: string, meal: string) => `Przygotowano „${title}” dla posiłku „${meal}”.`,
      mealAccepted: (meal: string) => `Szkic zaakceptowany. Pozycje zostały dodane do „${meal}”.`,
      localFallback: 'Serwer czatu jest niedostępny, używam lokalnego oszacowania.',
      foodCommentaryFallback: 'Policzyłem pozycje według wbudowanych wartości referencyjnych produktów.',
      foodCommentaryEstimatedWeights:
        'Część gramatur oszacowałem z kontekstu, bo nie każda pozycja miała podaną wagę.',
      foodCommentaryDryWeight: (food: string) => `Policzyłem ${food} jako suchą masę, bo wyraźnie to zaznaczyłeś.`,
      foodCommentaryCookedWeight: (food: string) =>
        `Policzyłem ${food} jako masę po przygotowaniu, bo nie było wzmianki o suchej lub surowej wadze.`,
      foodCommentaryHeavy: (calories: string, carbs: string) =>
        `Tu jest około ${calories} kcal i ${carbs} g węglowodanów. To już mniej "lekki kęs", a bardziej pełne sympozjum o węglach.`,
      workoutLogged: 'Przygotowano szkic.',
      workoutEstimated: 'Oszacowano obciążenie na podstawie opisu.',
      workoutAccepted: (date: string) => `Szkic zaakceptowany. Wpis został dodany do treningów za ${date}.`,
      assistantFood: 'Opisz jedzenie zwykłym językiem. Przygotuję szkic i dodam go po potwierdzeniu.',
      assistantWorkout: 'Opisz trening zwykłym językiem: ćwiczenia, minuty, kroki albo spalone kcal.',
      changeMealTarget: (title: string, meal: string) => `Przygotowano „${title}” dla posiłku „${meal}”.`,
    },
    workoutTitles: {
      walking: 'Kroki',
      squats: 'Przysiady',
      press: 'Wyciskanie',
      deadlift: 'Martwy ciąg',
      pullups: 'Podciąganie',
      pushups: 'Pompki',
      running: 'Bieg',
      cycling: 'Rower',
      yoga: 'Joga',
      stretching: 'Rozciąganie',
    },
  },
}

export function getCopy(locale: Locale = getActiveLocale()) {
  return appCopy[locale] ?? appCopy[defaultLocale]
}

const tabIds: AppTab[] = ['today', 'stats', 'profile']

const macroStyles: Record<
  MacroKey,
  {
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
    iconBg: 'bg-[#fff1e2]',
    iconColor: 'text-[#eb7d1a]',
    badgeBg: 'bg-[#fff3e8]',
    badgeText: 'text-[#b7691d]',
    barClass: 'bg-[#f4a340]',
    chipClass: 'bg-[#fff5ea] text-[#b7691d]',
    tintClass: 'bg-[#fffaf4] border-[#f4e2cf]',
  },
  protein: {
    iconBg: 'bg-[#eaf1ff]',
    iconColor: 'text-[#2967db]',
    badgeBg: 'bg-[#edf3ff]',
    badgeText: 'text-[#2c62c6]',
    barClass: 'bg-[#2f7de1]',
    chipClass: 'bg-[#eef4ff] text-[#2c62c6]',
    tintClass: 'bg-[#f9fbff] border-[#dce6fb]',
  },
  fat: {
    iconBg: 'bg-[#fff6df]',
    iconColor: 'text-[#b78617]',
    badgeBg: 'bg-[#fff7e7]',
    badgeText: 'text-[#9c7716]',
    barClass: 'bg-[#c8a13c]',
    chipClass: 'bg-[#fff8e8] text-[#9c7716]',
    tintClass: 'bg-[#fffdf7] border-[#f0e5c8]',
  },
  carbs: {
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

const activityLevelIds: ActivityLevel[] = ['low', 'moderate', 'high', 'athlete']

const workoutTypes: WorkoutType[] = ['strength', 'cardio', 'walking', 'mobility']

const workoutTypeStyles: Record<
  WorkoutType,
  {
    metric: WorkoutMetric
    defaultValue: number
    chipClass: string
    panelClass: string
  }
> = {
  strength: {
    metric: 'calories',
    defaultValue: 220,
    chipClass: 'bg-[#eef3ff] text-[#2c62c6]',
    panelClass: 'border-[#dce6fb] bg-[#f9fbff]',
  },
  cardio: {
    metric: 'calories',
    defaultValue: 320,
    chipClass: 'bg-[#fff3e8] text-[#b7691d]',
    panelClass: 'border-[#f4e2cf] bg-[#fffaf4]',
  },
  walking: {
    metric: 'steps',
    defaultValue: 7000,
    chipClass: 'bg-[#eaf7f0] text-[#246e52]',
    panelClass: 'border-[#dcebe2] bg-[#f8fcfa]',
  },
  mobility: {
    metric: 'calories',
    defaultValue: 90,
    chipClass: 'bg-[#eef5f2] text-[#4f6255]',
    panelClass: 'border-[#dfe7e2] bg-[#f8fbf9]',
  },
}

const localizedFoodCatalog = [
  {
    patterns: ['греч', 'buckwheat', 'гречк', 'gryk'],
    labels: { en: 'Buckwheat', ru: 'Гречка', uk: 'Гречка', pl: 'Kasza gryczana' },
    defaultGrams: 180,
    calories: 110,
    protein: 4.2,
    fat: 1.1,
    carbs: 21.3,
    dryNutrition: { calories: 343, protein: 13, fat: 3.4, carbs: 72 },
  },
  {
    patterns: ['рис', 'rice', 'ryż'],
    labels: { en: 'Rice', ru: 'Рис', uk: 'Рис', pl: 'Ryż' },
    defaultGrams: 180,
    calories: 130,
    protein: 2.7,
    fat: 0.3,
    carbs: 28,
    dryNutrition: { calories: 360, protein: 7, fat: 0.6, carbs: 80 },
  },
  {
    patterns: ['овсян', 'oat', 'овес', 'owsi'],
    labels: { en: 'Oatmeal', ru: 'Овсянка', uk: 'Вівсянка', pl: 'Owsianka' },
    defaultGrams: 80,
    calories: 360,
    protein: 13,
    fat: 6.5,
    carbs: 62,
  },
  {
    patterns: ['куриц', 'chicken', 'курка', 'kurcz'],
    labels: { en: 'Chicken breast', ru: 'Куриная грудка', uk: 'Куряча грудка', pl: 'Pierś z kurczaka' },
    defaultGrams: 160,
    calories: 165,
    protein: 31,
    fat: 3.6,
    carbs: 0,
  },
  {
    patterns: ['индейк', 'turkey', 'індич', 'indyk'],
    labels: { en: 'Turkey', ru: 'Индейка', uk: 'Індичка', pl: 'Indyk' },
    defaultGrams: 160,
    calories: 138,
    protein: 29,
    fat: 2,
    carbs: 0,
  },
  {
    patterns: ['лосос', 'salmon', 'лосось', 'łosos'],
    labels: { en: 'Salmon', ru: 'Лосось', uk: 'Лосось', pl: 'Łosoś' },
    defaultGrams: 160,
    calories: 208,
    protein: 20,
    fat: 13,
    carbs: 0,
  },
  {
    patterns: ['творог', 'cottage', 'curd', 'twar', 'сир'],
    labels: { en: 'Cottage cheese 5%', ru: 'Творог 5%', uk: 'Сир 5%', pl: 'Twaróg 5%' },
    defaultGrams: 180,
    calories: 145,
    protein: 17,
    fat: 5,
    carbs: 3,
  },
  {
    patterns: ['йогурт', 'yogurt', 'yoghurt', 'jogurt'],
    labels: { en: 'Greek yogurt', ru: 'Греческий йогурт', uk: 'Грецький йогурт', pl: 'Jogurt grecki' },
    defaultGrams: 180,
    calories: 68,
    protein: 10,
    fat: 2,
    carbs: 4,
  },
  {
    patterns: ['банан', 'banana', 'banan'],
    labels: { en: 'Banana', ru: 'Банан', uk: 'Банан', pl: 'Banan' },
    defaultGrams: 120,
    calories: 89,
    protein: 1.1,
    fat: 0.3,
    carbs: 23,
  },
  {
    patterns: ['яйц', 'egg', 'яйце', 'jaj'],
    labels: { en: 'Eggs', ru: 'Яйца', uk: 'Яйця', pl: 'Jajka' },
    defaultGrams: 120,
    calories: 155,
    protein: 13,
    fat: 11,
    carbs: 1.1,
  },
  {
    patterns: ['салат', 'salad', 'салат'],
    labels: { en: 'Vegetable salad', ru: 'Овощной салат', uk: 'Овочевий салат', pl: 'Sałatka warzywna' },
    defaultGrams: 150,
    calories: 65,
    protein: 2,
    fat: 4,
    carbs: 6,
  },
  {
    patterns: ['овощ', 'vegetable', 'овоч', 'warzyw'],
    labels: { en: 'Vegetables', ru: 'Овощи', uk: 'Овочі', pl: 'Warzywa' },
    defaultGrams: 180,
    calories: 35,
    protein: 2,
    fat: 0.4,
    carbs: 6,
  },
  {
    patterns: ['яблок', 'apple', 'яблук', 'jabł'],
    labels: { en: 'Apple', ru: 'Яблоко', uk: 'Яблуко', pl: 'Jabłko' },
    defaultGrams: 150,
    calories: 52,
    protein: 0.3,
    fat: 0.2,
    carbs: 14,
  },
  {
    patterns: ['миндал', 'almond', 'мигдал', 'migda'],
    labels: { en: 'Almonds', ru: 'Миндаль', uk: 'Мигдаль', pl: 'Migdały' },
    defaultGrams: 25,
    calories: 579,
    protein: 21,
    fat: 50,
    carbs: 22,
  },
  {
    patterns: ['протеин', 'protein shake', 'shake', 'шейк', 'koktajl'],
    labels: { en: 'Protein shake', ru: 'Протеиновый шейк', uk: 'Протеїновий шейк', pl: 'Shake proteinowy' },
    defaultGrams: 35,
    calories: 390,
    protein: 74,
    fat: 6,
    carbs: 10,
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

function getTabs(locale: Locale = getActiveLocale()) {
  const tabs = getCopy(locale).tabs

  return tabIds.map((id) => ({
    id,
    label: tabs[id].label,
    note: tabs[id].note,
  }))
}

function getMacroMeta(locale: Locale = getActiveLocale()) {
  const copy = getCopy(locale)

  return {
    calories: { ...macroStyles.calories, label: copy.macros.calories },
    protein: { ...macroStyles.protein, label: copy.macros.protein },
    fat: { ...macroStyles.fat, label: copy.macros.fat },
    carbs: { ...macroStyles.carbs, label: copy.macros.carbs },
  }
}

function getActivityOptions(locale: Locale = getActiveLocale()) {
  const activityOptions = getCopy(locale).activityOptions

  return activityLevelIds.map((value) => ({
    value,
    label: activityOptions[value].label,
    note: activityOptions[value].note,
  }))
}

function getWorkoutTypeMeta(locale: Locale = getActiveLocale()) {
  const workoutCopy = getCopy(locale).workoutTypes

  return {
    strength: {
      ...workoutTypeStyles.strength,
      label: workoutCopy.strength.label,
      note: workoutCopy.strength.note,
      inputLabel: workoutCopy.strength.inputLabel,
      inputPlaceholder: workoutCopy.strength.inputPlaceholder,
      chatPlaceholder: workoutCopy.strength.chatPlaceholder,
    },
    cardio: {
      ...workoutTypeStyles.cardio,
      label: workoutCopy.cardio.label,
      note: workoutCopy.cardio.note,
      inputLabel: workoutCopy.cardio.inputLabel,
      inputPlaceholder: workoutCopy.cardio.inputPlaceholder,
      chatPlaceholder: workoutCopy.cardio.chatPlaceholder,
    },
    walking: {
      ...workoutTypeStyles.walking,
      label: workoutCopy.walking.label,
      note: workoutCopy.walking.note,
      inputLabel: workoutCopy.walking.inputLabel,
      inputPlaceholder: workoutCopy.walking.inputPlaceholder,
      chatPlaceholder: workoutCopy.walking.chatPlaceholder,
    },
    mobility: {
      ...workoutTypeStyles.mobility,
      label: workoutCopy.mobility.label,
      note: workoutCopy.mobility.note,
      inputLabel: workoutCopy.mobility.inputLabel,
      inputPlaceholder: workoutCopy.mobility.inputPlaceholder,
      chatPlaceholder: workoutCopy.mobility.chatPlaceholder,
    },
  }
}

function getFoodCatalog(locale: Locale = getActiveLocale()): FoodCatalogEntry[] {
  return localizedFoodCatalog.map(({ labels, ...item }) => ({
    ...item,
    label: labels[locale],
  }))
}

function getInitialMeals(locale: Locale = getActiveLocale()): Meal[] {
  const meals = getCopy(locale).meals

  return [
    {
      id: 'breakfast',
      title: meals.breakfast.title,
      time: meals.breakfast.time,
      note: meals.breakfast.note,
      items: [],
    },
    {
      id: 'lunch',
      title: meals.lunch.title,
      time: meals.lunch.time,
      note: meals.lunch.note,
      items: [],
    },
    {
      id: 'dinner',
      title: meals.dinner.title,
      time: meals.dinner.time,
      note: meals.dinner.note,
      items: [],
    },
    {
      id: 'snacks',
      title: meals.snacks.title,
      time: meals.snacks.time,
      note: meals.snacks.note,
      items: [],
    },
  ]
}

function getMealLabel(mealId: string, locale: Locale = getActiveLocale()) {
  const meals = getCopy(locale).meals as Record<string, { title: string }>

  return meals[mealId]?.title ?? mealId
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
  return getInitialMeals().map((meal) => ({
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
  const copy = getCopy()
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: string }).code)
      : ''

  switch (code) {
    case 'permission-denied':
      return copy.errors.firebasePermission
    case 'failed-precondition':
      return copy.errors.firestorePrecondition
    case 'unavailable':
      return copy.errors.firebaseUnavailable
    case 'auth/unauthorized-domain':
      return copy.errors.unauthorizedDomain
    case 'auth/popup-closed-by-user':
      return copy.errors.popupClosed
    case 'auth/network-request-failed':
      return copy.errors.networkFailed
    default:
      return code ? `${fallback} (${code})` : fallback
  }
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
  return getWorkoutTypeMeta()[type].metric
}

function formatWorkoutValue(entry: WorkoutEntry) {
  const copy = getCopy()

  return entry.metric === 'steps'
    ? `${formatNumber(entry.value)} ${copy.units.steps}`
    : `${formatNumber(entry.value)} ${copy.units.kcal}`
}

function formatWorkoutCalories(entry: WorkoutEntry) {
  return `~${formatNumber(entry.estimatedCalories)} ${getCopy().units.kcal}`
}

function getSourceLabel(source: EntrySource) {
  return getCopy().sources[source]
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
  const copy = getCopy()
  const cleanedNames = names.map((name) => name.trim()).filter(Boolean)

  if (cleanedNames.length === 0) {
    return copy.drafts.defaultMealName
  }

  if (cleanedNames.length === 1) {
    return cleanedNames[0]
  }

  if (cleanedNames.length === 2) {
    return `${cleanedNames[0]} ${copy.drafts.withWord} ${cleanedNames[1].toLowerCase()}`
  }

  const [first, second, ...rest] = cleanedNames
  const tail = [second.toLowerCase(), ...rest.map((item) => item.toLowerCase())]

  return `${first} ${copy.drafts.withWord} ${tail.slice(0, -1).join(', ')} ${copy.drafts.andWord} ${tail[tail.length - 1]}`
}

function detectWorkoutType(prompt: string, fallback: WorkoutType): WorkoutType {
  if (/(шаг|ходьб|прогул|пешк|step|walk|крок|ходьб|прогуля|spacer)/i.test(prompt)) {
    return 'walking'
  }

  if (/(йог|растяж|мобил|recovery|yoga|stretch|mobility|розтяж|joga|rozciąg)/i.test(prompt)) {
    return 'mobility'
  }

  if (/(бег|кардио|дорожк|вел|эллипс|интервал|спринт|run|cardio|treadmill|bike|interval|sprint|біг|доріж|rower|bieg|bież)/i.test(prompt)) {
    return 'cardio'
  }

  if (/(присед|жим|тяга|подтяг|отжим|гантел|штанг|подход|сет|повтор|squat|press|deadlift|pull-?up|push-?up|dumbbell|barbell|rep|set|присід|підтяг|гантел|штанг|підхід|powtór|przysiad|wycisk|martwy|pompk|seri)/i.test(prompt)) {
    return 'strength'
  }

  return fallback
}

function buildWorkoutTitle(prompt: string, type: WorkoutType) {
  const copy = getCopy()

  if (type === 'walking') {
    return copy.workoutTitles.walking
  }

  if (/(присед|присід|squat|przysiad)/i.test(prompt)) {
    return copy.workoutTitles.squats
  }

  if (/(жим|wycisk|press)/i.test(prompt)) {
    return copy.workoutTitles.press
  }

  if (/(тяга|deadlift|martwy)/i.test(prompt)) {
    return copy.workoutTitles.deadlift
  }

  if (/(подтяг|підтяг|pull-?up|podciąg)/i.test(prompt)) {
    return copy.workoutTitles.pullups
  }

  if (/(отжим|віджим|push-?up|pompk)/i.test(prompt)) {
    return copy.workoutTitles.pushups
  }

  if (/(бег|біг|run|bieg|dорожк|doróżk|bież)/i.test(prompt)) {
    return copy.workoutTitles.running
  }

  if (/(вел|bike|cycling|rower)/i.test(prompt)) {
    return copy.workoutTitles.cycling
  }

  if (/(йог|yoga|joga)/i.test(prompt)) {
    return copy.workoutTitles.yoga
  }

  if (/(растяж|rozciąg|stretch|mobi|розтяж)/i.test(prompt)) {
    return copy.workoutTitles.stretching
  }

  return getWorkoutTypeMeta()[type].label
}

function buildWorkoutDraftFromPrompt(
  prompt: string,
  fallbackType: WorkoutType,
  currentWeight: number,
): WorkoutDraft | null {
  const copy = getCopy()
  const workoutTypeMeta = getWorkoutTypeMeta()
  const cleanedPrompt = prompt.trim().toLowerCase().replace(/[.!?]/g, '')

  if (!cleanedPrompt) {
    return null
  }

  const type = detectWorkoutType(cleanedPrompt, fallbackType)
  const metric = getWorkoutMetric(type)
  const stepsMatch = cleanedPrompt.match(/(\d[\d\s]{2,})\s*(?:шаг|крок|step|krok)/i)
  const caloriesMatch = cleanedPrompt.match(/(\d+)\s*(?:ккал|кал|kcal)/i)
  const repsMatch = cleanedPrompt.match(/(\d+)\s*(?:раз(?:а)?|повтор\w*|rep\w*|powtór\w*|повт\w*)/i)
  const setsMatch = cleanedPrompt.match(/(\d+)\s*(?:подход\w*|сет\w*|set\w*|seri\w*|підхід\w*)/i)
  const minutesMatch = cleanedPrompt.match(/(\d+)\s*(?:мин|минут\w*|хв|хвил\w*|min(?:ut)?\w*)/i)

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
  const summaryPrefix = caloriesMatch || stepsMatch ? copy.drafts.workoutLogged : copy.drafts.workoutEstimated
  const estimatedCalories = metric === 'steps' ? estimateCaloriesFromSteps(value, currentWeight) : value
  const valueText = metric === 'steps' ? `${formatNumber(value)} ${copy.units.steps}` : `${formatNumber(value)} ${copy.units.kcal}`

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
    summary: `${summaryPrefix} «${title}» · ${valueText} · ~${formatNumber(estimatedCalories)} ${copy.units.kcal}.`,
  }
}

function isDryWeightSegment(segment: string) {
  return /(?:^|\s)(?:dry|raw|сух\S*|such\S*)(?:\s|$)/i.test(segment)
}

function buildFoodDraftCommentary(
  items: Array<{
    name: string
    estimatedGrams: boolean
    usedDryWeight: boolean
    usedCookedWeight: boolean
  }>,
  totals: NutritionTotals,
) {
  const copy = getCopy()
  const parts = [copy.drafts.foodCommentaryFallback]

  if (items.some((item) => item.estimatedGrams)) {
    parts.push(copy.drafts.foodCommentaryEstimatedWeights)
  }

  const dryWeightItem = items.find((item) => item.usedDryWeight)

  if (dryWeightItem) {
    parts.push(copy.drafts.foodCommentaryDryWeight(dryWeightItem.name))
  } else {
    const cookedWeightItem = items.find((item) => item.usedCookedWeight)

    if (cookedWeightItem) {
      parts.push(copy.drafts.foodCommentaryCookedWeight(cookedWeightItem.name))
    }
  }

  if (totals.calories >= 1200 || totals.carbs >= 140) {
    parts.push(copy.drafts.foodCommentaryHeavy(formatNumber(totals.calories), formatNumber(totals.carbs)))
  }

  return parts.join(' ')
}

function buildDraftFromPrompt(prompt: string, mealId: string): ChatDraft | null {
  const copy = getCopy()
  const foodCatalog = getFoodCatalog()
  const cleanedPrompt = prompt.trim().toLowerCase().replace(/[.!?]/g, '')

  if (!cleanedPrompt) {
    return null
  }

  const segments = cleanedPrompt
    .split(/,|;|\s+(?:and|и|та|i|oraz)\s+/i)
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (!segments.length) {
    return null
  }

  const parsedSegments = segments.map((segment) => {
    const gramsMatch = segment.match(/(\d+)\s*(?:г(?:рамм|р)?|гр|g|gram\w*)/i)
    const matchedFood = foodCatalog.find((food) => food.patterns.some((pattern) => segment.includes(pattern)))
    const grams = gramsMatch ? Number(gramsMatch[1]) : matchedFood?.defaultGrams ?? 150
    const estimatedGrams = !gramsMatch
    const usedDryWeight = Boolean(matchedFood?.dryNutrition) && isDryWeightSegment(segment)

    if (!matchedFood) {
      const genericName =
        capitalize(segment.replace(/\d+\s*(?:г(?:рамм|р)?|гр|g|gram\w*)/gi, '').trim()) || copy.drafts.defaultMealName

      return {
        item: {
          id: createId('gpt'),
          name: genericName,
          grams,
          calories: roundMacro(grams * 0.95),
          protein: roundMacro(grams * 0.06),
          fat: roundMacro(grams * 0.03),
          carbs: roundMacro(grams * 0.1),
          source: 'gpt' as const,
        },
        commentary: {
          name: genericName,
          estimatedGrams,
          usedDryWeight: false,
          usedCookedWeight: false,
        },
      }
    }

    const nutritionBase = usedDryWeight && matchedFood.dryNutrition ? matchedFood.dryNutrition : matchedFood

    return {
      item: {
        id: createId('gpt'),
        name: matchedFood.label,
        grams,
        calories: roundMacro((nutritionBase.calories * grams) / 100),
        protein: roundMacro((nutritionBase.protein * grams) / 100),
        fat: roundMacro((nutritionBase.fat * grams) / 100),
        carbs: roundMacro((nutritionBase.carbs * grams) / 100),
        source: 'gpt' as const,
      },
      commentary: {
        name: matchedFood.label,
        estimatedGrams,
        usedDryWeight,
        usedCookedWeight: Boolean(matchedFood.dryNutrition) && !usedDryWeight,
      },
    }
  })

  const items = parsedSegments.map(({ item }) => item)

  const totals = sumEntries(items)
  const title = buildFoodDraftTitle(items.map((item) => item.name))

  return {
    mealId,
    title,
    totals,
    items,
    summary: copy.drafts.preparedMeal(title, getMealLabel(mealId)),
    commentary: buildFoodDraftCommentary(parsedSegments.map(({ commentary }) => commentary), totals),
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
  const meta = getMacroMeta()[macro]

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
  const meta = getMacroMeta()[macro]
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
  const [locale, setLocale] = useState<Locale>(() => readStoredLocale())
  setActiveLocale(locale)

  const copy = getCopy(locale)
  const tabs = getTabs(locale)
  const activityOptions = getActivityOptions(locale)
  const workoutTypeMeta = getWorkoutTypeMeta(locale)
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
    window.localStorage.setItem(localeStorageKey, locale)
    document.documentElement.lang = locale
  }, [locale])

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
            setCloudError(getFirebaseErrorMessage(error, copy.errors.firebaseLoad))
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
          setCloudError(getFirebaseErrorMessage(error, copy.errors.googleRedirect))
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
  }, [locale, profile.currentWeight])

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
          setCloudError(getFirebaseErrorMessage(error, copy.errors.firebaseSave))
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
    profile.goalType === 'bulk'
      ? copy.stats.weightGained
      : profile.goalType === 'cut'
        ? copy.stats.weightLost
        : copy.stats.weightChanged
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
  const headerTabLabel = onboardingRequired ? copy.onboarding.eyebrow : activeTabInfo.label
  const latestAssistantMessage =
    chatMessages[chatMessages.length - 1]?.text ?? copy.drafts.assistantFood
  const latestWorkoutAssistantMessage =
    workoutChatMessages[workoutChatMessages.length - 1]?.text ?? copy.drafts.assistantWorkout
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
      label: copy.sync.local,
      className: 'bg-[#eef4ef] text-[#4b6254]',
    },
    idle: {
      label: copy.sync.idle,
      className: 'bg-[#f3f5f4] text-[#63736a]',
    },
    loading: {
      label: copy.sync.loading,
      className: 'bg-[#eef3ff] text-[#355da7]',
    },
    saving: {
      label: copy.sync.saving,
      className: 'bg-[#fff4e7] text-[#b4721b]',
    },
    saved: {
      label: copy.sync.saved,
      className: 'bg-[#eaf7f0] text-[#246e52]',
    },
    error: {
      label: copy.sync.error,
      className: 'bg-[#fdeceb] text-[#b44a46]',
    },
  }
  const currentSyncMeta = syncMeta[syncStatus]
  const userName = user?.displayName || user?.email || copy.menu.googleUser

  const handleGoogleLogin = async () => {
    try {
      setCloudError(null)
      setIsMenuOpen(false)
      await signInWithGoogle()
    } catch (error) {
      setCloudError(getFirebaseErrorMessage(error, copy.errors.googleLogin))
    }
  }

  const handleLogout = async () => {
    try {
      setCloudError(null)
      setIsMenuOpen(false)
      await signOutCurrentUser()
    } catch (error) {
      setCloudError(getFirebaseErrorMessage(error, copy.errors.googleLogout))
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
            summary: copy.drafts.changeMealTarget(currentDraft.title, getMealLabel(nextMealId, locale)),
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
          summary: parsed.summary || copy.drafts.preparedMeal(parsed.title, getMealLabel(chatMealId, locale)),
          commentary: parsed.commentary || copy.drafts.foodCommentaryFallback,
        }
      } catch {
        const fallbackDraft = buildDraftFromPrompt(prompt, chatMealId)

        if (fallbackDraft) {
          draft = {
            ...fallbackDraft,
            summary: `${fallbackDraft.summary} ${copy.drafts.localFallback}`,
          }
        }
      }

      if (!draft) {
        return
      }

      setChatMessages((currentMessages) => [
        ...currentMessages,
        { id: createId('user'), role: 'user', text: prompt },
        { id: createId('assistant'), role: 'assistant', text: `${draft.summary} ${draft.commentary}` },
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
            summary: `${fallbackDraft.summary} ${copy.drafts.localFallback}`,
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
        text: copy.drafts.mealAccepted(getMealLabel(chatDraft.mealId, locale)),
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
        text: copy.drafts.workoutAccepted(formatShortDate(currentDate)),
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
            {copy.setupBanner.title}
          </p>
          <p className="mt-2 text-sm leading-6 text-[#6d5a3f] sm:text-base">
            {copy.setupBanner.description}
          </p>
        </div>

        <span className="rounded-full bg-[#fff2df] px-4 py-2 text-sm font-semibold text-[#9d6a22]">
          {copy.setupBanner.badge}
        </span>
      </div>
    </Surface>
  )

  const renderAuthGate = () => (
    <div className="mx-auto max-w-lg py-10 sm:py-16">
      <Surface className="border-[#dde7df] bg-white text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#73857a]">
          {copy.authGate.eyebrow}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[#121914] sm:text-4xl">
          {copy.authGate.title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-[#64746a] sm:text-base">
          {copy.authGate.description}
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
          {copy.authGate.button}
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
          {copy.authLoading.eyebrow}
        </p>
        <p className="mt-3 text-base text-[#56665d]">{copy.authLoading.description}</p>
        {authLoadSlow ? (
          <p className="mt-3 text-sm leading-6 text-[#6c7b72]">
            {copy.authLoading.slowHint}
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#73857a]">{copy.modals.eyebrow}</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-[#121914] sm:text-3xl">
            {copy.modals.saveWeightTitle}
          </h2>
          <p className="mt-3 text-sm leading-6 text-[#617165] sm:text-base">
            {copy.modals.saveWeightDescription(formatShortDate(currentDate), formatWeight(pendingWeightConfirmation))}
          </p>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setPendingWeightConfirmation(null)}
              className="h-11 rounded-2xl border border-[#d5e2d9] bg-white px-4 text-sm font-semibold text-[#385244] transition hover:bg-[#f5faf7]"
            >
              {copy.common.cancel}
            </button>
            <button
              type="button"
              onClick={handleConfirmWeightSave}
              className="h-11 rounded-2xl bg-[#1b5a3d] px-4 text-sm font-semibold text-white transition hover:bg-[#256b49]"
            >
              {copy.common.confirm}
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#73857a]">{copy.modals.eyebrow}</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-[#121914] sm:text-3xl">
            {copy.modals.deleteMealTitle}
          </h2>
          <p className="mt-3 text-sm leading-6 text-[#617165] sm:text-base">
            {copy.modals.deleteMealDescription(pendingMealDeletion.entryName)}
          </p>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setPendingMealDeletion(null)}
              className="h-11 rounded-2xl border border-[#d5e2d9] bg-white px-4 text-sm font-semibold text-[#385244] transition hover:bg-[#f5faf7]"
            >
              {copy.common.cancel}
            </button>
            <button
              type="button"
              onClick={handleConfirmMealEntryDeletion}
              className="h-11 rounded-2xl bg-[#b44a46] px-4 text-sm font-semibold text-white transition hover:bg-[#9e3f3b]"
            >
              {copy.common.delete}
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#73857a]">{copy.modals.eyebrow}</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-[#121914] sm:text-3xl">
            {copy.modals.deleteWorkoutTitle}
          </h2>
          <p className="mt-3 text-sm leading-6 text-[#617165] sm:text-base">
            {copy.modals.deleteWorkoutDescription(pendingWorkoutDeletion.entryName)}
          </p>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setPendingWorkoutDeletion(null)}
              className="h-11 rounded-2xl border border-[#d5e2d9] bg-white px-4 text-sm font-semibold text-[#385244] transition hover:bg-[#f5faf7]"
            >
              {copy.common.cancel}
            </button>
            <button
              type="button"
              onClick={handleConfirmWorkoutDeletion}
              className="h-11 rounded-2xl bg-[#b44a46] px-4 text-sm font-semibold text-white transition hover:bg-[#9e3f3b]"
            >
              {copy.common.delete}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const renderOnboarding = () => (
    <div className="mx-auto max-w-5xl space-y-6 py-2">
      <Surface>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#73857a]">{copy.onboarding.eyebrow}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[#121914] sm:text-4xl">
          {copy.onboarding.title}
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#64746a] sm:text-base">
          {copy.onboarding.description}
        </p>
      </Surface>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Surface>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">{copy.onboarding.base}</p>
              <div className="mt-4 grid gap-3">
                <FieldGroup label={copy.onboarding.gender}>
                  <select
                    value={profile.gender}
                    onChange={(event) => updateProfile('gender', event.target.value as Gender)}
                    className={formFieldClassName}
                  >
                    <option value="male">{copy.genders.male}</option>
                    <option value="female">{copy.genders.female}</option>
                  </select>
                </FieldGroup>

                <FieldGroup label={copy.onboarding.age}>
                  <input
                    value={profile.age}
                    onChange={(event) => updateProfile('age', Number(event.target.value))}
                    type="number"
                    placeholder="29"
                    className={formFieldClassName}
                  />
                </FieldGroup>

                <FieldGroup label={copy.onboarding.height}>
                  <input
                    value={profile.height}
                    onChange={(event) => updateProfile('height', Number(event.target.value))}
                    type="number"
                    placeholder="180"
                    className={formFieldClassName}
                  />
                </FieldGroup>

                <FieldGroup label={copy.onboarding.currentWeight} hint={copy.onboarding.currentWeightHint}>
                  <input
                    value={profile.currentWeight}
                    onChange={(event) => updateProfile('currentWeight', Number(event.target.value))}
                    type="number"
                    step="0.1"
                    placeholder="78.1"
                    className={formFieldClassName}
                  />
                </FieldGroup>

                <FieldGroup label={copy.onboarding.targetWeight}>
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
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">{copy.onboarding.goalActivity}</p>
              <div className="mt-4 grid gap-3">
                <FieldGroup label={copy.onboarding.goal}>
                  <select
                    value={profile.goalType}
                    onChange={(event) => updateProfile('goalType', event.target.value as GoalType)}
                    className={formFieldClassName}
                  >
                    <option value="cut">{copy.goals.cut}</option>
                    <option value="maintain">{copy.goals.maintain}</option>
                    <option value="bulk">{copy.goals.bulk}</option>
                  </select>
                </FieldGroup>

                <FieldGroup label={copy.onboarding.rate}>
                  <input
                    value={profile.weeklyRate}
                    onChange={(event) => updateProfile('weeklyRate', Number(event.target.value))}
                    type="number"
                    step="0.1"
                    placeholder="0.4"
                    className={formFieldClassName}
                  />
                </FieldGroup>

                <FieldGroup label={copy.onboarding.activity}>
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
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">{copy.onboarding.macroGoals}</p>
                <p className="mt-2 text-sm leading-6 text-[#617165]">
                  {copy.onboarding.macroGoalsDescription}
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
                  {copy.goalModes.auto}
                </button>
                <button
                  type="button"
                  onClick={() => updateProfile('goalMode', 'manual')}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    profile.goalMode === 'manual' ? 'bg-[#19563a] text-white' : 'text-[#4f6255]'
                  }`}
                >
                  {copy.goalModes.manual}
                </button>
              </div>
            </div>

            {profile.goalMode === 'manual' ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <FieldGroup label={copy.macros.calories}>
                  <input
                    value={profile.manualCalories}
                    onChange={(event) => updateProfile('manualCalories', Number(event.target.value))}
                    type="number"
                    placeholder="2100"
                    className={formFieldWhiteClassName}
                  />
                </FieldGroup>
                <FieldGroup label={`${copy.macros.protein}, ${copy.units.grams}`}>
                  <input
                    value={profile.manualProtein}
                    onChange={(event) => updateProfile('manualProtein', Number(event.target.value))}
                    type="number"
                    placeholder="150"
                    className={formFieldWhiteClassName}
                  />
                </FieldGroup>
                <FieldGroup label={`${copy.macros.fat}, ${copy.units.grams}`}>
                  <input
                    value={profile.manualFat}
                    onChange={(event) => updateProfile('manualFat', Number(event.target.value))}
                    type="number"
                    placeholder="68"
                    className={formFieldWhiteClassName}
                  />
                </FieldGroup>
                <FieldGroup label={`${copy.macros.carbs}, ${copy.units.grams}`}>
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
                <MetricCard label={copy.macros.calories} value={`${targets.recommended.calories}`} note={copy.common.recommendation} />
                <MetricCard label={copy.macros.protein} value={`${targets.recommended.protein} ${copy.units.grams}`} note={copy.common.perDay} />
                <MetricCard label={copy.macros.fat} value={`${targets.recommended.fat} ${copy.units.grams}`} note={copy.common.perDay} />
                <MetricCard label={copy.macros.carbs} value={`${targets.recommended.carbs} ${copy.units.grams}`} note={copy.common.perDay} />
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-[#617165]">{copy.onboarding.editLater}</p>
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
              {copy.onboarding.saveAndStart}
            </button>
          </div>
        </Surface>

        <div className="space-y-6">
          <Surface className="bg-[linear-gradient(180deg,#f7fbf8_0%,#f1f7f3_100%)]">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">{copy.onboarding.currentCalculation}</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[#102018]">
              {formatNumber(targets.active.calories)} {copy.units.kcal} {copy.common.perDay}
            </h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <MetricCard label="BMR" value={`${targets.bmr}`} note={copy.metrics.bmr} />
              <MetricCard label="TDEE" value={`${targets.tdee}`} note={copy.metrics.tdee} />
              <MetricCard
                label={copy.metrics.adjustment}
                value={`${targets.adjustment > 0 ? '+' : ''}${targets.adjustment}`}
                note={copy.metrics.adjustmentNote}
              />
              <MetricCard
                label={copy.metrics.activeGoal}
                value={profile.goalMode === 'auto' ? copy.metrics.auto : copy.metrics.manual}
                note={copy.metrics.activeGoalNote}
              />
            </div>
          </Surface>

          <Surface>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">{copy.onboarding.whatMatters}</p>
            <div className="mt-4 space-y-3 text-sm leading-6 text-[#617165]">
              {copy.onboarding.checklist.map((item) => (
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
                {copy.today.caloriesEyebrow}
              </p>

              <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h1 className="text-[2.8rem] font-semibold tracking-[-0.08em] text-[#121914] sm:text-[3.8rem]">
                    {formatNumber(dayTotals.calories)}
                  </h1>
                  <p className="text-sm text-[#68786d]">{copy.today.consumedOfGoal(formatNumber(caloriePlan.effectiveGoalCalories))}</p>
                </div>

                <span
                  className={`inline-flex rounded-full px-4 py-2 text-sm font-semibold ${
                    caloriesLeft >= 0 ? 'bg-[#eef5f0] text-[#2d6650]' : 'bg-[#fff1ec] text-[#b44a46]'
                  }`}
                >
                  {caloriesLeft >= 0 ? copy.today.remaining : copy.today.over} {formatNumber(remainingCalories)} {copy.units.kcal}
                </span>
              </div>
            </div>

            <div className="mt-5 rounded-[22px] border border-[#e6ece7] bg-[#f9fbf9] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[#18211b]">{copy.today.dailyProgress}</p>
                  <p className="mt-1 text-sm text-[#68786d]">
                    {caloriesLeft >= 0
                      ? copy.today.dailyProgressRemaining(formatNumber(remainingCalories))
                      : copy.today.dailyProgressOver(formatNumber(remainingCalories))}
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
                  {copy.today.legendConsumed(formatNumber(dayTotals.calories))}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5">
                  <span className="size-2 rounded-full bg-[#8ea494]" />
                  {copy.today.legendBase(formatNumber(targets.active.calories))}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5">
                  <span className="size-2 rounded-full bg-[#78bb93]" />
                  {copy.today.legendWorkout(formatNumber(caloriePlan.workoutCredit))}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5">
                  <span className="size-2 rounded-full border border-[#5d9c75] bg-[#e6f5ec]" />
                  {copy.today.legendSafe(formatNumber(caloriePlan.safeZoneMin), formatNumber(caloriePlan.safeZoneMax))}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7b8a80] sm:text-xs">
                <span>{copy.today.legendConsumed(formatNumber(dayTotals.calories))}</span>
                <span>{copy.today.dayLimit(formatNumber(caloriePlan.effectiveGoalCalories))}</span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                <div className="rounded-[16px] border border-[#e5ece7] bg-white px-3 py-2.5 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7b8a80]">{copy.today.baseShort}</p>
                  <p className="mt-1 text-base font-semibold text-[#121914]">{formatNumber(targets.active.calories)}</p>
                </div>
                <div className="rounded-[16px] border border-[#e5ece7] bg-white px-3 py-2.5 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7b8a80]">{copy.today.workoutShort}</p>
                  <p className="mt-1 text-base font-semibold text-[#1c6b47]">+{formatNumber(caloriePlan.workoutCredit)}</p>
                </div>
                <div className="rounded-[16px] border border-[#e5ece7] bg-white px-3 py-2.5 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7b8a80]">{copy.today.safeShort}</p>
                  <p className="mt-1 text-base font-semibold text-[#121914]">
                    {formatNumber(caloriePlan.safeZoneMin)}-{formatNumber(caloriePlan.safeZoneMax)}
                  </p>
                </div>
                <div className="hidden rounded-[16px] border border-[#e5ece7] bg-white px-3 py-2.5 text-center sm:block">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7b8a80]">{copy.today.remainingShort}</p>
                  <p className="mt-1 text-base font-semibold text-[#121914]">{formatNumber(remainingCalories)}</p>
                </div>
              </div>

              <p className="mt-3 text-xs leading-5 text-[#708276] sm:text-sm">
                {copy.today.workoutCreditNote(Math.round(caloriePlan.workoutCreditRatio * 100))}
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
                    {copy.today.weightEyebrow}
                  </p>
                  <p className="mt-2 text-3xl font-semibold tracking-[-0.06em] text-[#121914]">
                    {formatWeight(profile.currentWeight)} {copy.units.kg}
                  </p>
                </div>

                <span className="rounded-full bg-[#eef5f0] px-3 py-2 text-xs font-semibold text-[#2d6650]">
                  {weightDelta < 0 ? '-' : '+'}{formatWeight(Math.abs(weightDelta))} {copy.units.kg}
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
                  {hasLoggedWeightToday ? copy.today.weightSaved : copy.today.weightSave}
                </button>
              </div>

              <p className="mt-3 text-xs leading-5 text-[#708276] sm:text-sm">
                {hasLoggedWeightToday
                  ? copy.today.weightSavedHint(formatShortDate(currentDate))
                  : copy.today.weightSaveHint}
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
              {copy.today.addEyebrow}
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-[#102018] sm:text-[2rem]">
              {copy.today.addTitle}
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
                  {getMealLabel(meal.id, locale)}
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
                {copy.common.manual}
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
              placeholder={copy.today.namePlaceholder}
              className="h-11 rounded-2xl border border-[#d5e2d9] bg-[#fbfdfb] px-4 text-sm text-[#102018] outline-none transition focus:border-[#4d9469]"
            />
            <input
              value={manualForm.grams}
              onChange={(event) => setManualForm((currentForm) => ({ ...currentForm, grams: event.target.value }))}
              type="number"
              placeholder={copy.today.gramsPlaceholder}
              className="h-11 rounded-2xl border border-[#d5e2d9] bg-[#fbfdfb] px-4 text-sm text-[#102018] outline-none transition focus:border-[#4d9469]"
            />
            <input
              value={manualForm.calories}
              onChange={(event) => setManualForm((currentForm) => ({ ...currentForm, calories: event.target.value }))}
              type="number"
              placeholder={copy.today.caloriesPlaceholder}
              className="h-11 rounded-2xl border border-[#d5e2d9] bg-[#fbfdfb] px-4 text-sm text-[#102018] outline-none transition focus:border-[#4d9469]"
            />

            <div className="sm:col-span-2 xl:col-span-1">
              <div className="flex h-11 items-center rounded-2xl border border-[#d5e2d9] bg-[#fbfdfb] px-4 text-sm text-[#5d6e62]">
                <MacroIcon macro="protein" className="mr-2 h-4 w-4 text-[#2967db]" />
                <input
                  value={manualForm.protein}
                  onChange={(event) => setManualForm((currentForm) => ({ ...currentForm, protein: event.target.value }))}
                  type="number"
                  placeholder={copy.today.proteinPlaceholder}
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
                  placeholder={copy.today.fatPlaceholder}
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
                  placeholder={copy.today.carbsPlaceholder}
                  className="w-full bg-transparent text-[#102018] outline-none"
                />
              </div>
            </div>
            <button
              type="submit"
              className="h-11 rounded-2xl bg-[#102018] px-5 text-sm font-semibold text-white transition hover:bg-[#1d3126] sm:col-span-2 xl:col-span-1"
            >
              {copy.common.add}
            </button>
          </form>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-[#66776b]">
              {foodChatPending ? copy.today.foodPending : chatDraft ? chatDraft.summary : latestAssistantMessage}
            </p>

            <form onSubmit={handleGenerateDraft} className="grid gap-3 xl:grid-cols-[1fr_auto]">
              <textarea
                value={chatPrompt}
                onChange={(event) => setChatPrompt(event.target.value)}
                rows={3}
                disabled={foodChatPending}
                placeholder={copy.today.foodPlaceholder}
                className="w-full rounded-[20px] border border-[#d5e2d9] bg-white px-4 py-3 text-sm text-[#102018] outline-none transition focus:border-[#4d9469]"
              />
              <button
                type="submit"
                disabled={foodChatPending}
                className="h-11 rounded-2xl bg-[#1b5a3d] px-5 text-sm font-semibold text-white transition hover:bg-[#256b49] xl:h-auto"
              >
                {foodChatPending ? copy.common.preparing : copy.common.prepare}
              </button>
            </form>

            {chatDraft ? (
              <div className="rounded-[20px] border border-[#d7e5db] bg-[#fbfdfb] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#73857a]">{copy.today.draftTitle}</p>
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
                      {copy.today.draftItems(chatDraft.items.length)}
                    </span>
                    <select
                      value={chatDraft.mealId}
                      onChange={(event) => handleChatMealTargetChange(event.target.value)}
                      className="h-10 rounded-2xl border border-[#d5e2d9] bg-white px-3 text-sm text-[#264735] outline-none"
                    >
                      {meals.map((meal) => (
                        <option key={meal.id} value={meal.id}>
                          {getMealLabel(meal.id, locale)}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-[#66776b]">{copy.today.draftTargetHint}</p>
                  </div>
                </div>

                <div className="mt-3 rounded-[18px] border border-[#dde7df] bg-white px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#73857a]">
                    {copy.today.draftCommentaryTitle}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#4d6156]">{chatDraft.commentary}</p>
                </div>

                <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {chatDraft.items.map((item) => (
                    <li key={item.id} className="rounded-[16px] border border-[#e3ebe5] bg-white px-3 py-3 text-sm text-[#334a3d]">
                      <p className="font-semibold">{item.name}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-[#7a8b7f] sm:text-xs">{item.grams} {copy.units.grams}</p>
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
                    {copy.common.accept}
                  </button>
                  <button
                    type="button"
                    onClick={() => setChatDraft(null)}
                    className="h-10 rounded-2xl border border-[#d5e2d9] bg-white px-4 text-sm font-medium text-[#385244] transition hover:bg-[#f5faf7]"
                  >
                    {copy.common.clear}
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
              {copy.common.log}
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-[#102018] sm:text-[2rem]">
              {copy.today.mealsTitle}
            </h2>
          </div>

          <div className="rounded-full bg-[#eef5ef] px-3 py-2 text-xs font-semibold text-[#446050]">
            {copy.today.entriesCount(totalEntries)}
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
                      {getMealLabel(meal.id, locale)}
                    </h3>
                    <p className="mt-1 text-xs text-[#627367] sm:text-sm">{copy.today.mealItemsCount(meal.items.length)}</p>
                  </div>

                  <div className={`rounded-[18px] px-3 py-2.5 text-right ${tone.total}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em]">{copy.common.total}</p>
                    <p className="mt-1 text-base font-semibold sm:text-lg">{mealTotals.calories} {copy.units.kcal}</p>
                  </div>
                </div>

                <ul className="mt-4 space-y-2.5">
                  {meal.items.length === 0 ? (
                    <li className="rounded-[18px] border border-dashed border-[#d6e1da] bg-white/70 p-3.5 text-sm text-[#708276]">
                      {copy.today.mealEmpty}
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
                          <p className="mt-1 text-xs text-[#66776b] sm:text-sm">{item.grams} {copy.units.grams}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <MacroPill macro="calories" value={item.calories} compact />
                          <button
                            type="button"
                            onClick={() => handleRequestMealEntryDeletion(meal.id, item.id, item.name)}
                            className="inline-flex h-8 items-center justify-center rounded-full border border-[#e5d8d8] bg-[#fff6f5] px-3 text-[11px] font-semibold text-[#b44a46] transition hover:bg-[#fdeceb]"
                          >
                            {copy.common.delete}
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
              {copy.today.activityEyebrow}
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-[#102018] sm:text-[2rem]">
              {copy.today.activityTitle}
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
                {copy.common.manual}
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
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#728579]">{copy.today.sessionsToday}</p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#102018]">{workoutsTodayCount}</p>
          </div>
          <div className="rounded-[20px] border border-[#dde7df] bg-[#f7fbf8] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#728579]">{copy.today.stepsLogged}</p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#102018]">{formatNumber(stepsToday)}</p>
          </div>
          <div className="rounded-[20px] border border-[#dde7df] bg-[#f7fbf8] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#728579]">{copy.today.burnLogged}</p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#102018]">{formatNumber(workoutBurnToday)} {copy.units.kcal}</p>
          </div>
        </div>

        <p className="mt-4 text-sm leading-6 text-[#617165]">
          {copy.today.activityHint}
        </p>

        {workoutAddMode === 'manual' ? (
          <form onSubmit={handleManualWorkoutAdd} className="mt-4 grid gap-3 xl:grid-cols-[1fr_0.85fr_0.75fr_auto]">
            <input
              value={workoutForm.title}
              onChange={(event) => setWorkoutForm((currentForm) => ({ ...currentForm, title: event.target.value }))}
              placeholder={copy.today.workoutTitlePlaceholder}
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
              {copy.common.add}
            </button>
          </form>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-[#66776b]">
              {workoutChatPending
                ? copy.today.workoutPending
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
                {workoutChatPending ? copy.common.preparing : copy.common.prepare}
              </button>
            </form>

            {workoutChatDraft ? (
              <div className="rounded-[20px] border border-[#d7e5db] bg-[#fbfdfb] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#102018]">{copy.today.workoutDraftTitle}</p>
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
                    {copy.common.accept}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkoutChatDraft(null)}
                    className="h-10 rounded-2xl border border-[#d5e2d9] bg-white px-4 text-sm font-medium text-[#385244] transition hover:bg-[#f5faf7]"
                  >
                    {copy.common.clear}
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
              {copy.common.log}
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-[#102018] sm:text-[2rem]">
              {copy.today.dailyActivityTitle}
            </h2>
          </div>

          <div className="rounded-full bg-[#eef5ef] px-3 py-2 text-xs font-semibold text-[#446050]">
            {copy.today.dailyActivityCount(workoutsTodayCount)}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {workouts.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-[#d6e1da] bg-white/70 p-4 text-sm text-[#708276] md:col-span-2 xl:col-span-3">
              {copy.today.dailyActivityEmpty}
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
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#728579]">{copy.common.result}</p>
                    <p className="mt-1 text-base font-semibold text-[#102018]">{formatWorkoutValue(entry)}</p>
                    <p className="mt-1 text-xs text-[#5f7066]">{formatWorkoutCalories(entry)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRequestWorkoutDeletion(entry.id, entry.title)}
                    className="inline-flex h-8 items-center justify-center rounded-full border border-[#e5d8d8] bg-[#fff6f5] px-3 text-[11px] font-semibold text-[#b44a46] transition hover:bg-[#fdeceb]"
                  >
                    {copy.common.delete}
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
                {copy.stats.eyebrow}
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[#102018] sm:text-4xl">
                {copy.stats.title}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#617165] sm:text-base">
                {copy.stats.description}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                { value: '7d' as const, label: copy.stats.ranges['7d'] },
                { value: '30d' as const, label: copy.stats.ranges['30d'] },
                { value: '90d' as const, label: copy.stats.ranges['90d'] },
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
            value={`${formatSignedWeight(goalAwareWeightChange)} ${copy.units.kg}`}
            note={`${formatWeight(startingWeight)} -> ${formatWeight(profile.currentWeight)} ${copy.units.kg}`}
          />
          <MetricCard
            label={copy.stats.toGoal}
            value={`${formatWeight(remainingToTarget)} ${copy.units.kg}`}
            note={
              remainingToTarget <= 0.1
                ? copy.stats.goalReached(formatWeight(profile.targetWeight))
                : copy.stats.goalProgress(goalProgress, formatWeight(profile.targetWeight))
            }
          />
          <MetricCard
            label={copy.stats.averageCalories}
            value={nutritionHistory.length > 0 ? `${formatNumber(averageCalories)} ${copy.units.kcal}` : copy.stats.noData}
            note={
              nutritionHistory.length > 0
                ? copy.stats.averageCaloriesNote(formatSignedCalories(averageGoalDelta), adherenceDays, nutritionHistory.length)
                : copy.stats.appearsAfterFood
            }
          />
          <MetricCard
            label={copy.stats.activity}
            value={`~${formatNumber(totalWorkoutCalories)} ${copy.units.kcal}`}
            note={
              totalWorkouts > 0 || activeDays > 0
                ? copy.stats.activityNote(
                    totalWorkouts,
                    activeDays,
                    rangeDays,
                    averageSteps > 0 ? formatNumber(averageSteps) : null,
                  )
                : copy.stats.appearsAfterWorkouts
            }
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Surface>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">
                  {copy.stats.weight}
                </p>
                <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[#102018]">
                  {copy.stats.currentWeightNow(formatWeight(profile.currentWeight))}
                </h2>
              </div>
              <p className="text-sm text-[#617165]">
                {copy.stats.pointsAndChange(visibleWeightHistory.length, formatSignedWeight(weightChange))}
              </p>
            </div>

            <div className="mt-6 rounded-[24px] border border-[#dde7df] bg-[#f7fbf8] p-4">
              <svg viewBox="0 0 320 150" className="h-52 w-full" role="img" aria-label={copy.stats.chartAria}>
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
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#67796d]">{copy.stats.periodStart}</p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#102018]">{formatWeight(periodStartWeight)} {copy.units.kg}</p>
              </div>
              <div className="rounded-[20px] border border-[#dce6de] bg-[#fafcfb] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#67796d]">{copy.stats.current}</p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#102018]">{formatWeight(profile.currentWeight)} {copy.units.kg}</p>
              </div>
              <div className="rounded-[20px] border border-[#dce6de] bg-[#fafcfb] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#67796d]">{copy.stats.goal}</p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#102018]">{formatWeight(profile.targetWeight)} {copy.units.kg}</p>
              </div>
            </div>
          </Surface>

          <Surface>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">
                  {copy.stats.caloriesByDay}
                </p>
                <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[#102018]">
                  {nutritionHistory.length > 0 ? copy.stats.adherenceTitle(adherenceDays, nutritionHistory.length) : copy.stats.noFoodLogs}
                </h2>
              </div>
              <p className="text-sm text-[#617165]">
                {nutritionHistory.length > 0
                  ? copy.stats.dailyLimitDelta(formatSignedCalories(averageGoalDelta))
                  : copy.stats.afterFirstEntries}
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
                {copy.stats.chartEmpty}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#66786e]">
              <span className="rounded-full bg-[#e8f3ec] px-3 py-2 text-[#2a6f4d]">{copy.stats.inRange}</span>
              <span className="rounded-full bg-[#eaf1f5] px-3 py-2 text-[#547788]">{copy.stats.belowLimit}</span>
              <span className="rounded-full bg-[#fbefe4] px-3 py-2 text-[#b7722e]">{copy.stats.aboveLimit}</span>
            </div>

            <p className="mt-4 text-sm text-[#617165]">
              {copy.stats.limitNote}
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
              {copy.profile.eyebrow}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[#102018] sm:text-4xl">
              {copy.profile.title}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#617165] sm:text-base">
              {copy.profile.description}
            </p>
          </div>

          <div className="rounded-[24px] bg-[#eef5ef] px-4 py-3 text-sm text-[#4f6255]">
            {copy.profile.autosave}
          </div>
        </div>
      </Surface>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Surface>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">{copy.profile.base}</p>
              <div className="mt-4 grid gap-3">
                <FieldGroup label={copy.onboarding.gender}>
                  <select
                    value={profile.gender}
                    onChange={(event) => updateProfile('gender', event.target.value as Gender)}
                    className={formFieldClassName}
                  >
                    <option value="male">{copy.genders.male}</option>
                    <option value="female">{copy.genders.female}</option>
                  </select>
                </FieldGroup>

                <FieldGroup label={copy.onboarding.age}>
                  <input
                    value={profile.age}
                    onChange={(event) => updateProfile('age', Number(event.target.value))}
                    type="number"
                    placeholder={copy.onboarding.age}
                    className={formFieldClassName}
                  />
                </FieldGroup>

                <FieldGroup label={copy.onboarding.height}>
                  <input
                    value={profile.height}
                    onChange={(event) => updateProfile('height', Number(event.target.value))}
                    type="number"
                    placeholder={copy.onboarding.height}
                    className={formFieldClassName}
                  />
                </FieldGroup>

                <FieldGroup label={copy.onboarding.currentWeight} hint={copy.profile.currentWeightHint}>
                  <input
                    value={profile.currentWeight}
                    type="number"
                    readOnly
                    step="0.1"
                    placeholder={copy.onboarding.currentWeight}
                    className={readOnlyFieldClassName}
                  />
                </FieldGroup>

                <FieldGroup label={copy.onboarding.targetWeight}>
                  <input
                    value={profile.targetWeight}
                    onChange={(event) => updateProfile('targetWeight', Number(event.target.value))}
                    type="number"
                    step="0.1"
                    placeholder={copy.onboarding.targetWeight}
                    className={formFieldClassName}
                  />
                </FieldGroup>
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">{copy.profile.goalActivity}</p>
              <div className="mt-4 grid gap-3">
                <FieldGroup label={copy.onboarding.goal}>
                  <select
                    value={profile.goalType}
                    onChange={(event) => updateProfile('goalType', event.target.value as GoalType)}
                    className={formFieldClassName}
                  >
                    <option value="cut">{copy.goals.cut}</option>
                    <option value="maintain">{copy.goals.maintain}</option>
                    <option value="bulk">{copy.goals.bulk}</option>
                  </select>
                </FieldGroup>
                <FieldGroup label={copy.onboarding.rate}>
                  <input
                    value={profile.weeklyRate}
                    onChange={(event) => updateProfile('weeklyRate', Number(event.target.value))}
                    type="number"
                    step="0.1"
                    placeholder={copy.onboarding.rate}
                    className={formFieldClassName}
                  />
                </FieldGroup>
                <FieldGroup label={copy.onboarding.activity}>
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
                  {copy.profile.macroGoals}
                </p>
                <p className="mt-2 text-sm leading-6 text-[#617165]">
                  {copy.profile.macroGoalsDescription}
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
                  {copy.goalModes.auto}
                </button>
                <button
                  type="button"
                  onClick={() => updateProfile('goalMode', 'manual')}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    profile.goalMode === 'manual' ? 'bg-[#19563a] text-white' : 'text-[#4f6255]'
                  }`}
                >
                  {copy.goalModes.manual}
                </button>
              </div>
            </div>

            {profile.goalMode === 'manual' ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <FieldGroup label={copy.macros.calories}>
                  <input
                    value={profile.manualCalories}
                    onChange={(event) => updateProfile('manualCalories', Number(event.target.value))}
                    type="number"
                    placeholder={copy.macros.calories}
                    className={formFieldWhiteClassName}
                  />
                </FieldGroup>
                <FieldGroup label={`${copy.macros.protein}, ${copy.units.grams}`}>
                  <input
                    value={profile.manualProtein}
                    onChange={(event) => updateProfile('manualProtein', Number(event.target.value))}
                    type="number"
                    placeholder={copy.macros.protein}
                    className={formFieldWhiteClassName}
                  />
                </FieldGroup>
                <FieldGroup label={`${copy.macros.fat}, ${copy.units.grams}`}>
                  <input
                    value={profile.manualFat}
                    onChange={(event) => updateProfile('manualFat', Number(event.target.value))}
                    type="number"
                    placeholder={copy.macros.fat}
                    className={formFieldWhiteClassName}
                  />
                </FieldGroup>
                <FieldGroup label={`${copy.macros.carbs}, ${copy.units.grams}`}>
                  <input
                    value={profile.manualCarbs}
                    onChange={(event) => updateProfile('manualCarbs', Number(event.target.value))}
                    type="number"
                    placeholder={copy.macros.carbs}
                    className={formFieldWhiteClassName}
                  />
                </FieldGroup>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <MetricCard label={copy.macros.calories} value={`${targets.recommended.calories}`} note={copy.common.recommendation} />
                <MetricCard label={copy.macros.protein} value={`${targets.recommended.protein} ${copy.units.grams}`} note={copy.common.perDay} />
                <MetricCard label={copy.macros.fat} value={`${targets.recommended.fat} ${copy.units.grams}`} note={copy.common.perDay} />
                <MetricCard label={copy.macros.carbs} value={`${targets.recommended.carbs} ${copy.units.grams}`} note={copy.common.perDay} />
              </div>
            )}
          </div>
        </Surface>

        <div className="space-y-6">
          <Surface className="bg-[linear-gradient(180deg,#f7fbf8_0%,#f1f7f3_100%)]">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">
              {copy.profile.currentCalculation}
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[#102018]">
              {formatNumber(targets.active.calories)} {copy.units.kcal} {copy.common.perDay}
            </h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <MetricCard label="BMR" value={`${targets.bmr}`} note={copy.metrics.bmr} />
              <MetricCard label="TDEE" value={`${targets.tdee}`} note={copy.metrics.tdee} />
              <MetricCard
                label={copy.metrics.adjustment}
                value={`${targets.adjustment > 0 ? '+' : ''}${targets.adjustment}`}
                note={copy.metrics.adjustmentNote}
              />
              <MetricCard
                label={copy.metrics.activeGoal}
                value={profile.goalMode === 'auto' ? copy.metrics.auto : copy.metrics.manual}
                note={copy.metrics.activeGoalNote}
              />
            </div>
          </Surface>

          <Surface>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">
              {copy.profile.whatDataMatter}
            </p>
            <div className="mt-4 space-y-3 text-sm leading-6 text-[#617165]">
              {copy.profile.whatDataChecklist.map((item) => (
                <div key={item} className="rounded-[22px] border border-[#dde7df] bg-[#f7fbf8] p-4">
                  {item}
                </div>
              ))}
            </div>
          </Surface>

          <Surface>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6d836f]">
              {copy.profile.formulaTitle}
            </p>
            <p className="mt-4 text-sm leading-7 text-[#617165]">
              {copy.profile.formulaBody}
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
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#708276]">{copy.menu.goal}</p>
                <p className="mt-1 text-sm font-semibold text-[#173625]">{formatNumber(targets.active.calories)} {copy.units.kcal}</p>
              </div>

              <button
                type="button"
                onClick={() => setIsMenuOpen((value) => !value)}
                className="flex h-11 w-11 items-center justify-center rounded-[16px] border border-[#d8e3db] bg-white text-[#264735] transition hover:bg-[#f5f8f6]"
                aria-label={copy.menu.open}
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
                  {copy.menu.onboardingNotice}
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
                <label className="grid gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7a8b80]">
                    {copy.localeMenu.label}
                  </span>
                  <select
                    value={locale}
                    onChange={(event) => setLocale(event.target.value as Locale)}
                    className="h-10 rounded-2xl border border-[#d8e3db] bg-white px-3 text-sm text-[#264735] outline-none"
                  >
                    {localeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-3 border-t border-[#e5ece7] pt-3">
                <div className="rounded-[18px] bg-[#f6f8f7] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7a8b80]">{copy.menu.cloud}</p>
                      <p className="mt-1 text-sm font-semibold text-[#13211a]">
                        {isFirebaseConfigured ? (user ? userName : copy.menu.needsLogin) : copy.menu.firebaseNotConfigured}
                      </p>
                      <p className="mt-1 text-[11px] text-[#6d7c72]">
                        {isFirebaseConfigured
                          ? user?.email ?? copy.menu.loginHint
                          : copy.menu.envHint}
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
                          {copy.menu.logout}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleGoogleLogin}
                          className="h-10 rounded-2xl bg-[#1b5a3d] px-4 text-sm font-semibold text-white transition hover:bg-[#256b49]"
                        >
                          {copy.menu.login}
                        </button>
                      )
                    ) : (
                      <span className="inline-flex items-center rounded-2xl bg-[#fff2df] px-3 py-2 text-xs font-semibold text-[#9d6a22]">
                        {copy.menu.envRequired}
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
