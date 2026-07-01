import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { AuthService } from './authService.ts';

describe('AuthService (Better Auth)', () => {
	const secret = 'test-auth-service-secret-key-very-long';
	const dbFilename = 'test-auth.db';
	const baseURL = 'http://localhost:3000';

	// Clean up database files after tests run
	after(() => {
		try {
			if (fs.existsSync(dbFilename)) {
				fs.unlinkSync(dbFilename);
			}
			if (fs.existsSync(`${dbFilename}-wal`)) {
				fs.unlinkSync(`${dbFilename}-wal`);
			}
			if (fs.existsSync(`${dbFilename}-shm`)) {
				fs.unlinkSync(`${dbFilename}-shm`);
			}
		} catch (e) {
			// ignore cleanup errors
		}
	});

	test('Initialization requires min 32 characters secret', () => {
		assert.throws(() => {
			new AuthService({ secret: 'short', dbFilename, baseURL });
		}, /Secret must be at least 32 characters long/);
	});

	test('Initialization and seeding user', async () => {
		const authService = new AuthService({
			secret,
			dbFilename,
			baseURL,
			seedEmail: 'admin@example.com',
			seedPassword: 'securepassword123'
		});

		// ensureInit runs migrations and seeds the user
		await authService.ensureInit();

		// Try logging in with the seeded user via better-auth native API
		const headers = new Headers({ host: new URL(baseURL).host });
		const sessionResponse = await authService.auth.api.signInEmail({
			body: {
				email: 'admin@example.com',
				password: 'securepassword123'
			},
			headers
		});

		assert.ok(sessionResponse);
		assert.ok(sessionResponse.token);
		assert.strictEqual(sessionResponse.user.email, 'admin@example.com');
	});

	test('ProfileData field is available on user', async () => {
		const authService = new AuthService({
			secret,
			dbFilename,
			baseURL,
			seedEmail: 'profile@example.com',
			seedPassword: 'securepassword123'
		});

		await authService.ensureInit();

		const headers = new Headers({ host: new URL(baseURL).host });
		const sessionResponse = await authService.auth.api.signInEmail({
			body: {
				email: 'profile@example.com',
				password: 'securepassword123'
			},
			headers
		});

		// profileData should default to '{}'
		assert.strictEqual(sessionResponse.user.profileData, '{}');

		const newProfileData = '{"test":true}';
		const updateStmt = authService.auth.options.database.prepare('UPDATE user SET profileData = ? WHERE id = ?');
		updateStmt.run(newProfileData, sessionResponse.user.id);

		// Fetch session to verify it updated
		const checkSession = await authService.auth.api.getSession({
			headers: new Headers({
				host: new URL(baseURL).host,
				authorization: `Bearer ${sessionResponse.token}`
			})
		});

		assert.ok(checkSession);
		assert.strictEqual(checkSession.user.profileData, newProfileData);
	});
});
