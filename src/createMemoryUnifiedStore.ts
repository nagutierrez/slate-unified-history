import { Editor, Operation, Transforms } from "slate";
import { HistoryEditor } from "./history-editor.js";
import { appendCustomStepsMerge } from "./custom-merge.js";
import type {
  CustomCommandHandler,
  HistoryCommand,
  HistoryCustomCommand,
  HistoryMetaSnapshot,
  PushCustomInput,
  PushCustomOptions,
  SlateHistoryBatch,
  UnifiedHistoryStore,
  WillApplySlateHistoryInput,
} from "./types.js";
import { findMergeTargetSlateBatch } from "./slate-merge.js";

const defaultMaxUndos = 100;

/**
 * {@link UnifiedHistoryStore} plus integration hooks used by {@link withUnifiedHistory}.
 *
 * App code normally only needs the base store interface; these members exist for the plugin
 * and for advanced custom stores that mirror the same contract.
 */
export type MemoryUnifiedHistoryStore = UnifiedHistoryStore & {
  /**
   * Records one Slate history step after {@link decideHistoryMerge}: merge `op` into the
   * top slate batch for `editorKey`, or push a `newBatch`.
   *
   * @param editorKey - Same key as `withUnifiedHistory(..., { editorKey })`.
   * @param decision - `merge` or `newBatch` from {@link decideHistoryMerge} (not `skip`).
   */
  applySlateHistoryStep(
    editorKey: string,
    decision:
      | { action: "merge"; op: Operation }
      | { action: "newBatch"; batch: SlateHistoryBatch },
  ): void;
  /**
   * The in-stack {@link SlateHistoryBatch} to merge the next op into, if the top undo
   * entry is `slate` for this `editorKey`; otherwise `undefined`.
   */
  getMergeTargetSlateBatch(editorKey: string): SlateHistoryBatch | undefined;
};

export type CreateMemoryUnifiedStoreOptions = {
  maxUndos?: number;
  /** Initial custom command handlers (`id` → undo/redo). More can be added via {@link UnifiedHistoryStore.registerCustomHandler}. */
  customHandlers?: Record<string, CustomCommandHandler>;
  /**
   * Called synchronously for each **`kind: 'slate'`** undo or redo, after the command is popped
   * and the editor is resolved, before any selection restore or inverse/forward ops run.
   * Use to refocus the editable (e.g. `ReactEditor.focus(editor)`) when global shortcuts call
   * {@link UnifiedHistoryStore.undo} / {@link UnifiedHistoryStore.redo} while focus is outside the editor.
   */
  onWillApplySlateHistoryCommand?: (input: WillApplySlateHistoryInput) => void;
};

/**
 * Creates the default in-memory {@link UnifiedHistoryStore}: shared `undos` / `redos`,
 * batched {@link UnifiedHistoryStore.subscribeMeta}, and editor registration for slate undo/redo.
 *
 * @param options - Optional `maxUndos` (default **100**) and `customHandlers` map.
 * @returns Store instance; cast or use as {@link MemoryUnifiedHistoryStore} when calling plugin hooks.
 */
export function createMemoryUnifiedStore(
  options?: CreateMemoryUnifiedStoreOptions,
): MemoryUnifiedHistoryStore {
  const maxUndos = options?.maxUndos ?? defaultMaxUndos;
  const onWillApplySlateHistoryCommand =
    options?.onWillApplySlateHistoryCommand;
  const customHandlers = new Map<string, CustomCommandHandler>(
    Object.entries(options?.customHandlers ?? {}),
  );

  const undos: HistoryCommand[] = [];
  const redos: HistoryCommand[] = [];
  const editors = new Map<string, Editor>();

  const metaListeners = new Set<() => void>();
  const deepListeners = new Set<() => void>();

  let metaScheduled = false;

  let revision = 0;
  let lastUndosLen = 0;
  let lastRedosLen = 0;
  let metaCache: HistoryMetaSnapshot | null = null;

  function getHandler(id: string): CustomCommandHandler {
    const h = customHandlers.get(id);
    if (!h) {
      throw new Error(
        `slate-unified-history: no custom handler registered for id "${id}". Use registerCustomHandler().`,
      );
    }
    return h;
  }

  function applyCustomUndo(cmd: HistoryCustomCommand): void {
    for (let i = cmd.steps.length - 1; i >= 0; i--) {
      const s = cmd.steps[i];
      getHandler(s.id).undo(s.payload);
    }
  }

  function applyCustomRedo(cmd: HistoryCustomCommand): void {
    for (let i = 0; i < cmd.steps.length; i++) {
      const s = cmd.steps[i];
      getHandler(s.id).redo(s.payload);
    }
  }

  function bumpRevisionIfStacksChanged(): void {
    const u = undos.length;
    const r = redos.length;
    if (u !== lastUndosLen || r !== lastRedosLen) {
      lastUndosLen = u;
      lastRedosLen = r;
      revision++;
      metaCache = null;
    }
  }

  function scheduleMeta(): void {
    if (metaScheduled) return;
    metaScheduled = true;
    queueMicrotask(() => {
      metaScheduled = false;
      for (const l of metaListeners) l();
    });
  }

  function notifyDeep(): void {
    for (const l of deepListeners) l();
  }

  function clearRedosIfNeeded(): void {
    if (redos.length === 0) return;
    redos.length = 0;
    bumpRevisionIfStacksChanged();
  }

  function trimUndos(): void {
    while (undos.length > maxUndos) {
      undos.shift();
    }
    bumpRevisionIfStacksChanged();
  }

  function tryMergeCustomPush(
    incoming: PushCustomInput,
    opts?: PushCustomOptions,
  ): boolean {
    if (undos.length === 0) return false;
    const top = undos[undos.length - 1];
    if (top.kind !== "custom") return false;

    if (opts?.shouldMerge) {
      if (!opts.shouldMerge(top, incoming)) return false;
      undos[undos.length - 1] = appendCustomStepsMerge(top, incoming);
      clearRedosIfNeeded();
      notifyDeep();
      scheduleMeta();
      return true;
    }

    const effectiveMk = opts?.mergeKey ?? incoming.mergeKey;
    if (
      effectiveMk !== undefined &&
      top.mergeKey !== undefined &&
      top.mergeKey === effectiveMk
    ) {
      undos[undos.length - 1] = appendCustomStepsMerge(top, incoming);
      clearRedosIfNeeded();
      notifyDeep();
      scheduleMeta();
      return true;
    }

    return false;
  }

  function applySlateHistoryStep(
    editorKey: string,
    decision:
      | { action: "merge"; op: Operation }
      | { action: "newBatch"; batch: SlateHistoryBatch },
  ): void {
    clearRedosIfNeeded();

    if (decision.action === "merge") {
      const batch = findMergeTargetSlateBatch(undos, editorKey);
      if (batch) {
        batch.operations.push(decision.op);
        notifyDeep();
        scheduleMeta();
        return;
      }
      undos.push({
        kind: "slate",
        editorKey,
        batch: {
          operations: [decision.op],
          selectionBefore: null,
        },
      });
      bumpRevisionIfStacksChanged();
      trimUndos();
      notifyDeep();
      scheduleMeta();
      return;
    }

    undos.push({
      kind: "slate",
      editorKey,
      batch: decision.batch,
    });
    bumpRevisionIfStacksChanged();
    trimUndos();
    notifyDeep();
    scheduleMeta();
  }

  function resolveEditor(key: string): Editor {
    const e = editors.get(key);
    if (!e) {
      throw new Error(
        `slate-unified-history: no editor registered for key "${key}"`,
      );
    }
    return e;
  }

  const store: MemoryUnifiedHistoryStore = {
    applySlateHistoryStep,

    getMergeTargetSlateBatch(editorKey: string): SlateHistoryBatch | undefined {
      return findMergeTargetSlateBatch(undos, editorKey);
    },

    getMetaSnapshot(): HistoryMetaSnapshot {
      const canUndo = undos.length > 0;
      const canRedo = redos.length > 0;
      const c = metaCache;
      if (
        c &&
        c.canUndo === canUndo &&
        c.canRedo === canRedo &&
        c.revision === revision
      ) {
        return c;
      }
      metaCache = { canUndo, canRedo, revision };
      return metaCache;
    },

    subscribeMeta(listener: () => void): () => void {
      metaListeners.add(listener);
      return () => {
        metaListeners.delete(listener);
      };
    },

    subscribeDeep(listener: () => void): () => void {
      deepListeners.add(listener);
      return () => {
        deepListeners.delete(listener);
      };
    },

    registerCustomHandler(
      id: string,
      handler: CustomCommandHandler,
    ): () => void {
      customHandlers.set(id, handler);
      return () => {
        customHandlers.delete(id);
      };
    },

    pushCustom(input: PushCustomInput, opts?: PushCustomOptions): void {
      if (tryMergeCustomPush(input, opts)) {
        return;
      }
      clearRedosIfNeeded();
      undos.push({
        kind: "custom",
        steps: [{ id: input.id, payload: input.payload }],
        mergeKey: opts?.mergeKey ?? input.mergeKey,
      });
      bumpRevisionIfStacksChanged();
      trimUndos();
      notifyDeep();
      scheduleMeta();
    },

    undo(): void {
      if (undos.length === 0) return;
      const cmd = undos.pop()!;

      if (cmd.kind === "slate") {
        const editor = resolveEditor(cmd.editorKey);
        if (!HistoryEditor.isHistoryEditor(editor)) {
          throw new Error(
            "slate-unified-history: registered editor must be a HistoryEditor for slate undo",
          );
        }
        onWillApplySlateHistoryCommand?.({
          editor,
          editorKey: cmd.editorKey,
          command: cmd,
          direction: "undo",
        });
        HistoryEditor.withoutSaving(editor, () => {
          Editor.withoutNormalizing(editor, () => {
            const inverseOps = cmd.batch.operations
              .map(Operation.inverse)
              .reverse();
            for (const op of inverseOps) {
              editor.apply(op);
            }
            if (cmd.batch.selectionBefore) {
              Transforms.setSelection(editor, cmd.batch.selectionBefore);
            }
          });
        });
        redos.push(cmd);
      } else {
        applyCustomUndo(cmd);
        redos.push(cmd);
      }

      bumpRevisionIfStacksChanged();
      notifyDeep();
      scheduleMeta();
    },

    redo(): void {
      if (redos.length === 0) return;
      const cmd = redos.pop()!;

      if (cmd.kind === "slate") {
        const editor = resolveEditor(cmd.editorKey);
        if (!HistoryEditor.isHistoryEditor(editor)) {
          throw new Error(
            "slate-unified-history: registered editor must be a HistoryEditor for slate redo",
          );
        }
        onWillApplySlateHistoryCommand?.({
          editor,
          editorKey: cmd.editorKey,
          command: cmd,
          direction: "redo",
        });
        if (cmd.batch.selectionBefore) {
          Transforms.setSelection(editor, cmd.batch.selectionBefore);
        }
        HistoryEditor.withoutSaving(editor, () => {
          Editor.withoutNormalizing(editor, () => {
            for (const op of cmd.batch.operations) {
              editor.apply(op);
            }
          });
        });
        undos.push(cmd);
      } else {
        applyCustomRedo(cmd);
        undos.push(cmd);
      }

      bumpRevisionIfStacksChanged();
      notifyDeep();
      scheduleMeta();
    },

    getStacksForUI(): { undos: HistoryCommand[]; redos: HistoryCommand[] } {
      return { undos: [...undos], redos: [...redos] };
    },

    registerEditor(editorKey: string, editor: Editor): () => void {
      editors.set(editorKey, editor);
      return () => {
        editors.delete(editorKey);
      };
    },
  };

  return store;
}
