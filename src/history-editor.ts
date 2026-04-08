import { Editor } from "slate";
import type { BaseEditor } from "slate";
import { History, type Batch } from "./history.js";

/**
 * When `false`, operations inside {@link HistoryEditor.withoutSaving} are not appended to history.
 */
export const SAVING = new WeakMap<BaseEditor, boolean | undefined>();
/**
 * When `true`, operations may merge into the previous batch; when `false`, they start a new batch.
 */
export const MERGING = new WeakMap<BaseEditor, boolean | undefined>();
/**
 * When set, the next save forces a new batch (used by {@link HistoryEditor.withNewBatch}).
 */
export const SPLITTING_ONCE = new WeakMap<BaseEditor, boolean | undefined>();

/**
 * A Slate editor that supports operation history: `history` stacks, `undo` / `redo`,
 * and low-level {@link HistoryEditor.writeHistory}.
 *
 * Obtain by wrapping an editor with {@link withUnifiedHistory}.
 */
export interface HistoryEditor extends BaseEditor {
  /** Undo/redo shape for type guards; stacks live in the unified store (often empty arrays here). */
  history: History;
  /** Reverts the latest undo batch (delegates to store in unified mode). */
  undo: () => void;
  /** Reapplies the latest redo batch (delegates to store in unified mode). */
  redo: () => void;
  /**
   * Not used by this package’s plugin (throws); retained for {@link HistoryEditor} typing parity with slate-history.
   */
  writeHistory: (stack: "undos" | "redos", batch: Batch) => void;
}

/**
 * Static helpers and type guard for {@link HistoryEditor}.
 */
export const HistoryEditor = {
  /**
   * @returns Whether `value` is a Slate editor whose `history` satisfies {@link History.isHistory}.
   */
  isHistoryEditor(value: unknown): value is HistoryEditor {
    return (
      typeof value === "object" &&
      value !== null &&
      "history" in value &&
      History.isHistory((value as HistoryEditor).history) &&
      Editor.isEditor(value)
    );
  },

  /**
   * @returns The current “merging” flag from {@link MERGING}, if any.
   */
  isMerging(editor: HistoryEditor): boolean | undefined {
    return MERGING.get(editor);
  },

  /**
   * @returns Whether the next saved operation should start a new batch (see {@link SPLITTING_ONCE}).
   */
  isSplittingOnce(editor: HistoryEditor): boolean | undefined {
    return SPLITTING_ONCE.get(editor);
  },

  /**
   * Sets or clears the splitting-once flag (used when implementing batch boundaries).
   */
  setSplittingOnce(editor: HistoryEditor, value: boolean | undefined): void {
    SPLITTING_ONCE.set(editor, value);
  },

  /**
   * @returns The current “saving” flag from {@link SAVING}, if any (`false` skips history recording).
   */
  isSaving(editor: HistoryEditor): boolean | undefined {
    return SAVING.get(editor);
  },

  /** Invokes `editor.redo()`. */
  redo(editor: HistoryEditor): void {
    editor.redo();
  },

  /** Invokes `editor.undo()`. */
  undo(editor: HistoryEditor): void {
    editor.undo();
  },

  /**
   * Runs `fn` with merging enabled so consecutive compatible operations may join the previous batch.
   */
  withMerging(editor: HistoryEditor, fn: () => void): void {
    const prev = HistoryEditor.isMerging(editor);
    MERGING.set(editor, true);
    fn();
    MERGING.set(editor, prev);
  },

  /**
   * Runs `fn` so the first recorded operation starts a **new** batch; later ops merge as usual.
   */
  withNewBatch(editor: HistoryEditor, fn: () => void): void {
    const prev = HistoryEditor.isMerging(editor);
    MERGING.set(editor, true);
    SPLITTING_ONCE.set(editor, true);
    fn();
    MERGING.set(editor, prev);
    SPLITTING_ONCE.delete(editor);
  },

  /**
   * Runs `fn` with merging disabled so each saved operation starts a new batch.
   */
  withoutMerging(editor: HistoryEditor, fn: () => void): void {
    const prev = HistoryEditor.isMerging(editor);
    MERGING.set(editor, false);
    fn();
    MERGING.set(editor, prev);
  },

  /**
   * Runs `fn` without recording operations to history (used when applying undo/redo).
   */
  withoutSaving(editor: HistoryEditor, fn: () => void): void {
    const prev = HistoryEditor.isSaving(editor);
    SAVING.set(editor, false);
    try {
      fn();
    } finally {
      SAVING.set(editor, prev);
    }
  },
};
