import { describeValue } from './utils.ts';

/**
 * Base class for errors caused by invalid configuration.
 */
export class ConfigurationError extends Error {
	/** The configuration file the error relates to, when known. */
	readonly filePath?: string;

	constructor(message: string, options: { cause?: unknown; filePath?: string } = {}) {
		super(message, { cause: options.cause });
		this.name = 'ConfigurationError';
		this.filePath = options.filePath;
	}
}

/**
 * Thrown when a configuration file cannot be read or parsed, or does not contain
 * a configuration object.
 */
export class ConfigurationLoadError extends ConfigurationError {
	constructor(message: string, options: { cause?: unknown; filePath?: string } = {}) {
		super(message, options);
		this.name = 'ConfigurationLoadError';
	}
}

/**
 * Thrown when a `*_from_glob` entry is not a valid glob pattern.
 */
export class InvalidGlobPatternError extends ConfigurationError {
	/** The invalid pattern exactly as it appears in the configuration. */
	readonly pattern: unknown;

	/** A short explanation of why the pattern is invalid. */
	readonly reason?: string;

	constructor(
		pattern: unknown,
		options: { cause?: unknown; filePath?: string; reason?: string } = {}
	) {
		const location = options.filePath ? ` in "${options.filePath}"` : '';
		const reason = options.reason ? ` (${options.reason})` : '';
		super(`Invalid glob pattern${location}: ${formatPattern(pattern)}${reason}`, options);
		this.name = 'InvalidGlobPatternError';
		this.pattern = pattern;
		this.reason = options.reason;
	}
}

function formatPattern(pattern: unknown): string {
	return typeof pattern === 'string' ? JSON.stringify(pattern) : describeValue(pattern);
}

export function invalidConfigurationError(
	value: unknown,
	filePath?: string
): ConfigurationLoadError {
	const location = filePath ? ` in "${filePath}"` : '';
	return new ConfigurationLoadError(
		`Invalid configuration${location}: expected a top-level object but received ${describeValue(value)}.`,
		{ filePath }
	);
}

export function invalidConfigurationValueError(
	reason: string,
	filePath?: string
): ConfigurationLoadError {
	const location = filePath ? ` in "${filePath}"` : '';
	return new ConfigurationLoadError(`Invalid configuration${location}: ${reason}.`, { filePath });
}
