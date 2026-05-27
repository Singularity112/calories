# Calories

Приложение для учета калорий, веса и активности на React + Vite. Состояние пользователя хранится в Firebase Auth + Firestore. В проекте уже лежат конфиги для Firebase Hosting и Firestore, поэтому другу нужно только подставить свои ключи, подключить свой Firebase-проект и выполнить деплой.

## Что понадобится

- Node.js LTS, лучше 20+
- npm
- свой проект в Firebase
- ключ OpenAI, если нужны AI-разбор еды и тренировки

## Быстрый старт

### 1. Установить зависимости

```powershell
npm install
```

### 2. Создать Firebase-проект

1. Открыть Firebase Console.
2. Создать новый проект.
3. Добавить в проект Web App.
4. Сохранить web config из Project settings.

### 3. Включить нужные сервисы в Firebase

#### Authentication

1. Открыть Authentication.
2. Нажать Get started.
3. В Sign-in method включить Google.
4. Указать support email и сохранить.

#### Firestore

1. Открыть Firestore Database.
2. Нажать Create database.
3. Выбрать Production mode.
4. Выбрать регион.

### 4. Создать свой `.env.local`

Скопировать `.env.example` в `.env.local` и заполнить своими значениями:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_OPENAI_API_KEY=
```

Откуда взять значения Firebase:

1. Firebase Console
2. Project settings
3. General
4. Your apps
5. Config

Важно:

- `.env.local` не коммитится, каждый заполняет его своими ключами.
- `VITE_OPENAI_API_KEY` нужен только для AI-функций. Без него приложение запускается, но AI-разбор еды и тренировок работать не будет.

### 5. Запустить локально

```powershell
npm run dev
```

После запуска приложение будет доступно локально, и можно проверить:

1. вход через Google,
2. создание пользователя в Firestore,
3. сохранение профиля, еды, веса и активности.

Если Google login не открывается, проверить Authorized domains в Firebase Authentication. Для локального запуска обычно достаточно `localhost`.

## Деплой в свой Firebase

### 1. Войти в Firebase CLI

```powershell
npm run firebase:login
```

### 2. Привязать проект

```powershell
npx firebase-tools use --add
```

Нужно выбрать свой `projectId`.

### 3. Задеплоить

```powershell
npm run deploy
```

Эта команда:

1. собирает приложение,
2. деплоит Firebase Hosting,
3. публикует Firestore rules,
4. публикует Firestore indexes.

## Что уже настроено в репозитории

- Firebase Hosting: `firebase.json`
- Firestore rules: `firestore.rules`
- Firestore indexes: `firestore.indexes.json`
- Firebase client config: `src/lib/firebase.ts`

## Что хранится в Firestore

- `users/{uid}`
- `users/{uid}/private/state`

В `state` сейчас сохраняются:

- `profile`
- `mealHistory`
- `workoutHistory`
- `weightHistory`
- `updatedAt`

## Важно про `functions/`

Папка `functions/` в репозитории есть, но в текущем сценарии запуска и деплоя она не обязательна. Сейчас приложение использует Firebase Auth, Firestore и Hosting, а AI-запросы идут напрямую из фронтенда через `VITE_OPENAI_API_KEY`.

Если позже захочется спрятать OpenAI-ключ, тогда можно будет вынести AI-вызовы в Firebase Functions.

## Дополнительно

Более подробный deploy-гайд лежит в `FIREBASE_DEPLOY.md`.
