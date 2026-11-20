# Changelog

<!-- 
    Add changes to the Unreleased section during development.
    Do not change this header — the GitHub action that releases
    this project will edit this file and add the version header for you.
    The Unreleased block will also be used for the GitHub release notes.
-->

## v0.0.17

* `findFilesMatchingGlobs` may now be async, and `loadConfiguration` uses `fs.promises.glob` instead of `globSync`.
* Added a shared `ConfigurationError` base, with `ConfigurationLoadError` for unreadable, unparseable, non-object, non-serializable, or wrongly shaped configuration and `InvalidGlobPatternError` for invalid `*_from_glob` entries (exposing `pattern`, `reason`, and `filePath`).
* Merged configuration keys are defined as own properties, so a user-supplied `__proto__` key cannot change the prototype of the merged object.
