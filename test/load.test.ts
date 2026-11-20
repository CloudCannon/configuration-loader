import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	ConfigurationError,
	ConfigurationLoadError,
	InvalidGlobPatternError,
} from '../src/errors.ts';
import { loadConfiguration } from '../src/load.ts';

// loadConfiguration does the base file read itself, so tests that mock parseFile
// still need a readable path. These tests never parse these contents.
const readableConfigPath = fileURLToPath(import.meta.url);

describe('loadConfiguration', () => {
	it('throws a ConfigurationLoadError when the config does not parse to an object', async () => {
		await assert.rejects(
			loadConfiguration(readableConfigPath, { parseFile: () => null }),
			(error: unknown) => {
				assert.ok(error instanceof ConfigurationLoadError);
				assert.equal(error.filePath, readableConfigPath);
				assert.match(error.message, /expected a top-level object but received null/);
				return true;
			}
		);
	});

	it('wraps a parse failure with the configuration file path', async () => {
		const parseError = new Error('bad json');

		await assert.rejects(
			loadConfiguration(readableConfigPath, {
				parseFile: () => {
					throw parseError;
				},
			}),
			(error: unknown) => {
				assert.ok(error instanceof ConfigurationLoadError);
				assert.equal(error.filePath, readableConfigPath);
				assert.equal(error.cause, parseError);
				assert.match(error.message, /Failed to parse configuration file/);
				return true;
			}
		);
	});

	it('throws an InvalidGlobPatternError for invalid glob patterns', async () => {
		const cases = [
			{ patterns: [123], reason: 'expected a string', pattern: 123 },
			{ patterns: [''], reason: 'cannot be empty', pattern: '' },
			{ patterns: ['foo\0bar'], reason: 'cannot contain NUL bytes', pattern: 'foo\0bar' },
		];

		for (const { patterns, reason, pattern } of cases) {
			await assert.rejects(
				loadConfiguration(readableConfigPath, {
					parseFile: () => ({ collections_config_from_glob: patterns }),
				}),
				(error: unknown) => {
					assert.ok(error instanceof ConfigurationError);
					assert.ok(error instanceof InvalidGlobPatternError);
					assert.equal(error.pattern, pattern);
					assert.equal(error.reason, reason);
					assert.equal(error.filePath, readableConfigPath);
					return true;
				}
			);
		}
	});

	it('ignores glob patterns outside the configuration directory', async () => {
		const result = await loadConfiguration(readableConfigPath, {
			parseFile: () => ({ collections_config_from_glob: ['../outside/*.json'] }),
		});

		assert.deepEqual(result.pathsToGlobKey, {});
	});

	it('wraps non-serializable configuration with the config path', async () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;

		await assert.rejects(
			loadConfiguration(readableConfigPath, { parseFile: () => circular }),
			(error: unknown) => {
				assert.ok(error instanceof ConfigurationLoadError);
				assert.equal(error.filePath, readableConfigPath);
				assert.match(error.message, /not JSON-serializable/);
				return true;
			}
		);
	});

	it('wraps a read failure with the configuration file path', async () => {
		const configPath = join(tmpdir(), `configuration-loader-missing-${randomUUID()}.json`);

		await assert.rejects(
			loadConfiguration(configPath, { parseFile: () => ({}) }),
			(error: unknown) => {
				assert.ok(error instanceof ConfigurationLoadError);
				assert.equal(error.filePath, configPath);
				assert.match(error.message, /Failed to read configuration file/);
				return true;
			}
		);
	});

	it('finds split configuration files', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'configuration-loader-'));

		try {
			await mkdir(join(dir, 'collections'), { recursive: true });
			await writeFile(
				join(dir, 'cloudcannon.config.json'),
				JSON.stringify({ collections_config_from_glob: ['/collections/*.json'] })
			);
			await writeFile(
				join(dir, 'collections', 'posts.json'),
				JSON.stringify({ posts: { path: 'content/posts' } })
			);
			await writeFile(
				join(dir, 'collections', 'pages.json'),
				JSON.stringify({ pages: { path: 'content/pages' } })
			);

			const result = await loadConfiguration(join(dir, 'cloudcannon.config.json'), {
				parseFile: (contents: string) => JSON.parse(contents),
			});

			assert.deepEqual(Object.keys(result.config.collections_config ?? {}).sort(), [
				'pages',
				'posts',
			]);
			assert.deepEqual(Object.keys(result.pathsToGlobKey).sort(), [
				join(dir, 'collections', 'pages.json'),
				join(dir, 'collections', 'posts.json'),
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
