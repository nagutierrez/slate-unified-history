import { Operation, Path } from "slate";
import type { HistoryCommand, SlateHistoryBatch } from "./types.js";
import type { DecideMergeInput, DecideMergeResult } from "./types.js";

// shouldMerge / shouldSave match slate-history's rules for contiguous text ops and set_selection.

/**
 * Slate-history rule: whether `op` should be merged into the same batch as `prev`
 * (contiguous `insert_text` / `remove_text` at the same path).
 *
 * @param op - Operation being applied.
 * @param prev - Last operation in the current batch, if any.
 */
export function shouldMerge(
  op: Operation,
  prev: Operation | undefined,
): boolean {
  if (
    prev &&
    op.type === "insert_text" &&
    prev.type === "insert_text" &&
    op.offset === prev.offset + prev.text.length &&
    Path.equals(op.path, prev.path)
  ) {
    return true;
  }

  if (
    prev &&
    op.type === "remove_text" &&
    prev.type === "remove_text" &&
    op.offset + op.text.length === prev.offset &&
    Path.equals(op.path, prev.path)
  ) {
    return true;
  }

  return false;
}

/**
 * Whether this operation should be recorded on the undo stack (`set_selection` is skipped).
 *
 * @param op - Operation being applied.
 * @param _prev - Previous op in batch (unused; kept for API symmetry with {@link shouldMerge}).
 */
export function shouldSave(
  op: Operation,
  _prev: Operation | undefined,
): boolean {
  if (op.type === "set_selection") {
    return false;
  }
  return true;
}

/**
 * Returns the Slate batch to merge into for unified history: the **top** undo entry
 * only if it is a `slate` command for `editorKey`. Avoids merging across custom
 * commands or another editor’s entries.
 *
 * @param undos - Current undo stack (newest last).
 * @param editorKey - Editor key passed to {@link withUnifiedHistory}.
 */
export function findMergeTargetSlateBatch(
  undos: HistoryCommand[],
  editorKey: string,
): SlateHistoryBatch | undefined {
  if (undos.length === 0) return undefined;
  const top = undos[undos.length - 1];
  if (top.kind === "slate" && top.editorKey === editorKey) {
    return top.batch;
  }
  return undefined;
}

/**
 * Pure equivalent of the history branch inside the `apply` override: skip recording,
 * append to `lastBatch`, or start a `newBatch` with `selectionBefore`.
 *
 * @param input - Current op, last merge-target batch, editor flags, and selection.
 * @returns The action the plugin should apply before calling the underlying `apply`.
 */
export function decideHistoryMerge(input: DecideMergeInput): DecideMergeResult {
  const {
    op,
    lastBatch,
    editorOperations,
    saving,
    merging,
    splittingOnce,
    selection,
  } = input;
  const lastOp =
    lastBatch && lastBatch.operations.length > 0
      ? lastBatch.operations[lastBatch.operations.length - 1]
      : undefined;

  let save = saving;
  let merge = merging;

  if (save == null) {
    save = shouldSave(op, lastOp);
  }

  if (!save) {
    return { action: "skip" };
  }

  // Match slate-history: non-empty `editor.operations` means we're still in the same
  // synchronous apply/normalize flush, so merge without requiring `includes(lastOp)`.
  if (merge == null) {
    if (lastBatch == null) {
      merge = false;
    } else if (editorOperations.length !== 0) {
      merge = true;
    } else {
      merge = shouldMerge(op, lastOp);
    }
  }

  if (splittingOnce) {
    merge = false;
  }

  if (lastBatch && merge) {
    return { action: "merge", op };
  }

  return {
    action: "newBatch",
    batch: {
      operations: [op],
      selectionBefore: selection,
    },
  };
}
