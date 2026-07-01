import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { logger, createAccessLogger, initLogger } from './logger.ts';

test('Logger Utilities', async (t) => {
	await t.test('logger is silent in test environment by default', () => {
		assert.strictEqual(logger.level, 'silent');
	});

	await t.test('createAccessLogger logs access requests with user context', async () => {
		const loggedItems: any[] = [];
		const mockLogger = {
			info: (obj: any, msg: string) => {
				loggedItems.push({ obj, msg });
			}
		} as any;

		const hook = createAccessLogger({ loggerInstance: mockLogger });

		const mockEvent = {
			request: { method: 'POST' },
			url: { pathname: '/api/auth/feeds', search: '?page=2' },
			locals: { username: 'alice' }
		};

		const mockResolve = async () => {
			return new Response(null, { status: 201 });
		};

		const response = await hook({ event: mockEvent, resolve: mockResolve });
		assert.strictEqual(response.status, 201);
		assert.strictEqual(loggedItems.length, 1);
		assert.strictEqual(loggedItems[0].obj.user, 'alice');
		assert.strictEqual(loggedItems[0].obj.status, 201);
		assert.strictEqual(loggedItems[0].obj.method, 'POST');
		assert.strictEqual(loggedItems[0].obj.url, '/api/auth/feeds?page=2');
		assert.ok(typeof loggedItems[0].obj.durationMs === 'number');
	});

	await t.test('createAccessLogger defaults to anonymous if no user is authenticated', async () => {
		const loggedItems: any[] = [];
		const mockLogger = {
			info: (obj: any, msg: string) => {
				loggedItems.push({ obj, msg });
			}
		} as any;

		const hook = createAccessLogger({ loggerInstance: mockLogger });

		const mockEvent = {
			request: { method: 'GET' },
			url: { pathname: '/api/public', search: '' },
			locals: {}
		};

		const mockResolve = async () => {
			return new Response(null, { status: 200 });
		};

		await hook({ event: mockEvent, resolve: mockResolve });
		assert.strictEqual(loggedItems.length, 1);
		assert.strictEqual(loggedItems[0].obj.user, 'anonymous');
	});

	await t.test('initLogger with logFile writes logs to disk', async () => {
		const tempDir = path.resolve(import.meta.dirname, '../../scratch');
		if (!fs.existsSync(tempDir)) {
			fs.mkdirSync(tempDir, { recursive: true });
		}
		const logFile = path.resolve(tempDir, `test-${Date.now()}.log`);
		const logPrefix = path.basename(logFile, '.log');

		try {
			const fileLogger = initLogger({
				logFile,
				level: 'info'
			});

			fileLogger.info({ testVal: 'disk-test' }, 'hello log file');

			// Poll the directory every 100ms for up to 1 second
			let matchingFile: string | undefined;
			for (let i = 0; i < 10; i++) {
				await new Promise((resolve) => setTimeout(resolve, 100));
				const files = fs.readdirSync(tempDir);
				matchingFile = files.find((f) => f.startsWith(logPrefix));
				if (matchingFile) {
					break;
				}
			}

			assert.ok(matchingFile, `Log file starting with ${logPrefix} should be created`);

			const content = fs.readFileSync(path.resolve(tempDir, matchingFile), 'utf8');
			assert.ok(content.includes('hello log file'));
			assert.ok(content.includes('disk-test'));
		} finally {
			if (fs.existsSync(tempDir)) {
				const files = fs.readdirSync(tempDir);
				for (const file of files) {
					if (file.startsWith(logPrefix)) {
						try {
							fs.unlinkSync(path.resolve(tempDir, file));
						} catch {
							// Ignore deletion errors in test cleanup
						}
					}
				}
			}
		}
	});
});

