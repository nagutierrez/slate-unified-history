import { Operation, Range, isObject } from "slate";

/**
 * A single undoable Slate step: the operations that were applied together,
 * plus the selection to restore when this batch is undone.
 */
export interface Batch {
  /** Slate operations recorded for this undo step (applied in order for redo). */
  operations: Operation[];
  /** Selection before this batch’s first operation was applied; restored on undo. */
  selectionBefore: Range | null;
}

/**
 * Shape of undo/redo batch stacks (compatible with slate-history).
 *
 * Editors using {@link withUnifiedHistory} keep an empty-shaped `history` for
 * {@link History.isHistory} / {@link HistoryEditor.isHistoryEditor}; real stacks live in the store.
 */
export interface History {
  /** Batches that can be replayed forward again. */
  redos: Batch[];
  /** Batches that can be stepped backward (most recent last). */
  undos: Batch[];
}

/**
 * Runtime helper alongside the {@link History} type: type guard for history-shaped values.
 */
export const History = {
  /**
   * Returns true if `value` looks like a {@link History} (arrays, optional op lists).
   *
   * @param value - Any value to test.
   */
  isHistory(value: unknown): value is History {
    if (!isObject(value)) return false;
    const v = value as History;
    return (
      Array.isArray(v.redos) &&
      Array.isArray(v.undos) &&
      (v.redos.length === 0 ||
        Operation.isOperationList(v.redos[0].operations)) &&
      (v.undos.length === 0 || Operation.isOperationList(v.undos[0].operations))
    );
  },
};
