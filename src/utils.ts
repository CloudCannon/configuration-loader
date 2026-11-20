export function isObject<T = unknown>(maybeObject?: unknown): maybeObject is Record<string, T> {
	return maybeObject !== null && typeof maybeObject === 'object' && !Array.isArray(maybeObject);
}

export function describeValue(value: unknown): string {
	if (value === null) {
		return 'null';
	}
	if (value === undefined) {
		return 'undefined';
	}
	if (Array.isArray(value)) {
		return 'an array';
	}
	return `a ${typeof value}`;
}
