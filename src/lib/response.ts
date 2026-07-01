import { logger } from './logger.ts';

/**
 * Create a SvelteKit-compatible JSON error Response.
 *
 * @param message - The error message describing what went wrong.
 * @param status - The HTTP status code (defaults to 400).
 * @param details - Optional additional properties to include in the JSON payload.
 *
 * @example
 * ```typescript
 * return jsonError('Failed to parse input', 400, { details: 'Expected integer value' });
 * ```
 */
export function jsonError(
	message: string,
	status = 400,
	details?: Record<string, any>
): Response {
	const body = {
		error: message,
		...details
	};

	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json'
		}
	});
}

/**
 * Wraps a route handler logic, catching errors automatically, logging them with Pino,
 * and returning a sanitized JSON error response to prevent internal detail leaks on 500 errors.
 */
export async function tryJson<T>(
	fn: () => Promise<T> | T,
	options: {
		successStatus?: number;
		errorStatus?: number;
	} = {}
): Promise<Response> {
	try {
		const result = await fn();
		if (result instanceof Response) {
			return result;
		}
		if (result === undefined || result === null) {
			return new Response(null, { status: options.successStatus ?? 204 });
		}
		return new Response(JSON.stringify(result), {
			status: options.successStatus ?? 200,
			headers: {
				'content-type': 'application/json'
			}
		});
	} catch (err: any) {
		const status = typeof err.status === 'number' 
			? err.status 
			: (typeof err.statusCode === 'number' ? err.statusCode : (options.errorStatus ?? 500));

		// Log the error details via the aksvapi Pino logger
		logger.error({ err, status }, `API Error: ${err.message || String(err)}`);

		// Mask message for 500 Internal Server Errors to avoid leaking internals
		const clientMessage = status >= 500 ? 'Internal Server Error' : (err.message || String(err));
		return jsonError(clientMessage, status);
	}
}

