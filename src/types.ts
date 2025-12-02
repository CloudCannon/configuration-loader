import type { Configuration } from '@cloudcannon/configuration-types';

/**
 * All supported glob key types that can be used to split configuration.
 */
export type GlobTypeKey =
	| '_structures_from_glob'
	| 'values_from_glob'
	| '_snippets_from_glob'
	| '_snippets_imports_from_glob'
	| '_snippets_templates_from_glob'
	| '_snippets_definitions_from_glob'
	| '_inputs_from_glob'
	| '_editables_from_glob'
	| 'collections_config_from_glob'
	| 'schemas_from_glob';

/**
 * Warnings generated during configuration loading.
 * These indicate potential issues that may cause unexpected behavior.
 */
export interface GlobLoaderWarnings {
	/**
	 * Circular references detected in configuration files.
	 *
	 * This occurs when a structure value loaded via `values_from_glob` contains
	 * nested structures that reference a file already being processed in the
	 * current chain. The file is skipped to prevent infinite recursion.
	 *
	 * To fix: restructure your configuration to avoid self-referencing patterns,
	 * or use separate files for nested structure definitions.
	 *
	 * @property path - The file path that caused the cycle
	 * @property chain - The sequence of files that led to this cycle
	 */
	cycles: { path: string; chain: string[] }[];

	/**
	 * Files that were matched by multiple different glob key types.
	 *
	 * This occurs when the same file matches glob patterns for different
	 * configuration sections (e.g., both `collections_config_from_glob` and
	 * `_inputs_from_glob`). The file is only processed for the first matching
	 * glob key type; subsequent matches are skipped.
	 *
	 * To fix: use more specific glob patterns to ensure each file is only
	 * matched by one glob key type, or organize files into separate directories.
	 *
	 * @property path - The file path that matched multiple glob types
	 * @property type1 - The first glob key type that matched (file was processed for this)
	 * @property type2 - The second glob key type that matched (file was skipped)
	 */
	multipleGlobKeys: { path: string; type1: GlobTypeKey; type2: GlobTypeKey }[];

	/**
	 * Files containing arrays instead of objects.
	 *
	 * Configuration files loaded via `*_from_glob` keys must contain objects
	 * (key-value pairs), not arrays. Files containing arrays are skipped and
	 * not merged into the configuration.
	 *
	 * To fix: ensure your configuration files export objects. For example,
	 * use `posts: { path: "..." }` instead of `[{ posts: { path: "..." } }]`.
	 *
	 * @property path - The file path containing an array
	 */
	arrayValues: { path: string }[];
}

/**
 * Result of merging split configuration files.
 */
export interface GlobResult {
	/** The merged configuration object */
	config: Configuration;
	/** Warnings about potential issues encountered during loading */
	warnings: GlobLoaderWarnings;
	/** All glob patterns found (useful for file watching) */
	globPatterns: string[];
	/** Mapping from file paths to the glob key type that loaded them */
	pathsToGlobKey: Record<string, GlobTypeKey>;
	/** Mapping from glob key types to the set of file paths they loaded */
	globKeyToPaths: Record<GlobTypeKey, Set<string>>;
}

/**
 * Options for the mergeConfiguration function.
 */
export interface MergeConfigurationOptions {
	/**
	 * Function to find files matching glob patterns.
	 * Receives an array of glob patterns (including negation patterns starting with '!')
	 * and should return an array of matching file paths.
	 */
	findFilesMatchingGlobs: (globs: string[]) => string[];
	/**
	 * Function to load and parse a configuration file.
	 * Should return the parsed content of the file (typically YAML or JSON).
	 */
	loadConfigFile: (filePath: string) => Promise<unknown>;
}
