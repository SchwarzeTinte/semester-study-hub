# Semester Study Hub

A study planning web app built with React, Vite, and Supabase.

## Features

- Manage semester courses
- Track weekly course status
- Create review items from courses
- Upload and manage course files
- Store structured data in Supabase Database
- Store uploaded files in Supabase Storage

## Stack

- React
- Vite
- Tailwind CSS
- Supabase

## Local development

Install dependencies:

```bash
npm install
```

Create local env file:

```bash
cp .env.example .env.local
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Set these values in `.env.local`:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Run locally:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Preview production build:

```bash
npm run preview
```

## Supabase setup

Run these SQL files in the Supabase SQL Editor:

- `supabase/schema.sql`
- `supabase/storage.sql`

They create:

- database tables for courses, weekly records, reviews, and files
- the `study-files` storage bucket
- storage policies

## Deployment to Vercel

1. Push this repository to GitHub
2. Import the repository into Vercel
3. Keep the build command as:

```bash
npm run build
```

4. Keep the output directory as:

```bash
dist
```

5. Add these environment variables in Vercel:

```env
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
```

6. Deploy

## Important

- Do not expose a Supabase service role key in the frontend
- Only use the publishable key in Vite env vars
- `.env.local` should not be committed

