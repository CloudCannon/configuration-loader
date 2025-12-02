import { globSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Configuration } from '@cloudcannon/configuration-types';
import { mergeConfiguration } from './loader.ts';
import type { GlobResult, MergeConfigurationOptions } from './types.ts';

/**
 * Options for loadConfiguration.
 */
export interface LoadConfigurationOptions {
	/**
	 * Custom function to parse file contents. Can be sync or async.
	 * Defaults to JSON.parse for .json files, and js-yaml for .yml/.yaml files.
	 * If not provided and a YAML file is encountered, an error will be thrown
	 * suggesting to install the 'js-yaml' package.
	 */
	parseFile?: (contents: string, filePath: string) => unknown | Promise<unknown>;
}

/**
 * Attempts to load the js-yaml package dynamically.
 * Returns the load function if available, otherwise returns undefined.
 */
async function tryLoadYamlParser(): Promise<((content: string) => unknown) | undefined> {
	try {
		// Use a variable to prevent TypeScript from trying to resolve the module statically
		const jsYamlModuleName = 'js-yaml';
		const jsYaml = (await import(jsYamlModuleName)) as { load: (s: string) => unknown };
		return jsYaml.load;
	} catch {
		return undefined;
	}
}

/**
 * Creates a file parser that handles JSON and YAML files.
 */
async function createDefaultParser(): Promise<(contents: string, filePath: string) => unknown> {
	const yamlParse = await tryLoadYamlParser();

	return (contents: string, filePath: string): unknown => {
		if (filePath.endsWith('.json')) {
			return JSON.parse(contents);
		}

		if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) {
			if (!yamlParse) {
				throw new Error(
					`Cannot parse YAML file "${filePath}". Install js-yaml: npm install js-yaml`,
				);
			}
			return yamlParse(contents);
		}

		// Try JSON first, then YAML if available
		try {
			return JSON.parse(contents);
		} catch {
			if (yamlParse) {
				return yamlParse(contents);
			}
			throw new Error(
				`Cannot parse file "${filePath}". Install js-yaml for YAML support: npm install js-yaml`,
			);
		}
	};
}

/**
 * Loads and merges a CloudCannon configuration file with all its split configuration files.
 *
 * This is the simplest way to load CloudCannon configuration. It handles:
 * - Reading the configuration file from disk
 * - Parsing YAML and JSON files
 * - Finding files matching glob patterns
 * - Merging all configuration into a single object
 *
 * @param configPath - Path to the CloudCannon configuration file (e.g., 'cloudcannon.config.yml')
 * @param options - Optional configuration options
 * @returns A promise resolving to the merged configuration with metadata
 *
 * @example
 * ```typescript
 * import { loadConfiguration } from '@cloudcannon/configuration-loader';
 *
 * const result = await loadConfiguration('cloudcannon.config.yml');
 * console.log(result.config);
 * ```
 */
export async function loadConfiguration(
	configPath: string,
	options?: LoadConfigurationOptions,
): Promise<GlobResult> {
	const parseFile = options?.parseFile ?? (await createDefaultParser());
	const absoluteConfigPath = resolve(configPath);
	const configDir = dirname(absoluteConfigPath);

	// Load and parse the base configuration file
	const configContents = await readFile(absoluteConfigPath, 'utf8');
	const config = (await parseFile(configContents, absoluteConfigPath)) as Configuration;

	// Create the merge options with default implementations
	const mergeOptions: MergeConfigurationOptions = {
		// Note: globSync is used here because the interface is synchronous by design.
		// Glob operations are typically fast (just directory traversal), while file
		// reading (handled by loadConfigFile) is the slower I/O operation.
		findFilesMatchingGlobs: (globs: string[]) => {
			const resolvedGlobs = globs.map((g) => {
				if (g.startsWith('!')) {
					return `!${resolve(configDir, g.slice(1))}`;
				}
				return resolve(configDir, g);
			});
			return globSync(resolvedGlobs) as string[];
		},

		loadConfigFile: async (filePath: string) => {
			const contents = await readFile(filePath, 'utf8');
			return await parseFile(contents, filePath);
		},
	};

	return mergeConfiguration(config, mergeOptions);
}
