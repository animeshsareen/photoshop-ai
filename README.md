# AI Photo Editor

An AI-powered photo editing application that allows users to edit photos using natural language descriptions.

## Features

- **Auth0 Authentication**: Secure sign-in with multiple identity providers via Auth0
- **AI Photo Editing**: Edit photos using natural language prompts
- **Multiple Image Support**: Upload and process multiple images at once
- **Credit System**: Pay-per-use credit system for AI operations (new users automatically receive 2 free credits)
- **Responsive Design**: Modern UI that works on all devices

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or pnpm
- Auth0 application credentials

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd ai-photo-editor
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
   - Copy `env.example` to `.env.local`
   - Fill in your Auth0 application credentials

### Auth0 Setup

1. Go to the [Auth0 Dashboard](https://manage.auth0.com/)
2. Create a new Regular Web Application
3. In Settings, add the following:
   - Allowed Callback URLs: `http://localhost:3000/api/auth/callback/auth0`
   - Allowed Logout URLs: `http://localhost:3000/`
   - Allowed Web Origins: `http://localhost:3000`
4. Copy the Domain (use as AUTH0_ISSUER with `https://` prefix), Client ID, and Client Secret into your `.env.local`
5. (Optional) If using a custom API, set an Audience and add it as `AUTH0_AUDIENCE`

### Environment Variables

Create a `.env.local` file in the root directory:

```env
# NextAuth Configuration
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-key-here-change-in-production

# Auth0 OAuth
AUTH0_CLIENT_ID=your-auth0-client-id
AUTH0_CLIENT_SECRET=your-auth0-client-secret
AUTH0_ISSUER=https://your-tenant.us.auth0.com
# AUTH0_AUDIENCE=https://your-api-identifier
```

### Running the Application

1. Start the development server:
```bash
npm run dev
```

2. Open [http://localhost:3000](http://localhost:3000) in your browser
3. Sign in with your Google account
4. Start editing photos!

## Usage

1. **Sign In**: Use Auth0 to authenticate
2. **Upload Images**: Drag and drop or select multiple images
3. **Describe Edit**: Write a natural language description of what you want
4. **Generate**: Click generate to create your AI-edited image
5. **Download**: Save your edited image

## API Routes

- `/api/auth/[...nextauth]` - NextAuth.js authentication endpoints
- `/api/edit-image` - AI image editing endpoint (protected)
- `/api/create-payment-intent` - Payment processing (protected)
- `/api/credits` - Get/add/deduct device-based credits (server-side)

## Technologies Used

- **Next.js 15** - React framework
- **NextAuth.js** - Authentication
- **Auth0** - Authentication platform
- **Tailwind CSS** - Styling
- **Radix UI** - UI components
- **Google Gemini AI** - Image processing
- **Supabase** - Device credit storage and ledger

## Security Features

- Protected API routes with authentication middleware
- Secure session management
- OAuth 2.0 authentication flow
- Environment variable protection

## Credits Backend (Supabase)

This app uses Supabase to store per-device credit balances and a ledger.

Tables to create in Supabase SQL editor:

```sql
-- Ensure case-insensitive text is available
create extension if not exists citext with schema public;
-- User-based credits (new)
alter table public.users
   add column if not exists credits integer not null default 0 check (credits >= 0);

create table if not exists public.user_credit_ledger (
   id bigint generated always as identity primary key,
   user_email text not null references public.users(email) on delete cascade,
   ip_address text,
   delta integer not null,
   reason text,
   idempotency_key text,
   created_at timestamp with time zone default now()
);

create index if not exists user_credit_ledger_email_idx on public.user_credit_ledger(user_email);
create index if not exists user_credit_ledger_idemp_idx on public.user_credit_ledger(idempotency_key);

create table if not exists public.device_credits (
   device_id text primary key,
   ip_address text,
   credits integer not null default 0,
   updated_at timestamp with time zone default now()
);

create table if not exists public.credit_ledger (
   id bigint generated always as identity primary key,
   device_id text not null references public.device_credits(device_id) on delete cascade,
   ip_address text,
   delta integer not null,
   reason text,
   idempotency_key text,
   created_at timestamp with time zone default now()
);

create index if not exists credit_ledger_device_id_idx on public.credit_ledger(device_id);
create index if not exists credit_ledger_idempotency_idx on public.credit_ledger(idempotency_key);
```

Auth-related tables (used by NextAuth sync in `lib/auth.ts`):

```sql
-- If you already have users.email as text, migrate to citext to avoid FK type mismatch
create extension if not exists citext with schema public;
alter table public.users alter column email type citext using email::citext;

-- Ensure user_credit_ledger.user_email matches citext type
alter table public.user_credit_ledger alter column user_email type citext using user_email::citext;

-- Basic user directory used by the app (email is citext for case-insensitive uniqueness)
create table if not exists public.users (
   email citext primary key,
   display_name text,
   image_url text,
   created_at timestamp with time zone default now()
);

-- Lightweight session registry (JWT strategy still used in NextAuth)
create table if not exists public.sessions (
   session_token text primary key,
   user_email text not null references public.users(email) on delete cascade,
   ip text,
   user_agent text,
   expires_at timestamp with time zone not null,
   created_at timestamp with time zone default now()
);

create index if not exists sessions_user_email_idx on public.sessions(user_email);
create index if not exists sessions_expires_at_idx on public.sessions(expires_at);
```

Environment variables required:

```env
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
# (optional for client reads) SUPABASE_ANON_KEY=...
```

Production (Vercel) environment checklist:

- `NEXTAUTH_URL` set to your full production URL (e.g. `https://your-app.vercel.app`).
- `NEXTAUTH_SECRET` set to a strong random string (e.g. `openssl rand -base64 32`).
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` present and scoped to both Build and Runtime.
- Auth provider secrets (e.g. Auth0/Google) configured with production callback URLs.
- Ensure the tables above exist in your Supabase project.

Device identification is set via a `device_id` cookie by `middleware.ts` on first visit. The `/api/credits` route will auto-create a record with `DEFAULT_FREE_CREDITS` on first access.

IP-based tracking (optional):

- Set `CREDITS_TRACKING_MODE=ip` in your environment to key balances by client IP (`ip:<address>`) instead of the device cookie. Useful for kiosk/demo flows. Default is `device`.
- You can also override per-request via query string: `/api/credits?by=ip` or `/api/credits?by=device`.
- Responses now include `{ key, mode, deviceId, ip, credits }` for clarity.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is licensed under the MIT License.
