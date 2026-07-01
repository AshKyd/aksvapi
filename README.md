# AKSVAPI

Tools for writing SvelteKit REST APIs.

## Modules


### [Response Utilities](./src/lib/response.ts)
* `jsonError` - Creates SvelteKit-compatible JSON error Response objects.

### [Logger Utilities](./src/lib/logger.ts)
* `logger` - Standard configured Pino logger (silenced automatically in test environments).
* `initLogger(config)` - Configures disk logging and log rotation.
* `createAccessLogger` - Creates SvelteKit hook middleware to log HTTP access requests with username details.

#### Configuring Disk Logging
By default, `logger` writes structured JSON to stdout. To enable logging to disk:

```typescript
import { initLogger } from 'aksvapi';

initLogger({
  logFile: '/path/to/app.log'
});
```

#### SvelteKit Environment Variables
In SvelteKit projects, virtual import modules like `$env/dynamic/private` are preferred over `process.env` for environment variable safety. Because `aksvapi` is an external module, call `initLogger` dynamically in your `hooks.server.ts`:

```typescript
// src/hooks.server.ts
import { env } from '$env/dynamic/private';
import { initLogger, createAccessLogger } from 'aksvapi';

// Initialize logger with SvelteKit environment variables
initLogger({
  logFile: env.LOG_FILE
});

export const handle = createAccessLogger();
```

---

## Authentication (`AuthService`)

`AuthService` is a high-level `better-auth` wrapper optimised for SvelteKit applications. It configures `better-auth` out-of-the-box with SQLite (WAL mode), migrations, rate limiting, and standard database hooks.

### 1. Project Setup & Initialisation

In a new project, wrap the authentication service in a server-side module (e.g. `src/lib/server/AuthService.ts`):

```typescript
import { AuthService } from 'aksvapi';
import { env } from '$env/dynamic/private';
import path from 'node:path';

// Initialise the AuthService instance
export const authService = new AuthService({
  // Required: JWT/cookie signing secret (minimum 32 characters)
  secret: env.AUTH_SECRET,
  
  // Required: Path to the SQLite database
  dbFilename: path.join(env.DATA_DIR || './data', 'auth.db'),
  
  // Required: Public origin of the application
  baseURL: env.ORIGIN || 'http://localhost:5173',
  
  // Optional: Restricts session cookies (defaults to '/api')
  cookiePath: '/api',

  // Optional: Admin credentials seeded on startup
  seedEmail: env.SEED_EMAIL,
  seedPassword: env.SEED_PASSWORD,
  
  // Optional: Allow public user signups (defaults to false)
  enableRegistration: false
});

// Export the underlying better-auth instance
export const auth = authService.auth;
```

Before handling any client requests, ensure the database and migrations are initialised. In `src/hooks.server.ts`:

```typescript
import { sequence } from '@sveltejs/kit/hooks';
import { svelteKitHandler } from 'aksvapi/svelte-kit';
import { auth, authService } from '$lib/server/AuthService';

// Run migrations and user seeding synchronously on boot
await authService.ensureInit();

const authHandler = async ({ event, resolve }) => {
  // Let better-auth handle its own routes (e.g., /api/auth/*)
  if (event.url.pathname.startsWith('/api/auth/')) {
    return svelteKitHandler({ event, resolve, auth });
  }

  // Protect private API routes
  if (event.url.pathname.startsWith('/api/v1/')) {
    if (event.request.method === 'OPTIONS') return resolve(event);

    const sessionData = await auth.api.getSession({
      headers: event.request.headers
    });

    if (!sessionData || !sessionData.session) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    event.locals.user = sessionData.user;
    event.locals.session = sessionData.session;
  }

  return resolve(event);
};

export const handle = sequence(authHandler);
```

### 2. Client-Side Integration

Instantiate the auth client in a shared client module (e.g., `src/lib/services/AuthService.ts`):

```typescript
import { createAuthClient } from 'aksvapi/client';

export const authClient = createAuthClient();

// Usage example:
// await authClient.signIn.email({ email, password });
// await authClient.signOut();
```

### 3. Custom Properties (`profileData`)

The `AuthService` database schema includes a custom `profileData` text column on the `user` table. It defaults to `'{}'` and is configured with `input: false` to write-protect it from arbitrary client-side modifications.

#### Reading profileData
On the server (via `event.locals.user`) or on the client (via `authClient.getSession()`), read the property directly from the user object:
```typescript
const profile = JSON.parse(user.profileData || '{}');
```

Because `profileData` is read-only on the client, all modifications must be performed on the server (e.g. through a SvelteKit PUT/POST API route). Extract the authenticated user's ID from `locals` to ensure security:

```typescript
// src/routes/api/v1/profile/+server.ts
export const PUT = async ({ request, locals }) => {
  if (!locals.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const body = await request.json();
  const userId = locals.user.id;

  const updateStmt = auth.options.database.prepare('UPDATE user SET profileData = ? WHERE id = ?');
  updateStmt.run(JSON.stringify(body.newProfile), userId);

  return new Response(JSON.stringify({ success: true }));
};
```
