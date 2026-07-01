import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { bearer } from 'better-auth/plugins';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { getMigrations } from 'better-auth/db/migration';
import { logger } from './logger.ts';

export interface AuthServiceOptions {
	secret: string;
	dbFilename: string;
	baseURL: string;
	cookiePath?: string;
	seedEmail?: string;
	seedPassword?: string;
	enableRegistration?: boolean;
}

export class AuthService {
	public auth: ReturnType<typeof betterAuth>;
	private initPromise: Promise<void> | null = null;
	private options: AuthServiceOptions;
	private _isSeeding: boolean = false;

	constructor(options: AuthServiceOptions) {
		if (!options.secret || options.secret.length < 32) {
			throw new Error('Secret must be at least 32 characters long');
		}

		this.options = options;
		
		fs.mkdirSync(path.dirname(options.dbFilename), { recursive: true });

		const db = new DatabaseSync(options.dbFilename);
		db.exec('PRAGMA journal_mode = WAL;');

		this.auth = betterAuth({
			database: db,
			secret: options.secret,
			baseURL: options.baseURL,
			emailAndPassword: {
				enabled: true
			},
			session: {
				expiresIn: 60 * 60 * 24 * 7, // 7 days
				updateAge: 60 * 60 * 24 // 1 day
			},
			rateLimit: {
				window: 60, // 60 seconds
				max: 100, // 100 requests per 60 seconds globally
				customRules: {
					'/sign-in/email': { window: 60, max: 5 },
					'/sign-up/email': { window: 60, max: 3 }
				}
			},
			plugins: [bearer()],
			advanced: {
				defaultCookieAttributes: {
					path: options.cookiePath ?? '/api'
				}
			},
			user: {
				additionalFields: {
					profileData: {
						type: 'string',
						required: false,
						defaultValue: '{}',
						input: false
					}
				}
			},
			databaseHooks: {
				session: {
					create: {
						after: async (session) => {
							logger.info({ username: session.userId, event: 'login_success' }, `Session created for user ${session.userId}`);
						}
					},
					delete: {
						after: async (session) => {
							logger.info({ username: session.userId, event: 'logout' }, `Session deleted for user ${session.userId}`);
						}
					}
				},
				user: {
					create: {
						before: async (user) => {
							if (!this.options.enableRegistration && !this._isSeeding) {
								throw new APIError('FORBIDDEN', { message: 'Registration is disabled' });
							}
						},
						after: async (user) => {
							logger.info({ username: user.email, event: 'register_success' }, `User ${user.email} registered successfully`);
						}
					}
				}
			},
			onAPIError: {
				onError: (error, ctx) => {
					if (ctx.path === '/sign-in/email') {
						// Need to use any casting safely due to untyped context body
						const email = (ctx.body && typeof ctx.body === 'object' && 'email' in ctx.body) ? (ctx.body as any).email : 'unknown';
						logger.warn({ username: email, event: 'login_failed', error: error.message }, `Failed login attempt for ${email}`);
					}
				}
			}
		});
	}

	public async ensureInit(): Promise<void> {
		if (!this.initPromise) {
			this.initPromise = (async () => {
				logger.info('Checking and running auth database migrations...');
				const { runMigrations } = await getMigrations(this.auth.options);
				await runMigrations();
				logger.info('Auth database migrations check complete.');

				if (this.options.seedEmail && this.options.seedPassword) {
					logger.info({ email: this.options.seedEmail }, 'Attempting to seed admin user...');
					this._isSeeding = true;
					
					try {
						await this.auth.api.signUpEmail({
							body: {
								email: this.options.seedEmail,
								password: this.options.seedPassword,
								name: this.options.seedEmail.split('@')[0]
							},
							headers: new Headers({
								host: new URL(this.options.baseURL).host
							})
						});
						logger.info({ email: this.options.seedEmail }, 'Admin user seeded successfully.');
					} catch (err: any) {
						if (err?.body?.message?.includes('already exists') || err?.message?.includes('already exists') || err?.status === 409 || err?.body?.code === 'USER_ALREADY_EXISTS') {
							logger.debug({ email: this.options.seedEmail }, 'Admin user already exists or seeding skipped.');
						} else {
							logger.error({ email: this.options.seedEmail, error: err?.body?.message || err.message }, 'Failed to seed admin user.');
						}
					} finally {
						this._isSeeding = false;
					}
				}
			})();
		}
		await this.initPromise;
	}
}
