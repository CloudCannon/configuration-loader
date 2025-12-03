import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Configuration } from '@cloudcannon/configuration-types';
import { mergeConfiguration } from './loader.ts';

describe('mergeConfiguration', () => {
	it('returns config unchanged when no glob keys present', async () => {
		const config: Configuration = {
			collections_config: {
				posts: { path: 'content/posts' },
			},
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: () => [],
			loadConfigFile: async () => ({}),
		});

		assert.deepEqual(result.config.collections_config, {
			posts: { path: 'content/posts' },
		});
		assert.deepEqual(result.warnings.cycles, []);
		assert.deepEqual(result.warnings.multipleGlobKeys, []);
		assert.deepEqual(result.warnings.arrayValues, []);
	});

	it('merges collections from glob patterns', async () => {
		const config: Configuration = {
			collections_config_from_glob: ['/.cloudcannon/collections/*.yml'],
		};

		const mockFiles: Record<string, unknown> = {
			'/.cloudcannon/collections/posts.yml': {
				posts: { path: 'content/posts', icon: 'event' },
			},
			'/.cloudcannon/collections/pages.yml': {
				pages: { path: 'content/pages', icon: 'wysiwyg' },
			},
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: () => Object.keys(mockFiles),
			loadConfigFile: async (path: string) => mockFiles[path],
		});

		assert.ok(result.config.collections_config);
		assert.equal(Object.keys(result.config.collections_config).length, 2);
		assert.equal(
			(result.config.collections_config as Record<string, { path?: string }>).posts?.path,
			'content/posts'
		);
		assert.equal(
			(result.config.collections_config as Record<string, { path?: string }>).pages?.path,
			'content/pages'
		);
	});

	it('merges inputs from glob patterns', async () => {
		const config: Configuration = {
			_inputs_from_glob: ['/.cloudcannon/inputs/*.yml'],
		};

		const mockFiles: Record<string, unknown> = {
			'/.cloudcannon/inputs/seo.yml': {
				title: { type: 'text', label: 'Page Title' },
				description: { type: 'textarea', label: 'Meta Description' },
			},
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: () => Object.keys(mockFiles),
			loadConfigFile: async (path: string) => mockFiles[path],
		});

		assert.ok(result.config._inputs);
		assert.ok('title' in result.config._inputs);
		assert.ok('description' in result.config._inputs);
	});

	it('tracks glob patterns for change detection', async () => {
		const config: Configuration = {
			collections_config_from_glob: ['/.cloudcannon/collections/*.yml'],
			_inputs_from_glob: ['/.cloudcannon/inputs/*.yml'],
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: () => [],
			loadConfigFile: async () => ({}),
		});

		assert.deepEqual(
			result.globPatterns.sort(),
			['/.cloudcannon/collections/*.yml', '/.cloudcannon/inputs/*.yml'].sort()
		);
	});

	it('excludes negation patterns from tracked glob patterns', async () => {
		const config: Configuration = {
			collections_config_from_glob: [
				'/.cloudcannon/collections/*.yml',
				'!/.cloudcannon/collections/draft.yml',
			],
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: () => [],
			loadConfigFile: async () => ({}),
		});

		assert.deepEqual(result.globPatterns, ['/.cloudcannon/collections/*.yml']);
	});

	it('warns about array values in config files', async () => {
		const config: Configuration = {
			collections_config_from_glob: ['/.cloudcannon/collections/*.yml'],
		};

		const mockFiles: Record<string, unknown> = {
			'/.cloudcannon/collections/invalid.yml': [{ posts: { path: 'content/posts' } }],
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: () => Object.keys(mockFiles),
			loadConfigFile: async (path: string) => mockFiles[path],
		});

		assert.equal(result.warnings.arrayValues.length, 1);
		assert.equal(result.warnings.arrayValues[0]?.path, '/.cloudcannon/collections/invalid.yml');
	});

	it('warns when same file matches multiple glob types', async () => {
		const config: Configuration = {
			collections_config_from_glob: ['/.cloudcannon/*.yml'],
			_inputs_from_glob: ['/.cloudcannon/*.yml'],
		};

		const mockFiles = {
			'/.cloudcannon/config.yml': { test: { type: 'text' } },
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: () => Object.keys(mockFiles),
			loadConfigFile: async (path: string) => mockFiles[path],
		});

		assert.equal(result.warnings.multipleGlobKeys.length, 1);
		assert.equal(result.warnings.multipleGlobKeys[0]?.path, '/.cloudcannon/config.yml');
	});

	it('adds __source__ metadata to merged objects', async () => {
		const config: Configuration = {
			_inputs_from_glob: ['/.cloudcannon/inputs/*.yml'],
		};

		const mockFiles: Record<string, unknown> = {
			'/.cloudcannon/inputs/seo.yml': {
				title: { type: 'text' },
			},
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: () => Object.keys(mockFiles),
			loadConfigFile: async (path: string) => mockFiles[path],
		});

		assert.ok(result.config._inputs);
		const titleInput = result.config._inputs.title as Record<string, unknown>;
		assert.equal(titleInput.__source__, '/.cloudcannon/inputs/seo.yml');
	});

	it('tracks paths to glob keys for reverse lookup', async () => {
		const config: Configuration = {
			collections_config_from_glob: ['/.cloudcannon/collections/*.yml'],
		};

		const mockFiles: Record<string, unknown> = {
			'/.cloudcannon/collections/posts.yml': {
				posts: { path: 'content/posts' },
			},
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: () => Object.keys(mockFiles),
			loadConfigFile: async (path: string) => mockFiles[path],
		});

		assert.equal(
			result.pathsToGlobKey['/.cloudcannon/collections/posts.yml'],
			'collections_config_from_glob'
		);
		assert.ok(
			result.globKeyToPaths.collections_config_from_glob.has('/.cloudcannon/collections/posts.yml')
		);
	});

	it('does not mutate the original config', async () => {
		const config: Configuration = {
			collections_config: {
				existing: { path: 'content/existing' },
			},
			collections_config_from_glob: ['/.cloudcannon/collections/*.yml'],
		};

		const originalConfigString = JSON.stringify(config);

		await mergeConfiguration(config, {
			findFilesMatchingGlobs: () => ['/.cloudcannon/collections/posts.yml'],
			loadConfigFile: async () => ({ posts: { path: 'content/posts' } }),
		});

		assert.equal(JSON.stringify(config), originalConfigString);
	});

	it('processes nested schemas_from_glob in collections', async () => {
		const config: Configuration = {
			collections_config: {
				posts: {
					path: 'content/posts',
					schemas_from_glob: ['/.cloudcannon/schemas/posts/*.yml'],
				},
			},
		};

		const mockFiles: Record<string, unknown> = {
			'/.cloudcannon/schemas/posts/default.yml': {
				default: { path: 'schemas/posts/default.md' },
			},
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: () => Object.keys(mockFiles),
			loadConfigFile: async (path: string) => mockFiles[path],
		});

		const postsConfig = result.config.collections_config?.posts as Record<string, unknown>;
		assert.ok(postsConfig?.schemas);
		assert.ok((postsConfig.schemas as Record<string, unknown>).default);
	});

	it('handles file load errors gracefully', async () => {
		const config: Configuration = {
			_inputs_from_glob: ['/.cloudcannon/inputs/*.yml'],
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: () => ['/.cloudcannon/inputs/broken.yml'],
			loadConfigFile: async () => {
				throw new Error('File not found');
			},
		});

		// Should not throw and should return empty inputs
		assert.ok(result.config);
		assert.deepEqual(result.warnings.cycles, []);
	});
});

describe('GlobResult types', () => {
	it('has correct structure', async () => {
		const result = await mergeConfiguration(
			{},
			{
				findFilesMatchingGlobs: () => [],
				loadConfigFile: async () => ({}),
			}
		);

		// Type checking - these assertions verify the shape
		assert.ok('config' in result);
		assert.ok('warnings' in result);
		assert.ok('globPatterns' in result);
		assert.ok('pathsToGlobKey' in result);
		assert.ok('globKeyToPaths' in result);

		// Verify warnings structure
		assert.ok(Array.isArray(result.warnings.cycles));
		assert.ok(Array.isArray(result.warnings.multipleGlobKeys));
		assert.ok(Array.isArray(result.warnings.arrayValues));
	});
});

describe('warnings', () => {
	describe('cycles', () => {
		it('warns when a structure value references a file already in the chain', async () => {
			// Structure values loaded via values_from_glob can have _inputs
			// If those _inputs have nested structures with values_from_glob
			// that reference the same file, a cycle is detected
			const config: Configuration = {
				_structures: {
					blocks: {
						values_from_glob: ['/.cloudcannon/structures/*.yml'],
					},
				},
			};

			// The structure value file contains an object that will be added to values[]
			// It has _inputs with a nested structure that references the same file
			const mockFiles: Record<string, unknown> = {
				'/.cloudcannon/structures/hero.yml': {
					label: 'Hero',
					_inputs: {
						nested_blocks: {
							type: 'array',
							options: {
								structures: {
									// This creates a cycle - the same file is already being processed
									values_from_glob: ['/.cloudcannon/structures/*.yml'],
								},
							},
						},
					},
				},
			};

			const result = await mergeConfiguration(config, {
				findFilesMatchingGlobs: () => Object.keys(mockFiles),
				loadConfigFile: async (path: string) => mockFiles[path],
			});

			assert.equal(result.warnings.cycles.length, 1);
			assert.equal(result.warnings.cycles[0]?.path, '/.cloudcannon/structures/hero.yml');
			assert.ok(Array.isArray(result.warnings.cycles[0]?.chain));
		});

		it('includes the reference chain in cycle warnings', async () => {
			const config: Configuration = {
				_structures: {
					blocks: {
						values_from_glob: ['/.cloudcannon/structures/a.yml'],
					},
				},
			};

			const mockFiles: Record<string, unknown> = {
				'/.cloudcannon/structures/a.yml': {
					label: 'Block A',
					_inputs: {
						nested: {
							type: 'array',
							options: {
								structures: {
									values_from_glob: ['/.cloudcannon/structures/a.yml'],
								},
							},
						},
					},
				},
			};

			const result = await mergeConfiguration(config, {
				findFilesMatchingGlobs: () => ['/.cloudcannon/structures/a.yml'],
				loadConfigFile: async (path: string) => mockFiles[path],
			});

			assert.equal(result.warnings.cycles.length, 1);
			assert.ok(result.warnings.cycles[0]?.chain.includes('/.cloudcannon/structures/a.yml'));
		});

		it('does not warn when different files reference each other without cycles', async () => {
			const config: Configuration = {
				_structures: {
					blocks: {
						values_from_glob: ['/.cloudcannon/structures/a.yml'],
					},
				},
			};

			const mockFiles: Record<string, unknown> = {
				'/.cloudcannon/structures/a.yml': {
					label: 'Block A',
					_inputs: {
						nested: {
							type: 'array',
							options: {
								structures: {
									// References a different file - no cycle
									values_from_glob: ['/.cloudcannon/structures/b.yml'],
								},
							},
						},
					},
				},
				'/.cloudcannon/structures/b.yml': {
					label: 'Block B',
				},
			};

			const result = await mergeConfiguration(config, {
				findFilesMatchingGlobs: (globs: string[]) => {
					if (globs.includes('/.cloudcannon/structures/a.yml')) {
						return ['/.cloudcannon/structures/a.yml'];
					}
					if (globs.includes('/.cloudcannon/structures/b.yml')) {
						return ['/.cloudcannon/structures/b.yml'];
					}
					return [];
				},
				loadConfigFile: async (path: string) => mockFiles[path],
			});

			assert.equal(result.warnings.cycles.length, 0);
		});
	});

	describe('multipleGlobKeys', () => {
		it('warns when a file is matched by different glob key types', async () => {
			const config: Configuration = {
				collections_config_from_glob: ['/.cloudcannon/shared/*.yml'],
				_inputs_from_glob: ['/.cloudcannon/shared/*.yml'],
			};

			const mockFiles = {
				'/.cloudcannon/shared/config.yml': { test: { type: 'text' } },
			};

			const result = await mergeConfiguration(config, {
				findFilesMatchingGlobs: () => Object.keys(mockFiles),
				loadConfigFile: async (path: string) => mockFiles[path],
			});

			assert.equal(result.warnings.multipleGlobKeys.length, 1);
			assert.equal(result.warnings.multipleGlobKeys[0]?.path, '/.cloudcannon/shared/config.yml');
			assert.equal(result.warnings.multipleGlobKeys[0]?.type1, 'collections_config_from_glob');
			assert.equal(result.warnings.multipleGlobKeys[0]?.type2, '_inputs_from_glob');
		});

		it('does not warn when same file is matched by same glob key type multiple times', async () => {
			const config: Configuration = {
				_inputs_from_glob: ['/.cloudcannon/inputs/*.yml', '/.cloudcannon/inputs/seo.yml'],
			};

			const mockFiles = {
				'/.cloudcannon/inputs/seo.yml': { title: { type: 'text' } },
			};

			const result = await mergeConfiguration(config, {
				findFilesMatchingGlobs: () => ['/.cloudcannon/inputs/seo.yml'],
				loadConfigFile: async (path: string) => mockFiles[path],
			});

			assert.equal(result.warnings.multipleGlobKeys.length, 0);
		});

		it('skips file processing after multipleGlobKeys warning', async () => {
			const config: Configuration = {
				collections_config_from_glob: ['/.cloudcannon/shared/*.yml'],
				_inputs_from_glob: ['/.cloudcannon/shared/*.yml'],
			};

			const mockFiles = {
				'/.cloudcannon/shared/config.yml': { posts: { path: 'content/posts' } },
			};

			const result = await mergeConfiguration(config, {
				findFilesMatchingGlobs: () => Object.keys(mockFiles),
				loadConfigFile: async (path: string) => mockFiles[path],
			});

			// File should only be processed for the first glob key type
			assert.ok(result.config.collections_config);
			assert.ok((result.config.collections_config as Record<string, unknown>).posts);
			// Should not be added to _inputs since it was already matched
			assert.ok(!result.config._inputs?.posts);
		});
	});

	describe('arrayValues', () => {
		it('warns when a config file contains an array instead of an object', async () => {
			const config: Configuration = {
				collections_config_from_glob: ['/.cloudcannon/collections/*.yml'],
			};

			const mockFiles: Record<string, unknown> = {
				'/.cloudcannon/collections/invalid.yml': [
					{ posts: { path: 'content/posts' } },
					{ pages: { path: 'content/pages' } },
				],
			};

			const result = await mergeConfiguration(config, {
				findFilesMatchingGlobs: () => Object.keys(mockFiles),
				loadConfigFile: async (path: string) => mockFiles[path],
			});

			assert.equal(result.warnings.arrayValues.length, 1);
			assert.equal(result.warnings.arrayValues[0]?.path, '/.cloudcannon/collections/invalid.yml');
		});

		it('does not merge array config files into the result', async () => {
			const config: Configuration = {
				_inputs_from_glob: ['/.cloudcannon/inputs/*.yml'],
			};

			const mockFiles: Record<string, unknown> = {
				'/.cloudcannon/inputs/invalid.yml': [{ title: { type: 'text' } }],
				'/.cloudcannon/inputs/valid.yml': { description: { type: 'textarea' } },
			};

			const result = await mergeConfiguration(config, {
				findFilesMatchingGlobs: () => Object.keys(mockFiles),
				loadConfigFile: async (path: string) => mockFiles[path],
			});

			// Valid file should be merged
			assert.ok(result.config._inputs?.description);
			// Invalid array file should be skipped (title would be in array[0].title)
			assert.ok(!result.config._inputs?.title);
		});

		it('warns for multiple array config files', async () => {
			const config: Configuration = {
				collections_config_from_glob: ['/.cloudcannon/collections/*.yml'],
			};

			const mockFiles: Record<string, unknown> = {
				'/.cloudcannon/collections/invalid1.yml': [{ a: 1 }],
				'/.cloudcannon/collections/invalid2.yml': [{ b: 2 }],
			};

			const result = await mergeConfiguration(config, {
				findFilesMatchingGlobs: () => Object.keys(mockFiles),
				loadConfigFile: async (path: string) => mockFiles[path],
			});

			assert.equal(result.warnings.arrayValues.length, 2);
		});
	});
});
