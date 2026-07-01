import { test } from 'node:test';
import assert from 'node:assert';
import { jsonError, tryJson } from './response.ts';

test('Response Utilities', async (t) => {
	await t.test('creates default error response with status 400', async () => {
		const res = jsonError('Something went wrong');
		assert.strictEqual(res.status, 400);
		assert.strictEqual(res.headers.get('content-type'), 'application/json');

		const body = await res.json();
		assert.deepStrictEqual(body, { error: 'Something went wrong' });
	});

	await t.test('creates error response with custom status code', async () => {
		const res = jsonError('Not Authorized', 401);
		assert.strictEqual(res.status, 401);

		const body = await res.json();
		assert.deepStrictEqual(body, { error: 'Not Authorized' });
	});

	await t.test('includes additional detail fields in the payload', async () => {
		const res = jsonError('Validation failed', 422, {
			fields: ['email'],
			code: 'INVALID_EMAIL'
		});
		assert.strictEqual(res.status, 422);

		const body = await res.json();
		assert.deepStrictEqual(body, {
			error: 'Validation failed',
			fields: ['email'],
			code: 'INVALID_EMAIL'
		});
	});

	await t.test('tryJson - returns 200 JSON Response for successful function execution', async () => {
		const res = await tryJson(async () => ({ success: true }));
		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.headers.get('content-type'), 'application/json');
		const body = await res.json();
		assert.deepStrictEqual(body, { success: true });
	});

	await t.test('tryJson - returns 204 Response when function returns undefined/null', async () => {
		const res = await tryJson(async () => null);
		assert.strictEqual(res.status, 204);
		assert.strictEqual(await res.text(), '');
	});

	await t.test('tryJson - returns Response object directly if returned by fn', async () => {
		const responseObj = new Response('raw-stream', { status: 201 });
		const res = await tryJson(async () => responseObj);
		assert.strictEqual(res.status, 201);
		assert.strictEqual(await res.text(), 'raw-stream');
	});

	await t.test('tryJson - defaults to 500 error and masks message for general errors', async () => {
		const res = await tryJson(async () => {
			throw new Error('Database path leaking secret /var/db/file.db');
		});
		assert.strictEqual(res.status, 500);
		const body = await res.json();
		assert.strictEqual(body.error, 'Internal Server Error');
	});

	await t.test('tryJson - exposes error message for status < 500 errors', async () => {
		const res = await tryJson(async () => {
			const err: any = new Error('Invalid notebook type');
			err.status = 400;
			throw err;
		});
		assert.strictEqual(res.status, 400);
		const body = await res.json();
		assert.strictEqual(body.error, 'Invalid notebook type');
	});
});

