/**
 * @packageDocumentation
 * Unified Slate undo/redo: {@link withUnifiedHistory}, {@link createMemoryUnifiedStore},
 * and slate-history-compatible {@link HistoryEditor} helpers (for `withoutSaving`, merging, etc.).
 */

export * from "./history.js";
export * from "./history-editor.js";
export * from "./with-unified-history.js";
export * from "./types.js";
export * from "./slate-merge.js";
export {
  createMemoryUnifiedStore,
  type CreateMemoryUnifiedStoreOptions,
  type MemoryUnifiedHistoryStore,
} from "./createMemoryUnifiedStore.js";
