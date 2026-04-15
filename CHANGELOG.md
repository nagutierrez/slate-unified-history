# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2026-04-14

### Added

- **`createMemoryUnifiedStore`**: optional **`onWillApplySlateHistoryCommand`** callback, invoked synchronously for each **`kind: 'slate'`** undo or redo after the command is popped and the editor is resolved, **before** any `Transforms.setSelection` or inverse/forward `apply` runs. Enables apps to refocus the Slate surface (for example via `ReactEditor.focus`) when global undo/redo runs while DOM focus is outside the editor.
- **`WillApplySlateHistoryInput`**: payload type `{ editor, editorKey, command, direction }`.

## [0.1.1] - 2026-04-07

### Fixed

- **Same-flush batch merging**: Align merge detection with `slate-history` by merging into the current batch when `editor.operations` is non-empty at apply entry, instead of requiring the last batch operation to appear in that array. This matches Slate’s synchronous apply/normalize flush behavior and fixes cases where the top-of-stack op is no longer listed in `operations` but the flush is still in progress.

## [0.1.0] - 2026-04-07

### Added

- Initial release: unified undo/redo for Slate with pluggable batches (Slate history batches plus custom commands), `withUnifiedHistory`, merge/save hooks, and CI.

[Unreleased]: https://github.com/nagutierrez/slate-unified-history/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/nagutierrez/slate-unified-history/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/nagutierrez/slate-unified-history/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nagutierrez/slate-unified-history/releases/tag/v0.1.0
