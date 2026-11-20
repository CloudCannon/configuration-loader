import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Configuration } from '@cloudcannon/configuration-types';
import { ConfigurationLoadError, InvalidGlobPatternError } from '../src/errors.ts';
import { mergeConfiguration } from '../src/loader.ts';

describe('mergeConfiguration', () => {
	it('throws a ConfigurationLoadError when the config is not an object', async () => {
		const options = {
			findFilesMatchingGlobs: () => [],
			loadConfigFile: async () => ({}),
		};

		await assert.rejects(
			mergeConfiguration(null as unknown as Configuration, options),
			(error: unknown) => {
				assert.ok(error instanceof ConfigurationLoadError);
				assert.match(error.message, /expected a top-level object but received null/);
				return true;
			}
		);

		await assert.rejects(
			mergeConfiguration([] as unknown as Configuration, options),
			(error: unknown) => {
				assert.ok(error instanceof ConfigurationLoadError);
				assert.match(error.message, /expected a top-level object but received an array/);
				return true;
			}
		);
	});

	it('captures the config path in invalid glob pattern errors', async () => {
		const config = { _inputs_from_glob: [123] } as unknown as Configuration;

		await assert.rejects(
			mergeConfiguration(config, {
				configPath: '/site/cloudcannon.config.yml',
				findFilesMatchingGlobs: () => [],
				loadConfigFile: async () => ({}),
			}),
			(error: unknown) => {
				assert.ok(error instanceof InvalidGlobPatternError);
				assert.equal(error.filePath, '/site/cloudcannon.config.yml');
				assert.equal(error.pattern, 123);
				assert.equal(error.reason, 'expected a string');
				return true;
			}
		);
	});

	it('throws a ConfigurationLoadError when a glob target has the wrong shape', async () => {
		const cases = [
			{
				config: {
					_structures: {
						example: { values_from_glob: ['/.cloudcannon/structures/*.yml'], values: {} },
					},
				},
				message: /expected "values" to be an array/,
			},
			{
				config: {
					_structures: {
						example: { values_from_glob: ['/.cloudcannon/structures/*.yml'], values: 'abc' },
					},
				},
				message: /expected "values" to be an array/,
			},
			{
				config: {
					collections_config_from_glob: ['/.cloudcannon/collections/*.yml'],
					collections_config: 'abc',
				},
				message: /expected "collections_config" to be an object/,
			},
		];

		for (const { config, message } of cases) {
			await assert.rejects(
				mergeConfiguration(config as unknown as Configuration, {
					configPath: '/site/cloudcannon.config.yml',
					findFilesMatchingGlobs: () => [],
					loadConfigFile: async () => ({}),
				}),
				(error: unknown) => {
					assert.ok(error instanceof ConfigurationLoadError);
					assert.match(error.message, message);
					assert.equal(error.filePath, '/site/cloudcannon.config.yml');
					return true;
				}
			);
		}
	});

	it('throws a ConfigurationLoadError when the config is not JSON-serializable', async () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;

		await assert.rejects(
			mergeConfiguration(circular as unknown as Configuration, {
				configPath: '/site/cloudcannon.config.yml',
				findFilesMatchingGlobs: () => [],
				loadConfigFile: async () => ({}),
			}),
			(error: unknown) => {
				assert.ok(error instanceof ConfigurationLoadError);
				assert.equal(error.filePath, '/site/cloudcannon.config.yml');
				assert.match(error.message, /not JSON-serializable/);
				assert.ok(error.cause instanceof TypeError);
				return true;
			}
		);
	});

	it('does not wrap unexpected merge errors', async () => {
		const unexpectedError = new Error('boom');

		await assert.rejects(
			mergeConfiguration(
				{ collections_config_from_glob: ['/.cloudcannon/collections/*.yml'] },
				{
					findFilesMatchingGlobs: () => {
						throw unexpectedError;
					},
					loadConfigFile: async () => ({}),
				}
			),
			(error: unknown) => {
				assert.equal(error, unexpectedError);
				return true;
			}
		);
	});

	it('defines merged keys as own properties so __proto__ cannot pollute the result', async () => {
		const config: Configuration = {
			collections_config_from_glob: ['/.cloudcannon/collections/*.yml'],
		};
		const fileData = JSON.parse('{"__proto__":{"polluted":true}}');

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: () => ['/.cloudcannon/collections/evil.yml'],
			loadConfigFile: async () => fileData,
		});

		const collections = result.config.collections_config as Record<string, unknown>;
		assert.equal(Object.getPrototypeOf(collections), Object.prototype);
		assert.equal(collections.polluted, undefined);
		assert.deepEqual(Object.keys(collections), ['__proto__']);
		const descriptor = Object.getOwnPropertyDescriptor(collections, '__proto__');
		assert.equal(descriptor?.enumerable, true);
		assert.deepEqual(descriptor?.value, {
			polluted: true,
			__source__: '/.cloudcannon/collections/evil.yml',
		});
	});

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

	it('supports an async findFilesMatchingGlobs', async () => {
		const config: Configuration = {
			collections_config_from_glob: ['/.cloudcannon/collections/*.yml'],
		};

		const mockFiles: Record<string, unknown> = {
			'/.cloudcannon/collections/posts.yml': {
				posts: { path: 'content/posts' },
			},
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: async () => {
				await Promise.resolve();
				return Object.keys(mockFiles);
			},
			loadConfigFile: async (path: string) => mockFiles[path],
		});

		assert.equal(
			(result.config.collections_config as Record<string, { path?: string }>).posts?.path,
			'content/posts'
		);
	});

	it('does not mutate the array returned by findFilesMatchingGlobs', async () => {
		const config: Configuration = {
			collections_config_from_glob: ['/.cloudcannon/collections/*.yml'],
		};

		const returnedFiles = ['/.cloudcannon/collections/z.yml', '/.cloudcannon/collections/a.yml'];
		const mockFiles: Record<string, unknown> = {
			'/.cloudcannon/collections/a.yml': { a: { path: 'content/a' } },
			'/.cloudcannon/collections/z.yml': { z: { path: 'content/z' } },
		};

		await mergeConfiguration(config, {
			findFilesMatchingGlobs: () => returnedFiles,
			loadConfigFile: async (path: string) => mockFiles[path],
		});

		assert.deepEqual(returnedFiles, [
			'/.cloudcannon/collections/z.yml',
			'/.cloudcannon/collections/a.yml',
		]);
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

		const mockFiles: Record<string, unknown> = {
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

	it('merges editables from glob patterns', async () => {
		const config: Configuration = {
			_editables_from_glob: ['/.cloudcannon/editables/*.yml'],
		};

		const mockFiles: Record<string, unknown> = {
			'/.cloudcannon/editables/content.yml': {
				content: { bold: true, italic: true },
			},
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: () => Object.keys(mockFiles),
			loadConfigFile: async (path: string) => mockFiles[path],
		});

		assert.ok(result.config._editables);
		assert.ok('content' in result.config._editables);
	});

	it('processes _editables_from_glob inside a collection', async () => {
		const config: Configuration = {
			collections_config: {
				posts: {
					path: 'content/posts',
					_editables_from_glob: ['/.cloudcannon/editables/*.yml'],
				},
			},
		};

		const mockFiles: Record<string, unknown> = {
			'/.cloudcannon/editables/content.yml': {
				content: { bold: true },
			},
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: () => Object.keys(mockFiles),
			loadConfigFile: async (path: string) => mockFiles[path],
		});

		const posts = result.config.collections_config?.posts;
		assert.ok(posts?._editables);
		assert.ok('content' in posts._editables);
	});

	it('processes *_from_glob keys inside file_config entries', async () => {
		const config: Configuration = {
			file_config: [
				{
					glob: 'content/**/*.md',
					_inputs_from_glob: ['/.cloudcannon/inputs/*.yml'],
					_editables_from_glob: ['/.cloudcannon/editables/*.yml'],
					_structures_from_glob: ['/.cloudcannon/structures/*.yml'],
				},
			],
		};

		const mockFiles: Record<string, unknown> = {
			'/.cloudcannon/inputs/title.yml': {
				title: { type: 'text' },
			},
			'/.cloudcannon/editables/content.yml': {
				content: { bold: true },
			},
			'/.cloudcannon/structures/blocks.yml': {
				blocks: { values_from_glob: ['/.cloudcannon/structures/blocks/*.yml'] },
			},
			'/.cloudcannon/structures/blocks/hero.yml': {
				label: 'Hero',
				value: { _type: 'hero' },
			},
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: (patterns: string[]) =>
				Object.keys(mockFiles).filter((path) =>
					patterns.some((pattern) => {
						const prefix = pattern.replace(/\*\.yml$/, '');
						return path.startsWith(prefix) && !path.slice(prefix.length).includes('/');
					})
				),
			loadConfigFile: async (path: string) => mockFiles[path],
		});

		const entry = result.config.file_config?.[0];
		assert.ok(entry?._inputs);
		assert.ok('title' in entry._inputs);
		assert.ok(entry._editables);
		assert.ok('content' in entry._editables);
		assert.ok(entry._structures);
		assert.equal(entry._structures.blocks?.values?.length, 1);
		assert.equal(entry._structures.blocks?.values?.[0]?.label, 'Hero');
		assert.ok(
			result.globKeyToPaths.values_from_glob.has('/.cloudcannon/structures/blocks/hero.yml')
		);
	});

	it('processes _structures_from_glob inside a structure value', async () => {
		const config: Configuration = {
			_structures: {
				blocks: {
					values: [
						{
							label: 'Hero',
							value: { _type: 'hero', buttons: [] },
							_structures_from_glob: ['/.cloudcannon/structures/hero/*.yml'],
						},
					],
				},
			},
		};

		const mockFiles: Record<string, unknown> = {
			'/.cloudcannon/structures/hero/buttons.yml': {
				buttons: { values_from_glob: ['/.cloudcannon/structures/hero/buttons/*.yml'] },
			},
			'/.cloudcannon/structures/hero/buttons/primary.yml': {
				label: 'Primary',
				value: { style: 'primary' },
			},
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: (patterns: string[]) =>
				Object.keys(mockFiles).filter((path) =>
					patterns.some((pattern) => {
						const prefix = pattern.replace(/\*\.yml$/, '');
						return path.startsWith(prefix) && !path.slice(prefix.length).includes('/');
					})
				),
			loadConfigFile: async (path: string) => mockFiles[path],
		});

		const hero = result.config._structures?.blocks?.values?.[0];
		assert.ok(hero);
		assert.equal('_structures_from_glob' in hero, false);
		assert.ok(hero._structures);
		assert.equal(hero._structures.buttons?.values?.length, 1);
		assert.equal(hero._structures.buttons?.values?.[0]?.label, 'Primary');
		assert.ok(
			result.globKeyToPaths.values_from_glob.has(
				'/.cloudcannon/structures/hero/buttons/primary.yml'
			)
		);
	});

	it('processes *_from_glob keys inside _snippets_templates entries', async () => {
		const config: Configuration = {
			_snippets_templates: {
				base: {
					template: 'hugo_shortcode',
					_inputs_from_glob: ['/.cloudcannon/inputs/*.yml'],
					_structures_from_glob: ['/.cloudcannon/structures/*.yml'],
				},
			},
		};

		const mockFiles: Record<string, unknown> = {
			'/.cloudcannon/inputs/title.yml': {
				title: { type: 'text' },
			},
			'/.cloudcannon/structures/blocks.yml': {
				blocks: { values_from_glob: ['/.cloudcannon/structures/blocks/*.yml'] },
			},
			'/.cloudcannon/structures/blocks/hero.yml': {
				label: 'Hero',
				value: { _type: 'hero' },
			},
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: (patterns: string[]) =>
				Object.keys(mockFiles).filter((path) =>
					patterns.some((pattern) => {
						const prefix = pattern.replace(/\*\.yml$/, '');
						return path.startsWith(prefix) && !path.slice(prefix.length).includes('/');
					})
				),
			loadConfigFile: async (path: string) => mockFiles[path],
		});

		const template = result.config._snippets_templates?.base;
		assert.ok(template?._inputs);
		assert.ok('title' in template._inputs);
		assert.ok(template._structures);
		assert.equal(template._structures.blocks?.values?.length, 1);
		assert.equal(template._structures.blocks?.values?.[0]?.label, 'Hero');
	});

	it('processes _inputs_from_glob inside a collection create', async () => {
		const config: Configuration = {
			collections_config: {
				posts: {
					path: 'content/posts',
					create: {
						path: '[collections_config.posts.path]/[slug].[ext]',
						_inputs_from_glob: ['/.cloudcannon/inputs/*.yml'],
					},
				},
			},
		};

		const mockFiles: Record<string, unknown> = {
			'/.cloudcannon/inputs/title.yml': {
				title: { type: 'text' },
			},
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: () => Object.keys(mockFiles),
			loadConfigFile: async (path: string) => mockFiles[path],
		});

		const create = result.config.collections_config?.posts?.create;
		assert.ok(create?._inputs);
		assert.ok('title' in create._inputs);
	});

	it('processes _inputs_from_glob inside a schema create', async () => {
		const config: Configuration = {
			collections_config: {
				posts: {
					path: 'content/posts',
					schemas: {
						default: {
							path: 'schemas/default.md',
							create: {
								path: '[collections_config.posts.path]/[slug].[ext]',
								_inputs_from_glob: ['/.cloudcannon/inputs/*.yml'],
							},
						},
					},
				},
			},
		};

		const mockFiles: Record<string, unknown> = {
			'/.cloudcannon/inputs/title.yml': {
				title: { type: 'text' },
			},
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: () => Object.keys(mockFiles),
			loadConfigFile: async (path: string) => mockFiles[path],
		});

		const create = result.config.collections_config?.posts?.schemas?.default?.create;
		assert.ok(create?._inputs);
		assert.ok('title' in create._inputs);
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

		const postsConfig = result.config.collections_config?.posts;
		assert.ok(postsConfig?.schemas);
		assert.ok(postsConfig.schemas.default);
	});

	it('processes values_from_glob in options.entries.structures for mutable objects', async () => {
		const config: Configuration = {
			_inputs: {
				settings: {
					type: 'object',
					options: {
						subtype: 'mutable',
						entries: {
							structures: {
								values_from_glob: ['/.cloudcannon/structures/entries/*.yml'],
							},
						},
					},
				},
			},
		};

		const mockFiles: Record<string, unknown> = {
			'/.cloudcannon/structures/entries/text.yml': {
				label: 'Text',
				value: { _type: 'text' },
			},
		};

		const result = await mergeConfiguration(config, {
			findFilesMatchingGlobs: () => Object.keys(mockFiles),
			loadConfigFile: async (path: string) => mockFiles[path],
		});

		const settings = result.config._inputs?.settings as Record<string, unknown>;
		const options = settings.options as Record<string, unknown>;
		const entries = options.entries as Record<string, unknown>;
		const structures = entries.structures as Record<string, unknown>;
		assert.equal((structures.values as unknown[]).length, 1);
		assert.ok(
			result.globKeyToPaths.values_from_glob.has('/.cloudcannon/structures/entries/text.yml')
		);
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

			const mockFiles: Record<string, unknown> = {
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

			const mockFiles: Record<string, unknown> = {
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

			const mockFiles: Record<string, unknown> = {
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
