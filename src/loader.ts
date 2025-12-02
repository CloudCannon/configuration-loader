import type { Configuration, StructureValue } from '@cloudcannon/configuration-types';
import type {
	GlobLoaderWarnings,
	GlobResult,
	GlobTypeKey,
	MergeConfigurationOptions,
} from './types.ts';

export type { GlobLoaderWarnings, GlobResult, GlobTypeKey, MergeConfigurationOptions };

function isObject<T = unknown>(maybeObject?: unknown): maybeObject is Record<string, T> {
	return maybeObject !== null && typeof maybeObject === 'object' && !Array.isArray(maybeObject);
}

class ConfigurationLoader {
	warnings: GlobLoaderWarnings;
	pathsToGlobKey: Record<string, GlobTypeKey> = {};
	globKeyToPaths: Record<GlobTypeKey, Set<string>> = {
		_structures_from_glob: new Set(),
		values_from_glob: new Set(),
		_snippets_from_glob: new Set(),
		_snippets_imports_from_glob: new Set(),
		_snippets_templates_from_glob: new Set(),
		_snippets_definitions_from_glob: new Set(),
		_inputs_from_glob: new Set(),
		_editables_from_glob: new Set(),
		collections_config_from_glob: new Set(),
		schemas_from_glob: new Set(),
	};

	globPatterns: Set<string>;

	findFilesMatchingGlobs: (globs: string[]) => string[];
	loadConfigFile: (filePath: string) => Promise<unknown>;

	constructor(
		findFilesMatchingGlobs: (globs: string[]) => string[],
		loadConfigFile: (filePath: string) => Promise<unknown>,
	) {
		this.warnings = {
			cycles: [],
			multipleGlobKeys: [],
			arrayValues: [],
		};
		this.globPatterns = new Set();
		this.findFilesMatchingGlobs = findFilesMatchingGlobs;
		this.loadConfigFile = loadConfigFile;
	}

	/**
	 * Loads and merges configuration from files matching glob patterns.
	 * Processes all *_from_glob keys in the configuration.
	 * Recursively processes globs in loaded files as well.
	 * Also extracts glob patterns from loaded files for change detection.
	 */
	public async mergeConfiguration(config: Configuration): Promise<Configuration> {
		this.warnings = {
			cycles: [],
			multipleGlobKeys: [],
			arrayValues: [],
		};
		this.globPatterns.clear();

		// Process root-level glob keys in the correct order
		await this.importFromGlobKey(config, '_snippets_from_glob', '_snippets', false);
		await this.importFromGlobKey(config, '_snippets_imports_from_glob', '_snippets_imports', false);
		await this.importFromGlobKey(
			config,
			'_snippets_templates_from_glob',
			'_snippets_templates',
			false,
		);
		await this.importFromGlobKey(
			config,
			'_snippets_definitions_from_glob',
			'_snippets_definitions',
			false,
		);
		await this.importFromGlobKey(
			config,
			'collections_config_from_glob',
			'collections_config',
			false,
		);
		await this.importFromGlobKey(config, '_inputs_from_glob', '_inputs', false);
		await this.importFromGlobKey(config, '_structures_from_glob', '_structures', false);

		await this.processInputsKey(config._inputs);
		await this.processStructuresKey(config._structures);

		// Process nested globs in collections_config
		// Collections can have: schemas_from_glob, _inputs_from_glob, _structures_from_glob
		if (config.collections_config && isObject(config.collections_config)) {
			for (const [collectionKey, collectionConfig] of Object.entries(config.collections_config)) {
				if (isObject(collectionConfig)) {
					// Process schemas_from_glob (first in collections)
					if ('schemas_from_glob' in collectionConfig) {
						await this.importFromGlobKey(collectionConfig, 'schemas_from_glob', 'schemas', false);
					}

					const collection = (config.collections_config as Record<string, unknown>)[collectionKey];
					await this.importFromGlobKey(
						collection as Record<string, unknown>,
						'_inputs_from_glob',
						'_inputs',
						false,
					);
					await this.importFromGlobKey(
						collection as Record<string, unknown>,
						'_structures_from_glob',
						'_structures',
						false,
					);

					await this.processInputsKey(
						(collection as Record<string, unknown>)._inputs as Configuration['_inputs'],
					);
					await this.processStructuresKey(
						(collection as Record<string, unknown>)._structures as Configuration['_structures'],
					);

					// Process recursive globs in schemas
					if (isObject((collection as Record<string, unknown>).schemas)) {
						for (const schemaValue of Object.values(
							(collection as Record<string, unknown>).schemas as Record<string, unknown>,
						)) {
							if (isObject(schemaValue)) {
								await this.importFromGlobKey(schemaValue, '_inputs_from_glob', '_inputs', false);
								await this.importFromGlobKey(
									schemaValue,
									'_structures_from_glob',
									'_structures',
									false,
								);

								await this.processInputsKey(schemaValue._inputs as Configuration['_inputs']);
								await this.processStructuresKey(
									schemaValue._structures as Configuration['_structures'],
								);
							}
						}
					}
				}
			}
		}

		// Process recursive globs in _snippets (can have _inputs_from_glob)
		if (config._snippets && isObject(config._snippets)) {
			await this.importFromGlobKey(config._snippets, '_inputs_from_glob', '_inputs', false);

			for (const snippetConfig of Object.values(config._snippets)) {
				if (isObject(snippetConfig)) {
					await this.importFromGlobKey(snippetConfig, '_inputs_from_glob', '_inputs', false);
					await this.importFromGlobKey(
						snippetConfig,
						'_structures_from_glob',
						'_structures',
						false,
					);

					await this.processInputsKey(snippetConfig._inputs as Configuration['_inputs']);
					await this.processStructuresKey(
						snippetConfig._structures as Configuration['_structures'],
					);
				}
			}
		}

		return config;
	}

	/*
	 * Process recursive globs in _inputs (can have _structures_from_glob)
	 * @param inputs - The _inputs key to process
	 * @returns A promise that resolves when the inputs key has been processed
	 */
	private async processInputsKey(
		inputs: Configuration['_inputs'],
		visited?: Set<string>,
	): Promise<void> {
		if (inputs && isObject(inputs)) {
			for (const inputValue of Object.values(inputs)) {
				if (isObject(inputValue) && isObject((inputValue as Record<string, unknown>).options)) {
					const structures = (
						(inputValue as Record<string, unknown>).options as Record<string, unknown>
					)?.structures;
					const visitedLocal = visited || new Set<string>();

					if (structures && isObject(structures)) {
						if (structures.values_from_glob) {
							await this.importFromGlobKey(
								structures,
								'values_from_glob',
								'values',
								true,
								visitedLocal,
							);
						}

						if (Array.isArray(structures.values)) {
							await Promise.all(
								structures.values.map(async (value: StructureValue) =>
									this.processStructureValue(value, visitedLocal),
								),
							);
						}
					}
				}
			}
		}
	}

	private async processStructuresKey(
		structures: Configuration['_structures'],
		visited?: Set<string>,
	): Promise<void> {
		if (!structures || !isObject(structures)) {
			return;
		}

		await Promise.all(
			Object.values(structures).map(async (structure) => {
				if (!isObject(structure)) {
					return;
				}
				const visitedLocal = visited || new Set<string>();

				await this.importFromGlobKey(structure, 'values_from_glob', 'values', true, visitedLocal);

				if (structure.values && Array.isArray(structure.values)) {
					await Promise.all(
						structure.values.map(async (value) =>
							this.processStructureValue(value as StructureValue, visitedLocal),
						),
					);
				}
			}),
		);
	}

	private async processStructureValue(
		structureValue: StructureValue,
		visited: Set<string>,
	): Promise<void> {
		if (!structureValue || !isObject(structureValue)) {
			return;
		}

		if ((structureValue as Record<string, unknown>)._inputs_from_glob) {
			await this.importFromGlobKey(
				structureValue as Record<string, unknown>,
				'_inputs_from_glob',
				'_inputs',
				false,
				visited,
			);
		}

		if (structureValue._inputs) {
			await this.processInputsKey(structureValue._inputs, visited);
		}
	}

	/**
	 * Processes a glob key by loading files and merging them with the target key.
	 * Supports recursive processing with cycle detection.
	 */
	private async importFromGlobKey(
		config: Record<string, unknown>,
		globKey: GlobTypeKey,
		targetKey: string,
		isArray: boolean,
		visited?: Set<string>,
	): Promise<void> {
		const globs = config[globKey];

		if (!Array.isArray(globs)) {
			return;
		}

		globs.forEach((pattern) => {
			if (typeof pattern === 'string' && !pattern.startsWith('!')) {
				this.globPatterns.add(pattern);
			}
		});
		const loadedDataWithSources = await this.loadFilesFromGlobs(
			globs as string[],
			globKey,
			visited,
		);

		if (isArray) {
			config[targetKey] = this.mergeArrayValues(
				(config[targetKey] || []) as unknown[],
				loadedDataWithSources,
			);
		} else {
			config[targetKey] = this.mergeObjectValues(
				(config[targetKey] || {}) as Record<string, unknown>,
				loadedDataWithSources,
			);
		}

		delete config[globKey];
	}

	/**
	 * Loads configuration data from files matching the given glob patterns.
	 * Returns an array of parsed configuration objects with source tracking.
	 */
	private async loadFilesFromGlobs(
		globs: string[],
		globKey: GlobTypeKey,
		visited?: Set<string>,
	): Promise<Array<{ data: unknown; source: string }>> {
		const matchingFiles = this.findFilesMatchingGlobs(globs);
		// Sort by path to ensure consistent ordering
		matchingFiles.sort((a, b) => a.localeCompare(b));
		const loadedData: Array<{ data: unknown; source: string }> = [];

		for (const filePath of matchingFiles) {
			if (visited?.has(filePath)) {
				this.warnings.cycles.push({
					path: filePath,
					chain: Array.from(visited),
				});
				continue;
			}

			const existingGlobKey = this.pathsToGlobKey[filePath];
			if (existingGlobKey && existingGlobKey !== globKey) {
				this.warnings.multipleGlobKeys.push({
					path: filePath,
					type1: existingGlobKey,
					type2: globKey,
				});
				continue;
			}

			this.pathsToGlobKey[filePath] = globKey;
			this.globKeyToPaths[globKey].add(filePath);

			visited?.add(filePath);

			try {
				const data = await this.loadConfigFile(filePath);

				if (data !== undefined && data !== null) {
					const clonedData = JSON.parse(JSON.stringify(data)) as unknown;
					// Handle both single objects and arrays

					if (Array.isArray(clonedData)) {
						this.warnings.arrayValues.push({
							path: filePath,
						});
					} else {
						loadedData.push({ data: clonedData, source: filePath });
					}
				}
			} catch {
				// Log error but continue processing other files
			}
		}

		return loadedData;
	}

	/**
	 * Merges object values from globbed files.
	 * Later files overwrite earlier ones for the same keys.
	 * Adds __source__ metadata to track where each key came from.
	 */
	private mergeObjectValues(
		base: Record<string, unknown>,
		loaded: Array<{ data: unknown; source: string }>,
	): Record<string, unknown> {
		const result = { ...base };

		for (const { data: item, source } of loaded) {
			if (isObject(item)) {
				// For objects, merge keys (later overwrites earlier)
				// Add __source__ to each key that gets added/overwritten
				for (const [key, value] of Object.entries(item)) {
					if (isObject(value)) {
						// Add __source__ to nested objects (e.g., input definitions, schema configs)
						result[key] = {
							...value,
							__source__: source,
						};
					} else {
						// For primitive values, just assign the value
						// The source is tracked at the key level via __sources__ if needed
						result[key] = value;
					}
				}
			}
		}

		return result;
	}

	/**
	 * Merges array values from globbed files.
	 * Arrays are appended (no overwriting since arrays aren't keyed).
	 * Adds __source__ metadata to track where each item came from.
	 */
	private mergeArrayValues(
		base: unknown[],
		loaded: Array<{ data: unknown; source: string }>,
	): unknown[] {
		const result = [...base];

		for (const { data: item, source } of loaded) {
			if (Array.isArray(item)) {
				// If the loaded item is an array, add source to each element
				for (const element of item) {
					if (isObject(element)) {
						result.push({
							...element,
							__source__: source,
						});
					} else {
						// Otherwise, add it as a single item
						// This cannot be tracked with __source__ since it's not an object
						result.push(element);
					}
				}
			} else if (isObject(item)) {
				// Add __source__ to object items
				result.push({
					...item,
					__source__: source,
				});
			} else {
				// Otherwise, add it as a single item
				// This cannot be tracked with __source__ since it's not an object
				result.push(item);
			}
		}

		return result;
	}
}

function removeDuplicateWarnings(warnings: GlobLoaderWarnings): GlobLoaderWarnings {
	const result: GlobLoaderWarnings = {
		cycles: [],
		multipleGlobKeys: [],
		arrayValues: [],
	};

	for (const warning of warnings.cycles) {
		if (
			!result.cycles.some(
				(w) => w.path === warning.path && w.chain.join(' → ') === warning.chain.join(' → '),
			)
		) {
			result.cycles.push(warning);
		}
	}

	for (const warning of warnings.multipleGlobKeys) {
		if (
			!result.multipleGlobKeys.some(
				(w) => w.path === warning.path && w.type1 === warning.type1 && w.type2 === warning.type2,
			)
		) {
			result.multipleGlobKeys.push(warning);
		}
	}

	for (const warning of warnings.arrayValues) {
		if (!result.arrayValues.some((w) => w.path === warning.path)) {
			result.arrayValues.push(warning);
		}
	}

	return result;
}

/**
 * Merges split CloudCannon configuration files into a single configuration object.
 *
 * This function processes `*_from_glob` keys in the configuration, loading and merging
 * configuration from files matching the specified glob patterns. This allows you to
 * split your CloudCannon configuration across multiple files for better organization.
 *
 * @param config - The base CloudCannon configuration object
 * @param options - Options for loading configuration files
 * @returns A promise resolving to the merged configuration with metadata
 *
 * @example
 * ```typescript
 * import { mergeConfiguration } from '@cloudcannon/configuration-loader';
 * import { globSync } from 'glob';
 * import { readFileSync } from 'fs';
 * import YAML from 'yaml';
 *
 * const baseConfig = YAML.parse(readFileSync('cloudcannon.config.yml', 'utf8'));
 *
 * const result = await mergeConfiguration(baseConfig, {
 *   findFilesMatchingGlobs: (globs) => globSync(globs, { ignore: globs.filter(g => g.startsWith('!')).map(g => g.slice(1)) }),
 *   loadConfigFile: async (filePath) => YAML.parse(readFileSync(filePath, 'utf8'))
 * });
 *
 * console.log(result.config); // Merged configuration
 * ```
 */
export async function mergeConfiguration(
	config: Configuration,
	options: MergeConfigurationOptions,
): Promise<GlobResult> {
	const loader = new ConfigurationLoader(options.findFilesMatchingGlobs, options.loadConfigFile);
	const result = await loader.mergeConfiguration(
		JSON.parse(JSON.stringify(config)) as Configuration,
	);

	return {
		config: result,
		warnings: removeDuplicateWarnings(loader.warnings),
		globPatterns: Array.from(loader.globPatterns),
		pathsToGlobKey: loader.pathsToGlobKey,
		globKeyToPaths: loader.globKeyToPaths,
	};
}
