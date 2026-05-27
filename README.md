# Calories

Calories is a React + Vite app for tracking food, body weight, and daily activity. User data is stored in Firebase Auth + Firestore. Firebase Hosting and Firestore config are already included in this repo, so another developer only needs to add their own keys, connect their own Firebase project, and deploy.

## Requirements

- Node.js LTS, preferably 20+
- npm
- your own Firebase project
- an OpenAI API key if you want AI food and workout parsing

## Quick Start

### 1. Install dependencies

```powershell
npm install
```

### 2. Create a Firebase project

1. Open Firebase Console.
2. Create a new project.
3. Add a Web App to the project.
4. Save the web config from Project settings.

### 3. Enable the required Firebase services

#### Authentication

1. Open Authentication.
2. Click Get started.
3. Enable Google in Sign-in method.
4. Set the support email and save.

#### Firestore

1. Open Firestore Database.
2. Click Create database.
3. Choose Production mode.
4. Select a region.

### 4. Create your own `.env.local`

Copy `.env.example` to `.env.local` and fill in your own values:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_OPENAI_API_KEY=
VITE_OPENAI_MODEL=gpt-4.1
```

Where to find the Firebase values:

1. Firebase Console
2. Project settings
3. General
4. Your apps
5. Config

Important:

- `.env.local` is not committed, so every developer must provide their own keys.
- `VITE_OPENAI_API_KEY` is only required for AI features. Without it, the app still runs, but AI food and workout parsing will not work.
- `VITE_OPENAI_MODEL` is optional. If omitted, the app defaults to `gpt-4.1`.
- Example model values: `gpt-4.1`, `gpt-4.1-mini`, `gpt-4o`, `gpt-4o-mini`.

### 5. Run locally

```powershell
npm run dev
```

After startup, verify that:

1. Google sign-in works,
2. the user document is created in Firestore,
3. profile, food, weight, and activity are saved correctly.

If Google sign-in does not open, check Authorized domains in Firebase Authentication. For local development, `localhost` is usually enough.

## Deploy to Your Firebase Project

### 1. Sign in to Firebase CLI

```powershell
npm run firebase:login
```

### 2. Link the project

```powershell
npx firebase-tools use --add
```

Select your `projectId` when prompted.

### 3. Deploy

```powershell
npm run deploy
```

This command:

1. builds the app,
2. deploys Firebase Hosting,
3. publishes Firestore rules,
4. publishes Firestore indexes.

## What Is Already Configured

- Firebase Hosting: `firebase.json`
- Firestore rules: `firestore.rules`
- Firestore indexes: `firestore.indexes.json`
- Firebase client config: `src/lib/firebase.ts`

## Firestore Data Layout

- `users/{uid}`
- `users/{uid}/private/state`

The `state` document currently stores:

- `profile`
- `mealHistory`
- `workoutHistory`
- `weightHistory`
- `updatedAt`

## Note About `functions/`

The repo includes a `functions/` folder, but it is not required for the current local run and deploy flow. Right now the app uses Firebase Auth, Firestore, and Hosting, while AI requests are sent directly from the frontend using `VITE_OPENAI_API_KEY`.

If you want to hide the OpenAI key later, move the AI calls into Firebase Functions.

## Additional Notes

More deployment details are available in `FIREBASE_DEPLOY.md`.
