import pino from 'pino';

let loggerInstance: pino.Logger | null = null;

export interface LoggerConfig {
	/**
	 * Path to the log file on disk. If omitted, logs only to stdout.
	 */
	logFile?: string;
	/**
	 * Max size of a log file before rotation (e.g. '10m', '100k'). Defaults to '10m'.
	 */
	rotateSize?: string;
	/**
	 * Frequency of log rotation (e.g. 'daily', 'hourly'). Defaults to 'daily'.
	 */
	rotateInterval?: string;
	/**
	 * Maximum number of rotated log files to retain. Defaults to 5.
	 */
	rotateCount?: number;
	/**
	 * Pino log level (e.g. 'info', 'debug', 'warn'). Defaults to 'debug' (or 'silent' in tests).
	 */
	level?: string;
}

/**
 * Initialise the logger with specific configuration options.
 * If not called, the logger lazily initialises itself using environment variables.
 */
export function initLogger(config: LoggerConfig = {}): pino.Logger {
	const isTest =
		process.env.NODE_ENV === 'test' ||
		!!process.env.NODE_TEST_CONTEXT ||
		process.env.VITEST === 'true';

	const level = config.level || (isTest ? 'silent' : 'debug');

	if (isTest && !config.level && !config.logFile) {
		loggerInstance = pino({ level: 'silent' });
		return loggerInstance;
	}

	const logFile = config.logFile || process.env.LOG_FILE;

	if (logFile) {
		const size = config.rotateSize || process.env.LOG_ROTATE_SIZE || '10m';
		const frequency = config.rotateInterval || process.env.LOG_ROTATE_INTERVAL || 'daily';
		const limitCount = config.rotateCount || Number(process.env.LOG_ROTATE_COUNT) || 5;

		const transport = pino.transport({
			targets: [
				{
					target: 'pino/file',
					options: { destination: 1 } // Write to stdout (console)
				},
				{
					target: 'pino-roll',
					options: {
						file: logFile,
						size,
						frequency,
						limit: { count: limitCount },
						mkdir: true
					}
				}
			]
		});

		loggerInstance = pino({ level }, transport);
	} else {
		loggerInstance = pino({ level });
	}

	return loggerInstance;
}

/**
 * Standard configured Pino logger.
 * Lazily initialises if not explicitly configured using initLogger().
 */
export const logger = new Proxy({} as pino.Logger, {
	get(_, prop) {
		if (!loggerInstance) {
			initLogger();
		}
		return Reflect.get(loggerInstance!, prop);
	}
});

export interface AccessLoggerOptions {
	/**
	 * An optional custom Pino logger instance to use.
	 * Defaults to the exported logger instance.
	 */
	loggerInstance?: pino.Logger;
}

export type Handle = (input: {
	event: any;
	resolve: (event: any, opts?: any) => Promise<Response>;
}) => Promise<Response>;

/**
 * SvelteKit hook middleware to log all access and API requests.
 * Automatically extracts user identifiers from event.locals (checks username/user.username).
 *
 * @example
 * ```typescript
 * // hooks.server.ts
 * import { createAccessLogger } from 'aksvapi';
 * export const handle = createAccessLogger();
 * ```
 */
export function createAccessLogger(options: AccessLoggerOptions = {}): Handle {
	const log = options.loggerInstance || logger;

	return async ({ event, resolve }) => {
		const start = Date.now();
		const response = await resolve(event);
		const durationMs = Date.now() - start;

		const user = event.locals?.username || event.locals?.user?.username || 'anonymous';
		const status = response.status;
		const method = event.request.method;
		const url = event.url.pathname + event.url.search;

		log.info(
			{
				user,
				status,
				method,
				url,
				durationMs
			},
			`${method} ${url} ${status} - ${durationMs}ms`
		);

		return response;
	};
}
