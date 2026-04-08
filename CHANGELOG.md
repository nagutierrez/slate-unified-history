# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-04-07

### Fixed

- **Same-flush batch merging**: Align merge detection with `slate-history` by merging into the current batch when `editor.operations` is non-empty at apply entry, instead of requiring the last batch operation to appear in that array. This matches Slate’s synchronous apply/normalize flush behavior and fixes cases where the top-of-stack op is no longer listed in `operations` but the flush is still in progress.

## [0.1.0] - 2026-04-07

### Added

- Initial release: unified undo/redo for Slate with pluggable batches (Slate history batches plus custom commands), `withUnifiedHistory`, merge/save hooks, and CI.

[Unreleased]: https://github.com/nagutierrez/slate-unified-history/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/nagutierrez/slate-unified-history/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nagutierrez/slate-unified-history/releases/tag/v0.1.0
