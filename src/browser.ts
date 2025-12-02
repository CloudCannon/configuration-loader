/**
 * @cloudcannon/configuration-loader/browser
 *
 * Browser-compatible exports for the CloudCannon configuration loader.
 * Use this entry point when you need to run in environments without Node.js APIs.
 *
 * @example
 * ```typescript
 * import { mergeConfiguration } from '@cloudcannon/configuration-loader/browser';
 *
 * const result = await mergeConfiguration(config, {
 *   findFilesMatchingGlobs: (globs) => yourGlobImplementation(globs),
 *   loadConfigFile: async (path) => yourFileLoader(path)
 * });
 * ```
 */

// Re-export useful types from configuration-types for convenience
export type { Configuration, StructureValue } from '@cloudcannon/configuration-types';

// Export the core merge function (no Node.js dependencies)
export { mergeConfiguration } from './loader.ts';

// Export types from dedicated types file
export type {
	GlobLoaderWarnings,
	GlobResult,
	GlobTypeKey,
	MergeConfigurationOptions,
} from './types.ts';
