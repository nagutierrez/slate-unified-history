import { Editor, Operation } from "slate";
import type { MemoryUnifiedHistoryStore } from "./createMemoryUnifiedStore.js";
import {
  HistoryEditor,
  type HistoryEditor as HistoryEditorType,
} from "./history-editor.js";
import { decideHistoryMerge } from "./slate-merge.js";
import type { WithUnifiedHistoryOptions } from "./types.js";

/**
 * Slate plugin: records operations into a shared {@link WithUnifiedHistoryOptions.store} and
 * forwards `editor.undo` / `editor.redo` to that store. Interleaves with `store.pushCustom` for
 * app-level commands.
 *
 * For classic per-editor history on `editor.history`, use the upstream `slate-history` package
 * (`withHistory` from `slate-history`).
 *
 * @typeParam T - Editor type being extended.
 * @param editor - Slate editor to wrap.
 * @param options - `editorKey` (stable id) and `store` (typically from {@link createMemoryUnifiedStore}).
 * @returns The editor as `T & HistoryEditor`.
 *
 * @throws If `store` lacks `applySlateHistoryStep` (use {@link createMemoryUnifiedStore}).
 *
 * @see https://docs.slatejs.org/concepts/11-typescript for CustomTypes.
 */
export const withUnifiedHistory = <T extends Editor>(
  editor: T,
  options: WithUnifiedHistoryOptions,
): T & HistoryEditorType => {
  const e = editor as T & HistoryEditorType;
  const { apply } = e;
  const { editorKey, store } = options;
  const memoryStore = store as MemoryUnifiedHistoryStore;
  if (typeof memoryStore.applySlateHistoryStep !== "function") {
    throw new Error(
      "withUnifiedHistory: store must be created with createMemoryUnifiedStore (or provide applySlateHistoryStep)",
    );
  }

  e.history = { undos: [], redos: [] };

  e.undo = () => {
    store.undo();
  };

  e.redo = () => {
    store.redo();
  };

  e.writeHistory = () => {
    throw new Error(
      "withUnifiedHistory: writeHistory is not used; use the store API (e.g. pushCustom)",
    );
  };

  e.apply = (op: Operation) => {
    const { operations } = e;
    const lastBatch = memoryStore.getMergeTargetSlateBatch(editorKey);

    const decided = decideHistoryMerge({
      op,
      lastBatch,
      editorOperations: operations,
      saving: HistoryEditor.isSaving(e),
      merging: HistoryEditor.isMerging(e),
      splittingOnce: !!HistoryEditor.isSplittingOnce(e),
      selection: e.selection,
    });

    if (decided.action === "skip") {
      apply(op);
      return;
    }

    if (HistoryEditor.isSplittingOnce(e)) {
      HistoryEditor.setSplittingOnce(e, undefined);
    }

    memoryStore.applySlateHistoryStep(editorKey, decided);

    apply(op);
  };

  return e;
};
