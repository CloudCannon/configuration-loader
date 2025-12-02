/**
 * @cloudcannon/configuration-loader
 *
 * Load and merge CloudCannon configuration files that have been split across multiple files.
 *
 * This package provides utilities to work with CloudCannon's configuration splitting
 * feature, allowing you to organize your configuration across multiple files and
 * merge them together for use in your build tools or templates.
 *
 * @see https://cloudcannon.com/documentation/articles/why-split-your-configuration-file/
 *
 * @example
 * ```typescript
 * import { loadConfiguration } from '@cloudcannon/configuration-loader';
 *
 * const result = await loadConfiguration('cloudcannon.config.yml');
 * console.log(result.config);
 * ```
 */

// Re-export useful types from configuration-types for convenience
export type { Configuration, StructureValue } from '@cloudcannon/configuration-types';

// Export the simple high-level API
export { type LoadConfigurationOptions, loadConfiguration } from './load.ts';

// Export the lower-level API for custom implementations
export { mergeConfiguration } from './loader.ts';

// Export types from dedicated types file
export type {
	GlobLoaderWarnings,
	GlobResult,
	GlobTypeKey,
	MergeConfigurationOptions,
} from './types.ts';
