# Firebase Setup And Deploy

## Что уже подготовлено в проекте

- Google Auth через Firebase Authentication.
- Firestore как база данных.
- Hosting-конфиг для SPA в `firebase.json`.
- Firestore rules в `firestore.rules`.
- Переменные окружения в `.env.example`.

## 1. Создать Firebase-проект

1. Открой Firebase Console.
2. Нажми `Add project`.
3. Создай проект и дождись инициализации.
4. Внутри проекта добавь `Web App`.

## 2. Включить Google Login

1. Открой `Authentication`.
2. Нажми `Get started`.
3. Перейди в `Sign-in method`.
4. Включи `Google`.
5. Укажи support email и сохрани.

## 3. Создать Firestore

1. Открой `Firestore Database`.
2. Нажми `Create database`.
3. Для MVP можно выбрать `Production mode`, потому что rules уже лежат в проекте.
4. Выбери регион, например `eur3` или ближайший к тебе.

## 4. Заполнить env

1. Возьми config веб-приложения из `Project settings` -> `General` -> `Your apps`.
2. Скопируй `.env.example` в `.env.local`.
3. Заполни значения:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_OPENAI_API_KEY=...
```

4. Перезапусти dev-сервер после изменения `.env.local`.

## 5. Локальный запуск

```powershell
npm install
npm run dev
```

После этого приложение покажет вход через Google и начнет сохранять `profile` и `meals` в Firestore для текущего пользователя.

## 6. Подключить Firebase CLI

Можно через глобальную установку или через `npx`. В проекте уже есть npm-скрипты с `npx`.

```powershell
npm run firebase:login
npx firebase-tools use --add
```

При `use --add` выбери созданный project id.

## 7. OpenAI ключ сейчас хранится во frontend env

Пока чат ходит в OpenAI напрямую из браузера через `VITE_OPENAI_API_KEY`.

Важно:

1. Это временный вариант для быстрого запуска.
2. Такой ключ виден на клиенте, поэтому позже лучше вынести его в Functions или другой backend-прокси.

## 8. Первый деплой

```powershell
npm run deploy
```

Команда:

1. собирает Vite-приложение,
2. деплоит Hosting,
3. деплоит Firestore rules и indexes.

## 9. Что хранится в Firestore

Структура сейчас простая:

- `users/{uid}` — базовая инфа о пользователе.
- `users/{uid}/private/state` — текущее состояние приложения.

В `state` сейчас сохраняются:

- `profile`
- `mealHistory`
- `workoutHistory`
- `weightHistory`
- `updatedAt`

## 10. Что важно проверить после деплоя

1. Google login открывается без ошибки.
2. После входа создается документ пользователя в Firestore.
3. Chat по еде создает черновик КБЖУ, а chat по активности создает черновик тренировки или шагов.
4. Изменения еды, активности, веса и профиля отражаются в документе `users/{uid}/private/state`.
5. После reload данные читаются обратно из Firestore.

## 11. Практическое замечание по тарифу

Для текущей схемы Firestore и Hosting обычно достаточно. Когда захочешь убрать OpenAI ключ из фронта, тогда уже понадобится backend-прокси или Functions, и там может потребоваться `Blaze`.