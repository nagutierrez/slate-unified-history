import type { Editor, Operation, Range } from "slate";
import type { Batch } from "./history.js";

/**
 * One Slate undo step: same shape as classic slate-history {@link Batch}.
 */
export type SlateHistoryBatch = Batch;

/**
 * A unified-stack entry that records Slate changes for one editor key.
 */
export type HistorySlateCommand = {
  kind: "slate";
  /** Matches `editorKey` passed to {@link withUnifiedHistory}. */
  editorKey: string;
  batch: SlateHistoryBatch;
};

/**
 * Argument to **`onWillApplySlateHistoryCommand`** passed to **`createMemoryUnifiedStore`**.
 * Fired synchronously after the command is popped and the editor is resolved, before any
 * `Transforms.setSelection` / inverse or forward `apply` runs for that slate step.
 */
export type WillApplySlateHistoryInput = {
  editor: Editor;
  editorKey: string;
  command: HistorySlateCommand;
  direction: "undo" | "redo";
};

/**
 * One recorded custom micro-step (serializable). Handled at undo/redo time via
 * {@link UnifiedHistoryStore.registerCustomHandler}.
 */
export type CustomHistoryStep = {
  id: string;
  payload?: unknown;
};

/**
 * Application-specific undo entry: **no functions** — safe to `JSON.stringify` with JSON-safe payloads.
 *
 * Multiple {@link CustomHistoryStep} values mean one undo step when pushes share the same
 * {@link HistoryCustomCommand.mergeKey} (see {@link PushCustomOptions.mergeKey}) or when
 * {@link PushCustomOptions.shouldMerge} applies: undo runs each step **newest first**; redo **oldest first**.
 */
export type HistoryCustomCommand = {
  kind: "custom";
  steps: CustomHistoryStep[];
  /**
   * Group id for coalescing: the next `pushCustom` merges into this entry when its effective
   * `mergeKey` (options or input) equals this value.
   */
  mergeKey?: string;
};

/**
 * Payload passed to {@link UnifiedHistoryStore.pushCustom} (one logical step; may merge into a multi-step entry).
 */
export type PushCustomInput = {
  id: string;
  payload?: unknown;
  /** Included in the effective merge key with {@link PushCustomOptions.mergeKey} (options win). */
  mergeKey?: string;
};

/**
 * Discriminated union of everything on the unified undo/redo stacks (JSON-serializable if all payloads are).
 */
export type HistoryCommand = HistorySlateCommand | HistoryCustomCommand;

/**
 * Lightweight snapshot for toolbar / external-store subscriptions (see {@link UnifiedHistoryStore.getMetaSnapshot}).
 */
export type HistoryMetaSnapshot = {
  /** True if {@link UnifiedHistoryStore.undo} would do something. */
  canUndo: boolean;
  /** True if {@link UnifiedHistoryStore.redo} would do something. */
  canRedo: boolean;
  /**
   * Increments when stack lengths (undo/redo) change — not on every in-batch Slate op merge.
   * Use together with `canUndo` / `canRedo` for toolbar state.
   */
  revision: number;
};

/**
 * Undo/redo implementation for a given command `id` (registered on the store).
 */
export type CustomCommandHandler = {
  undo: (payload: unknown | undefined) => void;
  redo: (payload: unknown | undefined) => void;
};

/**
 * Returns whether `incoming` should merge into the current top **custom** undo entry.
 */
export type CustomMergePredicate = (
  top: HistoryCustomCommand,
  incoming: PushCustomInput,
) => boolean;

/**
 * Options for {@link UnifiedHistoryStore.pushCustom} controlling custom-command coalescing.
 */
export type PushCustomOptions = {
  /**
   * If the top undo entry is custom and its `mergeKey` equals this value (or the one on `input`
   * when this is omitted), the push **merges**: one new step is appended (payloads are not combined).
   * Set on the first push to start a group; repeat on later pushes to extend it.
   */
  mergeKey?: string;
  /**
   * When this returns true, merge into the top **custom** entry by appending a step (ignores `mergeKey` matching).
   */
  shouldMerge?: CustomMergePredicate;
};

/**
 * External undo/redo store: one timeline mixing {@link HistorySlateCommand} and {@link HistoryCustomCommand}.
 *
 * Implemented by {@link createMemoryUnifiedStore}.
 */
export type UnifiedHistoryStore = {
  /**
   * Stable snapshot for UI (`useSyncExternalStore`): same object reference if
   * `canUndo`, `canRedo`, and `revision` are unchanged.
   */
  getMetaSnapshot(): HistoryMetaSnapshot;
  /**
   * Subscribe to meta changes. Notifications are batched (at most one microtask per synchronous burst).
   *
   * @param listener - Called after batched mutations; return unsubscribe from the returned function.
   * @returns Unsubscribe function.
   */
  subscribeMeta(listener: () => void): () => void;
  /**
   * Subscribe to any stack mutation, including merging another op into the current Slate batch.
   * High frequency — prefer {@link UnifiedHistoryStore.subscribeMeta} for buttons.
   *
   * @returns Unsubscribe function.
   */
  subscribeDeep(listener: () => void): () => void;
  /** Pops and applies the latest undo command (Slate inverse ops or custom handlers). */
  undo(): void;
  /** Pops and applies the latest redo command. */
  redo(): void;
  /**
   * Records a custom step; clears the redo stack; enforces max undo depth.
   * Handlers must be registered with {@link UnifiedHistoryStore.registerCustomHandler} (or at store creation).
   *
   * @param input - Command id and optional payload (serializable if you persist the stack).
   * @param options - Optional {@link PushCustomOptions} for merging behavior.
   */
  pushCustom(input: PushCustomInput, options?: PushCustomOptions): void;
  /**
   * Register how to undo/redo a given `id`. Required before `pushCustom` / undo / redo touches that id.
   *
   * @returns Unregister function.
   */
  registerCustomHandler(id: string, handler: CustomCommandHandler): () => void;
  /**
   * Shallow copies of stacks — for one-off menus or inspection, not per-keystroke React state.
   */
  getStacksForUI(): { undos: HistoryCommand[]; redos: HistoryCommand[] };
  /**
   * Maps `editorKey` to the Slate editor used when applying slate undo/redo.
   *
   * @returns Call to remove the registration (e.g. on unmount).
   */
  registerEditor(editorKey: string, editor: Editor): () => void;
};

/**
 * Options for {@link withUnifiedHistory}.
 */
export type WithUnifiedHistoryOptions = {
  /** Stable id for this editor instance; must match {@link UnifiedHistoryStore.registerEditor}. */
  editorKey: string;
  /** Store instance (typically from {@link createMemoryUnifiedStore}). */
  store: UnifiedHistoryStore;
};

/**
 * Inputs for {@link decideHistoryMerge} — mirrors what the history `apply` override uses.
 */
export type DecideMergeInput = {
  op: Operation;
  /** Batch to merge into, if any (top-of-stack slate batch for that editor in unified mode). */
  lastBatch: SlateHistoryBatch | undefined;
  /**
   * `editor.operations` at apply entry: non-empty means same flush as slate-history
   * (`operations.length !== 0` → merge into `lastBatch`).
   */
  editorOperations: Operation[];
  /** Explicit save flag; `undefined` falls back to {@link shouldSave}. */
  saving: boolean | undefined;
  /** Explicit merge flag; `undefined` uses default merge rules. */
  merging: boolean | undefined;
  /** When true, forces a new batch for the next save. */
  splittingOnce: boolean | undefined;
  /** Selection before this operation is applied (stored on new batches). */
  selection: Range | null;
};

/**
 * Result of {@link decideHistoryMerge}: whether to skip recording, append to the last batch, or start a new batch.
 */
export type DecideMergeResult =
  | { action: "skip" }
  | { action: "merge"; op: Operation }
  | { action: "newBatch"; batch: SlateHistoryBatch };
