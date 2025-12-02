# @cloudcannon/configuration-loader

Load and merge CloudCannon configuration files that have been split across multiple files.

[<img src="https://img.shields.io/npm/v/@cloudcannon%2Fconfiguration-loader?logo=npm" alt="version badge">](https://www.npmjs.com/package/@cloudcannon%2Fconfiguration-loader)

This package brings the [configuration loading functionality](https://cloudcannon.com/documentation/articles/why-split-your-configuration-file/) from CloudCannon into your local development environment. It's particularly useful for:

- **Static site generators** that need access to CloudCannon configuration at build time
- **Custom integrations** like the [CloudCannon + Next.js starter](https://community.cloudcannon.com/t/a-cloudcannon-next-js-starter/305) that generate content schemas from CloudCannon config
- **Development tooling** that validates or processes CloudCannon configuration

## Requirements

- Node.js >= 22.6.0

## Installation

```bash
npm install @cloudcannon/configuration-loader
```

## Usage

```typescript
import { loadConfiguration } from '@cloudcannon/configuration-loader';

const result = await loadConfiguration('cloudcannon.config.yml');

console.log(result.config);
```

That's it! The `loadConfiguration` function handles:
- Reading and parsing your configuration file (YAML or JSON)
- Finding all files matching `*_from_glob` patterns
- Merging everything into a single configuration object

### YAML Support

For YAML files, install `js-yaml`:

```bash
npm install js-yaml
```

The loader will automatically detect and use it.

#### Why isn't the YAML parser included?

We don't bundle a YAML parser because:

1. **You likely already have one** — most projects using CloudCannon configuration already have `js-yaml` or similar installed for their build tooling
2. **Keeps the package lightweight** — no unnecessary dependencies if you only use JSON configs
3. **Flexibility** — you can use any YAML parser via the `parseFile` option if you prefer a different one

### Checking for Warnings

```typescript
const result = await loadConfiguration('cloudcannon.config.yml');

if (result.warnings.cycles.length > 0) {
  console.warn('Circular references detected:', result.warnings.cycles);
}

if (result.warnings.arrayValues.length > 0) {
  console.warn('Invalid array configs:', result.warnings.arrayValues);
}
```

## API

### `loadConfiguration(configPath, options?)`

Loads and merges a CloudCannon configuration file with all its split configuration files.

```typescript
const result = await loadConfiguration('cloudcannon.config.yml');
```

#### Parameters

- `configPath` - Path to the CloudCannon configuration file
- `options.parseFile` - Optional custom parser function for file contents

#### Returns

### `mergeConfiguration(config, options)`

Lower-level API for custom implementations. Use this when you need full control over file loading and glob matching, or when running in a browser environment.

```typescript
import { mergeConfiguration } from '@cloudcannon/configuration-loader/browser';

const result = await mergeConfiguration(config, {
  findFilesMatchingGlobs: (globs) => /* your glob implementation */,
  loadConfigFile: async (path) => /* your file loader */
});
```

#### Parameters

- `config` - The base CloudCannon configuration object
- `options.findFilesMatchingGlobs` - Function that takes an array of glob patterns and returns matching file paths
- `options.loadConfigFile` - Async function that loads and parses a configuration file

#### Returns

A `GlobResult` object containing:

```typescript
interface GlobResult {
  // The merged configuration
  config: Configuration;
  
  // Warnings about potential issues
  warnings: {
    // Circular references in configuration
    cycles: { path: string; chain: string[] }[];
    // Files matched by multiple different glob keys
    multipleGlobKeys: { path: string; type1: GlobTypeKey; type2: GlobTypeKey }[];
    // Files containing arrays instead of objects
    arrayValues: { path: string }[];
  };
  
  // All glob patterns found (for file watching)
  globPatterns: string[];
  
  // Mapping from file paths to their glob key type
  pathsToGlobKey: Record<string, GlobTypeKey>;
  
  // Mapping from glob key types to matched file paths
  globKeyToPaths: Record<GlobTypeKey, Set<string>>;
}
```

## Browser Usage

For browser environments (or anywhere without Node.js `fs` APIs), use the `/browser` entry point:

```typescript
import { mergeConfiguration } from '@cloudcannon/configuration-loader/browser';

// You provide the implementations for glob matching and file loading
const result = await mergeConfiguration(config, {
  findFilesMatchingGlobs: (globs) => {
    // Your implementation - e.g., fetch from an API
    return fetchMatchingFiles(globs);
  },
  loadConfigFile: async (filePath) => {
    // Your implementation - e.g., fetch file contents
    const response = await fetch(`/api/config/${filePath}`);
    return response.json();
  }
});
```

This entry point exports only `mergeConfiguration` and the types, with no Node.js dependencies.

## Supported Glob Keys

The loader processes the following `*_from_glob` keys:

| Key | Target | Description |
|-----|--------|-------------|
| `collections_config_from_glob` | `collections_config` | Collection configurations |
| `schemas_from_glob` | `schemas` | Schema configurations (within collections) |
| `_inputs_from_glob` | `_inputs` | Input configurations |
| `_structures_from_glob` | `_structures` | Structure configurations |
| `values_from_glob` | `values` | Structure values |
| `_snippets_from_glob` | `_snippets` | Snippet configurations |
| `_snippets_imports_from_glob` | `_snippets_imports` | Snippet imports |
| `_snippets_templates_from_glob` | `_snippets_templates` | Snippet templates |
| `_snippets_definitions_from_glob` | `_snippets_definitions` | Snippet definitions |
| `_editables_from_glob` | `_editables` | Editable region configurations |

## Source Tracking

Merged objects include a `__source__` property indicating which file they came from:

```typescript
const result = await loadConfiguration('cloudcannon.config.yml');

// Each merged input has a __source__ property
console.log(result.config._inputs?.title);
// { type: 'text', __source__: '/.cloudcannon/inputs/seo.yml' }
```

## Development

```bash
# Install dependencies
npm install

# Run type checking
npm run typecheck

# Run tests
npm test

# Build type declarations
npm run build
```

## How It Works

This package uses Node.js 22's native TypeScript support with type stripping (`--experimental-strip-types`). This means:

- TypeScript files run directly without compilation
- Type declarations are generated separately for package consumers
- No build step required for development

## License

MIT

