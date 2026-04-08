import { describe, expect, it } from "vitest";
import { createEditor } from "slate";
import { History } from "../src/history.js";
import { HistoryEditor, MERGING } from "../src/history-editor.js";
import { createMemoryUnifiedStore } from "../src/createMemoryUnifiedStore.js";
import { withUnifiedHistory } from "../src/with-unified-history.js";
import { makeTestEditor } from "./helpers.js";

describe("History.isHistory", () => {
  it("accepts an empty-stack history", () => {
    expect(History.isHistory({ undos: [], redos: [] })).toBe(true);
  });

  it("accepts stacks with valid batches", () => {
    const batch = {
      operations: [{ type: "insert_text", path: [0, 0], offset: 0, text: "a" }],
      selectionBefore: null,
    };
    expect(History.isHistory({ undos: [batch], redos: [] })).toBe(true);
  });

  it("rejects null", () => {
    expect(History.isHistory(null)).toBe(false);
  });

  it("rejects a plain object with no undo/redo arrays", () => {
    expect(History.isHistory({})).toBe(false);
  });

  it("rejects when redos is not an array", () => {
    expect(History.isHistory({ undos: [], redos: "x" })).toBe(false);
  });

  it("rejects when a batch's operations list contains a non-operation", () => {
    // isOperationList checks each element; { type: "bogus" } fails the check.
    const batch = { operations: [{ type: "bogus" }], selectionBefore: null };
    expect(History.isHistory({ undos: [batch], redos: [] })).toBe(false);
  });

  it("rejects a non-object (string)", () => {
    expect(History.isHistory("history")).toBe(false);
  });
});

describe("HistoryEditor.isHistoryEditor", () => {
  it("returns true for an editor wrapped with withUnifiedHistory", () => {
    const store = createMemoryUnifiedStore();
    const editor = withUnifiedHistory(makeTestEditor(), {
      editorKey: "e",
      store,
    });
    expect(HistoryEditor.isHistoryEditor(editor)).toBe(true);
  });

  it("returns false for a plain Slate editor (no history property)", () => {
    expect(HistoryEditor.isHistoryEditor(createEditor())).toBe(false);
  });

  it("returns false for null", () => {
    expect(HistoryEditor.isHistoryEditor(null)).toBe(false);
  });

  it("returns false for a non-editor object that has a history shape", () => {
    // Has history but is not a Slate editor.
    expect(
      HistoryEditor.isHistoryEditor({ history: { undos: [], redos: [] } }),
    ).toBe(false);
  });
});

describe("HistoryEditor flag getters and setters", () => {
  function makeHistoryEditor() {
    const store = createMemoryUnifiedStore();
    return withUnifiedHistory(makeTestEditor(), { editorKey: "e", store });
  }

  it("isSaving returns undefined when flag is not set", () => {
    const editor = makeHistoryEditor();
    expect(HistoryEditor.isSaving(editor)).toBeUndefined();
  });

  it("isSaving returns false when withoutSaving is active", () => {
    const editor = makeHistoryEditor();
    HistoryEditor.withoutSaving(editor, () => {
      expect(HistoryEditor.isSaving(editor)).toBe(false);
    });
  });

  it("isMerging returns undefined when flag is not set", () => {
    const editor = makeHistoryEditor();
    expect(HistoryEditor.isMerging(editor)).toBeUndefined();
  });

  it("isMerging returns the value set by withMerging / withoutMerging", () => {
    const editor = makeHistoryEditor();
    HistoryEditor.withMerging(editor, () => {
      expect(HistoryEditor.isMerging(editor)).toBe(true);
    });
    HistoryEditor.withoutMerging(editor, () => {
      expect(HistoryEditor.isMerging(editor)).toBe(false);
    });
  });

  it("isSplittingOnce / setSplittingOnce round-trip", () => {
    const editor = makeHistoryEditor();
    expect(HistoryEditor.isSplittingOnce(editor)).toBeUndefined();
    HistoryEditor.setSplittingOnce(editor, true);
    expect(HistoryEditor.isSplittingOnce(editor)).toBe(true);
    HistoryEditor.setSplittingOnce(editor, false);
    expect(HistoryEditor.isSplittingOnce(editor)).toBe(false);
    HistoryEditor.setSplittingOnce(editor, undefined);
    expect(HistoryEditor.isSplittingOnce(editor)).toBeUndefined();
  });

  it("flags are restored to previous values after scoped helpers return", () => {
    const editor = makeHistoryEditor();
    MERGING.set(editor, true);
    HistoryEditor.withoutMerging(editor, () => {});
    // restored to the value that was set before the call
    expect(HistoryEditor.isMerging(editor)).toBe(true);
  });
});
