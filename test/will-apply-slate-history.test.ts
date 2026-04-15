import { describe, expect, it, vi } from "vitest";
import { Editor, Transforms } from "slate";
import { createMemoryUnifiedStore } from "../src/createMemoryUnifiedStore.js";
import { HistoryEditor } from "../src/history-editor.js";
import { withUnifiedHistory } from "../src/with-unified-history.js";
import { makeTestEditor } from "./helpers.js";

describe("onWillApplySlateHistoryCommand", () => {
  it("runs synchronously before undo mutates the document", () => {
    const onWillApplySlateHistoryCommand = vi.fn();
    const store = createMemoryUnifiedStore({ onWillApplySlateHistoryCommand });
    const editor = withUnifiedHistory(makeTestEditor(), {
      editorKey: "e1",
      store,
    });
    store.registerEditor("e1", editor);
    Transforms.insertText(editor, "x");
    expect(Editor.string(editor, [0, 0])).toBe("x");

    onWillApplySlateHistoryCommand.mockImplementation(() => {
      expect(Editor.string(editor, [0, 0])).toBe("x");
    });
    store.undo();

    expect(onWillApplySlateHistoryCommand).toHaveBeenCalledTimes(1);
    const arg = onWillApplySlateHistoryCommand.mock.calls[0]![0]!;
    expect(arg.editorKey).toBe("e1");
    expect(arg.direction).toBe("undo");
    expect(arg.command.kind).toBe("slate");
    expect(arg.editor).toBe(editor);
    expect(Editor.string(editor, [0, 0])).toBe("");
  });

  it("runs synchronously before redo mutates the document", () => {
    const onWillApplySlateHistoryCommand = vi.fn();
    const store = createMemoryUnifiedStore({ onWillApplySlateHistoryCommand });
    const editor = withUnifiedHistory(makeTestEditor(), {
      editorKey: "e1",
      store,
    });
    store.registerEditor("e1", editor);
    Transforms.insertText(editor, "y");
    store.undo();
    expect(Editor.string(editor, [0, 0])).toBe("");

    onWillApplySlateHistoryCommand.mockClear();
    onWillApplySlateHistoryCommand.mockImplementation(() => {
      expect(Editor.string(editor, [0, 0])).toBe("");
    });
    store.redo();

    expect(onWillApplySlateHistoryCommand).toHaveBeenCalledTimes(1);
    expect(onWillApplySlateHistoryCommand.mock.calls[0]![0]!.direction).toBe(
      "redo",
    );
    expect(Editor.string(editor, [0, 0])).toBe("y");
  });

  it("is not invoked for custom undo", () => {
    const onWillApplySlateHistoryCommand = vi.fn();
    const store = createMemoryUnifiedStore({
      onWillApplySlateHistoryCommand,
      customHandlers: {
        noop: { undo: () => {}, redo: () => {} },
      },
    });
    const editor = withUnifiedHistory(makeTestEditor(), {
      editorKey: "e1",
      store,
    });
    store.registerEditor("e1", editor);
    store.pushCustom({ id: "noop" });
    store.undo();
    expect(onWillApplySlateHistoryCommand).not.toHaveBeenCalled();
  });

  it("is not invoked when undo is a no-op (empty stack)", () => {
    const onWillApplySlateHistoryCommand = vi.fn();
    const store = createMemoryUnifiedStore({ onWillApplySlateHistoryCommand });
    const editor = withUnifiedHistory(makeTestEditor(), {
      editorKey: "e1",
      store,
    });
    store.registerEditor("e1", editor);
    store.undo();
    expect(onWillApplySlateHistoryCommand).not.toHaveBeenCalled();
  });

  it("runs before HistoryEditor.undo when delegating from the editor", () => {
    const onWillApplySlateHistoryCommand = vi.fn();
    const store = createMemoryUnifiedStore({ onWillApplySlateHistoryCommand });
    const editor = withUnifiedHistory(makeTestEditor(), {
      editorKey: "e1",
      store,
    });
    store.registerEditor("e1", editor);
    Transforms.insertText(editor, "z");
    onWillApplySlateHistoryCommand.mockImplementation(() => {
      expect(Editor.string(editor, [0, 0])).toBe("z");
    });
    HistoryEditor.undo(editor);
    expect(Editor.string(editor, [0, 0])).toBe("");
    expect(onWillApplySlateHistoryCommand).toHaveBeenCalledTimes(1);
  });
});
