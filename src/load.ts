import { glob, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Configuration } from '@cloudcannon/configuration-types';
import { ConfigurationLoadError, invalidConfigurationError } from './errors.ts';
import { mergeConfiguration } from './loader.ts';
import type { GlobResult, MergeConfigurationOptions } from './types.ts';
import { isObject } from './utils.ts';

/**
 * Options for loadConfiguration.
 */
export interface LoadConfigurationOptions {
	/**
	 * Custom function to parse file contents. Can be sync or async.
	 * Defaults to JSON.parse for .json files, and the 'yaml' package for .yml/.yaml files.
	 * If not provided and a YAML file is encountered, an error will be thrown
	 * suggesting to install the 'yaml' package.
	 */
	parseFile?: (contents: string, filePath: string) => unknown | Promise<unknown>;
}

/**
 * Attempts to load the yaml package dynamically.
 * Returns the parse function if available, otherwise returns undefined.
 */
async function tryLoadYamlParser(): Promise<((content: string) => unknown) | undefined> {
	try {
		// Use a variable to prevent TypeScript from trying to resolve the module statically
		const yamlModuleName = 'yaml';
		const yaml = (await import(yamlModuleName)) as { parse: (s: string) => unknown };
		return yaml.parse;
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
				throw new Error(`Cannot parse YAML file "${filePath}". Install yaml: npm install yaml`);
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
				`Cannot parse file "${filePath}". Install yaml for YAML support: npm install yaml`
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
	options?: LoadConfigurationOptions
): Promise<GlobResult> {
	const parseFile = options?.parseFile ?? (await createDefaultParser());
	const absoluteConfigPath = resolve(configPath);
	const configDir = dirname(absoluteConfigPath);

	// Load and parse the base configuration file
	let configContents: string;
	try {
		configContents = await readFile(absoluteConfigPath, 'utf8');
	} catch (err) {
		throw new ConfigurationLoadError(`Failed to read configuration file "${absoluteConfigPath}".`, {
			cause: err,
			filePath: absoluteConfigPath,
		});
	}

	let config: unknown;
	try {
		config = await parseFile(configContents, absoluteConfigPath);
	} catch (err) {
		throw new ConfigurationLoadError(
			`Failed to parse configuration file "${absoluteConfigPath}".`,
			{ cause: err, filePath: absoluteConfigPath }
		);
	}

	if (!isObject(config)) {
		throw invalidConfigurationError(config, absoluteConfigPath);
	}

	// Create the merge options with default implementations
	const mergeOptions: MergeConfigurationOptions = {
		configPath: absoluteConfigPath,

		findFilesMatchingGlobs: async (globs: string[]) => {
			const resolvedGlobs: string[] = [];

			for (const globPattern of globs) {
				const negated = globPattern.startsWith('!');
				const pattern = negated ? globPattern.slice(1) : globPattern;
				const resolved = resolve(configDir, pattern.startsWith('/') ? pattern.slice(1) : pattern);
				const relativePath = relative(configDir, resolved);
				if (
					relativePath === '..' ||
					relativePath.startsWith(`..${sep}`) ||
					isAbsolute(relativePath)
				) {
					// Patterns outside the configuration directory are intentionally ignored.
					continue;
				}
				resolvedGlobs.push(negated ? `!${resolved}` : resolved);
			}

			const matchedFiles: string[] = [];
			for await (const filePath of glob(resolvedGlobs)) {
				matchedFiles.push(filePath);
			}
			return matchedFiles;
		},

		loadConfigFile: async (filePath: string) => {
			const contents = await readFile(filePath, 'utf8');
			return await parseFile(contents, filePath);
		},
	};

	return mergeConfiguration(config as Configuration, mergeOptions);
}
