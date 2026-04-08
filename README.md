# slate-unified-history

**Unified** undo/redo for [Slate](https://github.com/ianstormtaylor/slate): one stack that interleaves Slate operation batches with app-level **custom commands** via `withUnifiedHistory` and `createMemoryUnifiedStore`.

For classic per-editor history on `editor.history`, use the upstream **[slate-history](https://www.npmjs.com/package/slate-history)** package (`withHistory` from `slate-history`).

## Concepts

| Idea                 | Meaning                                                                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Batch**            | One undo step for Slate: `{ operations, selectionBefore }`. Undo applies inverse ops, then restores `selectionBefore`.                                                                                           |
| **Unified store**    | One shared `undos` / `redos` stack of `HistoryCommand` entries; Slate edits from multiple editors and custom app work share one timeline.                                                                        |
| **`editorKey`**      | Stable string id for an editor instance; used to resolve which editor runs slate undo/redo and for Slate batch merge targeting.                                                                                  |
| **`HistoryCommand`** | `slate` (batch + `editorKey`) or `custom` (`steps` only on the stack). Same **`mergeKey`** on successive `pushCustom` calls appends another step (one undo row); undo/redo walk steps newest→first / first→last. |

Everything you import comes from the package root: `import { … } from 'slate-unified-history'`.

### Persistence

Custom entries on the stack are **plain data** (`steps`, optional `mergeKey`); **`undo` / `redo` still need** `registerCustomHandler` (or `customHandlers` at creation) for every step `id`. This package does not provide save/load or rehydration of history.

---

## Plugin: `withUnifiedHistory(editor, options)`

Wraps a Slate `Editor` so operations are recorded into **`options.store`**, and `editor.undo` / `editor.redo` delegate to that store. Merge/split behavior matches slate-history semantics (`HistoryEditor.withMerging`, `withNewBatch`, etc.).

**Options (`WithUnifiedHistoryOptions`)**

| Field           | Purpose                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| **`editorKey`** | Stable id for this editor; must match `store.registerEditor(editorKey, editor)`.                            |
| **`store`**     | Typically `createMemoryUnifiedStore()`; must expose `applySlateHistoryStep` and `getMergeTargetSlateBatch`. |

**Details**

- `editor.history` stays a valid empty `History` shape so `HistoryEditor.isHistoryEditor(editor)` works; **authoritative** stacks are in `store`.
- `editor.writeHistory` **throws** — use `store.pushCustom` (and the plugin’s `apply` path) for recording.

**Registration**

After wrapping, register the editor so undo/redo can find it:

```ts
import { createEditor } from "slate";
import {
  createMemoryUnifiedStore,
  withUnifiedHistory,
} from "slate-unified-history";

const store = createMemoryUnifiedStore({
  customHandlers: {
    /* … */
  },
});
const editor = withUnifiedHistory(createEditor(), {
  editorKey: "doc-main",
  store,
});
const unregister = store.registerEditor("doc-main", editor);
// when the editor unmounts or is replaced:
unregister();
```

---

## Store: `createMemoryUnifiedStore`

```ts
function createMemoryUnifiedStore(
  options?: CreateMemoryUnifiedStoreOptions,
): MemoryUnifiedHistoryStore;

type CreateMemoryUnifiedStoreOptions = {
  maxUndos?: number;
  customHandlers?: Record<string, CustomCommandHandler>;
};
```

Creates the default in-memory implementation of `UnifiedHistoryStore`. `maxUndos` defaults to **100** (same cap as slate-history).

**Custom handlers** map command **`id`** strings to `{ undo(payload), redo(payload) }`. Those functions live **outside** the stack; `pushCustom` only stores `id` + `payload`. Register at creation or via **`store.registerCustomHandler`** (returns unregister).

**Coalescing** uses **`mergeKey` only:** if the top undo entry is custom and its `mergeKey` equals the effective key on this push (`options.mergeKey ?? input.mergeKey`), the new push is **appended as another step** on that entry. No registration — same string on the stack and on the push is enough.

### `UnifiedHistoryStore` (public surface)

| Method                                   | Purpose                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`undo()`**                             | Removes the newest undo entry and pushes it onto `redos`. **Slate:** applies inverse operations on the registered editor. **Custom:** walks `steps` from the **last** step to the **first** and calls that step’s registered `undo` with its `payload` (so the most recently pushed step is undone first). |
| **`redo()`**                             | Removes the newest redo entry and pushes it back onto `undos`. **Slate:** reapplies stored operations. **Custom:** walks `steps` from **first** to **last** and calls each step’s registered `redo` with its `payload` (restoring the original order of actions).                                          |
| **`pushCustom(input, options?)`**        | Pushes `{ id, payload?, mergeKey? }` as one step, or appends to the top custom entry when `mergeKey` matches (see **Coalescing** above). Clears `redos`, enforces `maxUndos`.                                                                                                                              |
| **`registerCustomHandler(id, handler)`** | Register / replace handlers for an `id`. Returns **unregister**.                                                                                                                                                                                                                                           |
| **`registerEditor(key, editor)`**        | Maps `key` → `Editor` for slate undo/redo. Returns **unregister**.                                                                                                                                                                                                                                         |
| **`getMetaSnapshot()`**                  | `{ canUndo, canRedo, revision }`. Referentially stable when unchanged — good for `useSyncExternalStore`.                                                                                                                                                                                                   |
| **`subscribeMeta(listener)`**            | Batched meta notifications (one microtask per synchronous burst).                                                                                                                                                                                                                                          |
| **`subscribeDeep(listener)`**            | Fires on any stack change, including in-batch slate merges. High frequency.                                                                                                                                                                                                                                |
| **`getStacksForUI()`**                   | Shallow copies of `undos` / `redos`.                                                                                                                                                                                                                                                                       |

### `MemoryUnifiedHistoryStore` (integration extras)

| Member                                           | Purpose                                               |
| ------------------------------------------------ | ----------------------------------------------------- |
| **`applySlateHistoryStep(editorKey, decision)`** | Used by `withUnifiedHistory` — merge op vs new batch. |
| **`getMergeTargetSlateBatch(editorKey)`**        | Top slate batch for this editor, if any.              |

### `PushCustomOptions`

| Field                            | Purpose                                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`mergeKey`**                   | Stored on **new** custom entries (`options.mergeKey` overrides `input.mergeKey` for storage). If the top undo entry is custom and its `mergeKey` equals this push’s effective key, **append** one step instead of a new entry. |
| **`shouldMerge(top, incoming)`** | Optional: if `true`, append into the top **custom** entry even when `mergeKey` would not match.                                                                                                                                |

Redo stack is cleared whenever a new undoable action is recorded (same invariant as Slate).

---

## Types (`types.ts` re-exports)

| Type                                         | Role                                                         |
| -------------------------------------------- | ------------------------------------------------------------ |
| **`SlateHistoryBatch`**                      | Alias of `Batch`.                                            |
| **`HistorySlateCommand`**                    | `{ kind: 'slate'; editorKey; batch }`.                       |
| **`CustomHistoryStep`**                      | `{ id; payload? }` — one custom micro-step.                  |
| **`HistoryCustomCommand`**                   | `{ kind: 'custom'; steps: CustomHistoryStep[]; mergeKey? }`. |
| **`PushCustomInput`**                        | Argument to `pushCustom`: `{ id; payload?; mergeKey? }`.     |
| **`CustomCommandHandler`**                   | `{ undo(payload); redo(payload) }` for a given `id`.         |
| **`HistoryCommand`**                         | `HistorySlateCommand \| HistoryCustomCommand`.               |
| **`HistoryMetaSnapshot`**                    | `getMetaSnapshot()` return type.                             |
| **`PushCustomOptions`**                      | `mergeKey?`, `shouldMerge?`.                                 |
| **`CustomMergePredicate`**                   | `(top, incoming) => boolean` for `shouldMerge`.              |
| **`UnifiedHistoryStore`**                    | Store interface.                                             |
| **`WithUnifiedHistoryOptions`**              | `{ editorKey, store }`.                                      |
| **`CreateMemoryUnifiedStoreOptions`**        | `maxUndos?`, `customHandlers?`.                              |
| **`DecideMergeInput` / `DecideMergeResult`** | For **`decideHistoryMerge`**.                                |

---

## `History` and `HistoryEditor`

Types and helpers aligned with **slate-history** so flags and guards work the same way.

### `History` / `Batch` (`history.ts`)

- **`Batch`**: one saved slate step (`operations` + `selectionBefore`).
- **`History`**: `{ undos: Batch[]; redos: Batch[] }`.
- **`History.isHistory(value)`**: Type guard.

### `HistoryEditor` (`history-editor.ts`)

**Interface** (what your `Editor` becomes after `withUnifiedHistory`): extends Slate’s editor with `history`, `undo`, `redo`, `writeHistory` (the latter throws on the wrapped editor).

**`HistoryEditor` namespace** (static helpers): `isHistoryEditor`, `isSaving` / `isMerging` / `isSplittingOnce`, `setSplittingOnce`, `undo` / `redo`, `withMerging`, `withNewBatch`, `withoutMerging`, `withoutSaving`.

### WeakMaps (advanced)

- **`SAVING`**, **`MERGING`**, **`SPLITTING_ONCE`** — history behavior flags per editor.

---

## Pure helpers (`slate-merge.ts`)

| Function                                          | Purpose                                             |
| ------------------------------------------------- | --------------------------------------------------- |
| **`shouldSave`**, **`shouldMerge`**               | Slate op merge/save rules.                          |
| **`findMergeTargetSlateBatch(undos, editorKey)`** | Top slate batch for merge targeting.                |
| **`decideHistoryMerge(input)`**                   | `skip` / `merge` / `newBatch` for plugins or tests. |

---

## Quick recipes

**Per-editor history only** — use **`slate-history`**.

**Store + handlers**

```ts
const store = createMemoryUnifiedStore({
  customHandlers: {
    "toggle-sidebar": {
      undo: () => setOpen(true),
      redo: () => setOpen(false),
    },
  },
});

store.pushCustom({ id: "toggle-sidebar" });
```

**Coalesce rapid custom tweaks** (repeat the same `mergeKey`)

```ts
const store = createMemoryUnifiedStore({
  customHandlers: {
    slider: {
      undo: (v) => {
        /* restore previous value v */
      },
      redo: (v) => {
        /* apply value v */
      },
    },
  },
});

store.pushCustom({ id: "slider", payload: 10 }, { mergeKey: "slider" });
store.pushCustom({ id: "slider", payload: 20 }, { mergeKey: "slider" });
// One undo: undo(20) then undo(10); one redo: redo(10) then redo(20).
```

**Unified + React meta**

```ts
const store = createMemoryUnifiedStore({
  customHandlers: {
    /* … */
  },
});
// useSyncExternalStore(store.subscribeMeta, store.getMetaSnapshot)
```

---

## Example: undo / redo toolbar (React)

Subscribe with **`useSyncExternalStore`** so buttons update when `canUndo` / `canRedo` change, without subscribing to full stacks. Call **`store.undo()`** / **`store.redo()`** (or **`HistoryEditor.undo(editor)`** on an editor wired to the same store).

```tsx
import { useSyncExternalStore } from "react";
import type { UnifiedHistoryStore } from "slate-unified-history";

function useHistoryMeta(store: UnifiedHistoryStore) {
  return useSyncExternalStore(
    store.subscribeMeta,
    store.getMetaSnapshot,
    store.getMetaSnapshot,
  );
}

function UndoRedoToolbar({ store }: { store: UnifiedHistoryStore }) {
  const { canUndo, canRedo } = useHistoryMeta(store);
  return (
    <div>
      <button type="button" disabled={!canUndo} onClick={() => store.undo()}>
        Undo
      </button>
      <button type="button" disabled={!canRedo} onClick={() => store.redo()}>
        Redo
      </button>
    </div>
  );
}
```

Keyboard shortcuts can call the same **`store.undo()`** / **`store.redo()`** from a single module-level store reference.

---

## Render discipline (recommended)

Slate `apply` can run **many times per keystroke**. Prefer **`subscribeMeta` + `getMetaSnapshot()`** for toolbar state; use **`getStacksForUI()`** only for one-off menus, not per-keystroke React state. **`subscribeDeep`** is for expert UIs only.

---

## Anti-patterns

- Subscribing React to **`getStacksForUI()`** on every keystroke.
- **`pushCustom`** for an `id` with **no registered handler** — `undo` / `redo` will throw.
- Assuming **Slate `Operation`** payloads are always JSON-safe without checking (e.g. if you embed non-JSON in node data).

---

## Merge semantics (Slate)

Slate’s `shouldMerge` / `shouldSplit` behavior is preserved **per editor**: a new slate batch merges only into the **top** undo entry when that entry is a slate batch **for the same `editorKey`**. After a **custom** command or **another editor’s** slate entry, the next slate operations start a **new** batch even for the same editor.

---

## License

This project is released under the [MIT License](LICENSE). See [NOTICE](NOTICE) for third-party attribution.

Slate merge/save behavior and history shapes are **inspired by and compatible with** [slate-history](https://www.npmjs.com/package/slate-history) and [Slate](https://github.com/ianstormtaylor/slate). That does not imply endorsement by the Slate authors.
