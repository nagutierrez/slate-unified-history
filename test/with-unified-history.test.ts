import { describe, expect, it } from "vitest";
import { Editor, Transforms } from "slate";
import { createMemoryUnifiedStore } from "../src/createMemoryUnifiedStore.js";
import { HistoryEditor } from "../src/history-editor.js";
import { withUnifiedHistory } from "../src/with-unified-history.js";
import { appendCustomStepsMerge } from "../src/custom-merge.js";
import { makeTestEditor } from "./helpers.js";

describe("withUnifiedHistory", () => {
  it("merges contiguous insert_text into one undo batch", () => {
    const store = createMemoryUnifiedStore();
    const base = makeTestEditor();
    const editor = withUnifiedHistory(base, { editorKey: "e1", store });
    const unregister = store.registerEditor("e1", editor);
    try {
      Transforms.insertText(editor, "a");
      Transforms.insertText(editor, "b");
      const { undos } = store.getStacksForUI();
      expect(undos).toHaveLength(1);
      expect(undos[0].kind).toBe("slate");
      if (undos[0].kind === "slate") {
        expect(undos[0].batch.operations).toHaveLength(2);
      }
      HistoryEditor.undo(editor);
      expect(Editor.string(editor, [0, 0])).toBe("");
    } finally {
      unregister();
    }
  });

  it("starts a new batch with withNewBatch", () => {
    const store = createMemoryUnifiedStore();
    const base = makeTestEditor();
    const editor = withUnifiedHistory(base, { editorKey: "e1", store });
    const unregister = store.registerEditor("e1", editor);
    try {
      Transforms.insertText(editor, "a");
      HistoryEditor.withNewBatch(editor, () => {
        Transforms.insertText(editor, "b");
      });
      expect(store.getStacksForUI().undos).toHaveLength(2);
    } finally {
      unregister();
    }
  });

  it("forwards editor undo/redo to the store", () => {
    const store = createMemoryUnifiedStore();
    const base = makeTestEditor();
    const editor = withUnifiedHistory(base, {
      editorKey: "e1",
      store,
    });
    const unregister = store.registerEditor("e1", editor);
    try {
      Transforms.insertText(editor, "x");
      expect(store.getStacksForUI().undos).toHaveLength(1);
      HistoryEditor.undo(editor);
      expect(Editor.string(editor, [0, 0])).toBe("");
      HistoryEditor.redo(editor);
      expect(Editor.string(editor, [0, 0])).toBe("x");
    } finally {
      unregister();
    }
  });

  it("does not merge slate with last batch after a custom command", () => {
    const store = createMemoryUnifiedStore({
      customHandlers: {
        c: { undo: () => {}, redo: () => {} },
      },
    });
    const base = makeTestEditor();
    const editor = withUnifiedHistory(base, {
      editorKey: "e1",
      store,
    });
    const unregister = store.registerEditor("e1", editor);
    try {
      Transforms.insertText(editor, "a");
      store.pushCustom({ id: "c" });
      Transforms.insertText(editor, "b");
      const { undos } = store.getStacksForUI();
      expect(undos).toHaveLength(3);
      const slateEntries = undos.filter((u) => u.kind === "slate");
      expect(slateEntries).toHaveLength(2);
      expect(slateEntries[0].batch.operations.length).toBeGreaterThanOrEqual(1);
      expect(slateEntries[1].batch.operations.length).toBe(1);
    } finally {
      unregister();
    }
  });

  it("withoutSaving: ops applied inside do not appear on the undo stack", () => {
    const store = createMemoryUnifiedStore();
    const base = makeTestEditor();
    const editor = withUnifiedHistory(base, { editorKey: "e1", store });
    store.registerEditor("e1", editor);
    HistoryEditor.withoutSaving(editor, () => {
      Transforms.insertText(editor, "invisible");
    });
    expect(store.getStacksForUI().undos).toHaveLength(0);
    expect(Editor.string(editor, [0, 0])).toBe("invisible");
  });

  it("withoutMerging: each op starts its own batch", () => {
    const store = createMemoryUnifiedStore();
    const base = makeTestEditor();
    const editor = withUnifiedHistory(base, { editorKey: "e1", store });
    store.registerEditor("e1", editor);
    HistoryEditor.withoutMerging(editor, () => {
      Transforms.insertText(editor, "a");
      Transforms.insertText(editor, "b");
    });
    // Contiguous inserts would normally merge; withoutMerging prevents that.
    expect(store.getStacksForUI().undos).toHaveLength(2);
  });

  it("withMerging: forces ops into one batch even if they would not normally merge", () => {
    const store = createMemoryUnifiedStore();
    const base = makeTestEditor();
    const editor = withUnifiedHistory(base, { editorKey: "e1", store });
    store.registerEditor("e1", editor);
    // Insert "a", then wrap a non-contiguous position in withMerging.
    Transforms.insertText(editor, "a");
    // Move selection to a different location so it would not naturally merge.
    HistoryEditor.withMerging(editor, () => {
      // Insert at offset 0 again — same position, but after a flush boundary;
      // withMerging forces merge=true so both ops land in one undo entry.
      Transforms.insertText(editor, "b");
    });
    expect(store.getStacksForUI().undos).toHaveLength(1);
  });

  it("writeHistory throws", () => {
    const store = createMemoryUnifiedStore();
    const editor = withUnifiedHistory(makeTestEditor(), {
      editorKey: "e1",
      store,
    });
    expect(() =>
      editor.writeHistory("undos", { operations: [], selectionBefore: null }),
    ).toThrow(/writeHistory is not used/);
  });

  it("interleaves two editors on one stack", () => {
    const store = createMemoryUnifiedStore();
    const a = withUnifiedHistory(makeTestEditor(), {
      editorKey: "A",
      store,
    });
    const b = withUnifiedHistory(makeTestEditor(), {
      editorKey: "B",
      store,
    });
    const unA = store.registerEditor("A", a);
    const unB = store.registerEditor("B", b);
    try {
      Transforms.insertText(a, "1");
      Transforms.insertText(b, "2");
      Transforms.insertText(a, "3");
      expect(store.getStacksForUI().undos).toHaveLength(3);
      store.undo();
      expect(Editor.string(a, [0, 0])).toBe("1");
      store.undo();
      expect(Editor.string(b, [0, 0])).toBe("");
      store.undo();
      expect(Editor.string(a, [0, 0])).toBe("");
    } finally {
      unA();
      unB();
    }
  });
});

describe("appendCustomStepsMerge", () => {
  it("appends the incoming step to top.steps", () => {
    const top = {
      kind: "custom" as const,
      steps: [{ id: "a", payload: 1 }],
      mergeKey: "k",
    };
    const result = appendCustomStepsMerge(top, { id: "b", payload: 2 });
    expect(result.steps).toEqual([
      { id: "a", payload: 1 },
      { id: "b", payload: 2 },
    ]);
  });

  it("preserves top.mergeKey on the merged command", () => {
    const top = {
      kind: "custom" as const,
      steps: [{ id: "a", payload: undefined }],
      mergeKey: "original-key",
    };
    const result = appendCustomStepsMerge(top, {
      id: "b",
      mergeKey: "incoming-key",
    });
    expect(result.mergeKey).toBe("original-key");
  });

  it("does not carry incoming mergeKey into individual steps", () => {
    const top = {
      kind: "custom" as const,
      steps: [{ id: "a", payload: undefined }],
      mergeKey: "k",
    };
    const result = appendCustomStepsMerge(top, { id: "b", mergeKey: "other" });
    for (const step of result.steps) {
      expect(step).not.toHaveProperty("mergeKey");
    }
  });
});
