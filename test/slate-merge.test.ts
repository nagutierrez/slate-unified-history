import { describe, expect, it } from "vitest";
import { Operation } from "slate";
import {
  decideHistoryMerge,
  findMergeTargetSlateBatch,
  shouldMerge,
  shouldSave,
} from "../src/slate-merge.js";

describe("shouldSave", () => {
  it("skips set_selection", () => {
    const op = {
      type: "set_selection",
      properties: null,
      newProperties: null,
    } as unknown as Operation;
    expect(shouldSave(op, undefined)).toBe(false);
  });

  it("saves insert_text and other content ops", () => {
    const op = {
      type: "insert_text",
      path: [0, 0],
      offset: 0,
      text: "a",
    } as Operation;
    expect(shouldSave(op, undefined)).toBe(true);
  });
});

describe("shouldMerge", () => {
  it("merges contiguous insert_text", () => {
    const a = {
      type: "insert_text",
      path: [0, 0],
      offset: 0,
      text: "a",
    } as Operation;
    const b = {
      type: "insert_text",
      path: [0, 0],
      offset: 1,
      text: "b",
    } as Operation;
    expect(shouldMerge(b, a)).toBe(true);
  });

  it("merges contiguous remove_text (backspace-style)", () => {
    // Each remove walks the offset backwards: offset + text.length === prev.offset.
    const a = {
      type: "remove_text",
      path: [0, 0],
      offset: 1,
      text: "b",
    } as Operation;
    const b = {
      type: "remove_text",
      path: [0, 0],
      offset: 0,
      text: "a",
    } as Operation;
    expect(shouldMerge(b, a)).toBe(true);
  });

  it("does not merge insert_text with a gap in offset", () => {
    const a = {
      type: "insert_text",
      path: [0, 0],
      offset: 0,
      text: "a",
    } as Operation;
    // offset 5 does not follow offset 0 + length 1.
    const b = {
      type: "insert_text",
      path: [0, 0],
      offset: 5,
      text: "b",
    } as Operation;
    expect(shouldMerge(b, a)).toBe(false);
  });

  it("does not merge insert_text on different paths", () => {
    const a = {
      type: "insert_text",
      path: [0, 0],
      offset: 0,
      text: "a",
    } as Operation;
    const b = {
      type: "insert_text",
      path: [0, 1],
      offset: 1,
      text: "b",
    } as Operation;
    expect(shouldMerge(b, a)).toBe(false);
  });

  it("does not merge when prev is undefined", () => {
    const op = {
      type: "insert_text",
      path: [0, 0],
      offset: 0,
      text: "a",
    } as Operation;
    expect(shouldMerge(op, undefined)).toBe(false);
  });
});

describe("findMergeTargetSlateBatch", () => {
  const batch = { operations: [], selectionBefore: null };

  it("returns undefined for an empty stack", () => {
    expect(findMergeTargetSlateBatch([], "e1")).toBeUndefined();
  });

  it("returns undefined when top is a custom command", () => {
    const undos = [{ kind: "custom" as const, steps: [], mergeKey: undefined }];
    expect(findMergeTargetSlateBatch(undos, "e1")).toBeUndefined();
  });

  it("returns undefined when top is slate for a different editorKey", () => {
    const undos = [{ kind: "slate" as const, editorKey: "other", batch }];
    expect(findMergeTargetSlateBatch(undos, "e1")).toBeUndefined();
  });

  it("returns the batch when top is slate for the matching editorKey", () => {
    const undos = [{ kind: "slate" as const, editorKey: "e1", batch }];
    expect(findMergeTargetSlateBatch(undos, "e1")).toBe(batch);
  });
});

describe("decideHistoryMerge", () => {
  const insertOp = (offset: number, text: string): Operation =>
    ({ type: "insert_text", path: [0, 0], offset, text }) as Operation;

  it("starts new batch when no last batch", () => {
    const op = insertOp(0, "x");
    const r = decideHistoryMerge({
      op,
      lastBatch: undefined,
      editorOperations: [op],
      saving: undefined,
      merging: undefined,
      splittingOnce: false,
      selection: null,
    });
    expect(r.action).toBe("newBatch");
    if (r.action === "newBatch") {
      expect(r.batch.operations).toEqual([op]);
    }
  });

  it("forces new batch when splitting once", () => {
    const prev = insertOp(0, "a");
    const next = insertOp(1, "b");
    const lastBatch = { operations: [prev], selectionBefore: null };
    const r = decideHistoryMerge({
      op: next,
      lastBatch,
      editorOperations: [prev, next],
      saving: undefined,
      merging: undefined,
      splittingOnce: true,
      selection: null,
    });
    expect(r.action).toBe("newBatch");
  });

  it("returns skip when saving is explicitly false", () => {
    const op = insertOp(0, "x");
    const r = decideHistoryMerge({
      op,
      lastBatch: undefined,
      editorOperations: [],
      saving: false,
      merging: undefined,
      splittingOnce: false,
      selection: null,
    });
    expect(r.action).toBe("skip");
  });

  it("merges when merging is explicitly true, even if shouldMerge would return false", () => {
    // Use ops on different paths so shouldMerge returns false.
    const prev = insertOp(0, "a");
    const next = {
      type: "insert_text",
      path: [1, 0],
      offset: 0,
      text: "b",
    } as Operation;
    const lastBatch = { operations: [prev], selectionBefore: null };
    const r = decideHistoryMerge({
      op: next,
      lastBatch,
      editorOperations: [],
      saving: undefined,
      merging: true,
      splittingOnce: false,
      selection: null,
    });
    expect(r.action).toBe("merge");
  });

  it("starts new batch when merging is explicitly false, even for contiguous ops", () => {
    const prev = insertOp(0, "a");
    const next = insertOp(1, "b");
    const lastBatch = { operations: [prev], selectionBefore: null };
    const r = decideHistoryMerge({
      op: next,
      lastBatch,
      editorOperations: [],
      saving: undefined,
      merging: false,
      splittingOnce: false,
      selection: null,
    });
    expect(r.action).toBe("newBatch");
  });

  it("forces merge when lastOp is in editorOperations (same-flush batch)", () => {
    // Ops that are non-contiguous paths would normally not merge via shouldMerge,
    // but since lastOp is still in the current flush (editorOperations), they should merge.
    const lastOp = {
      type: "insert_text",
      path: [1, 0],
      offset: 0,
      text: "x",
    } as Operation;
    const next = {
      type: "insert_text",
      path: [0, 0],
      offset: 0,
      text: "y",
    } as Operation;
    const lastBatch = { operations: [lastOp], selectionBefore: null };
    const r = decideHistoryMerge({
      op: next,
      lastBatch,
      editorOperations: [lastOp, next],
      saving: undefined,
      merging: undefined,
      splittingOnce: false,
      selection: null,
    });
    expect(r.action).toBe("merge");
  });

  it("merges via shouldMerge when lastBatch exists and ops are contiguous", () => {
    const prev = insertOp(0, "a");
    const next = insertOp(1, "b");
    const lastBatch = { operations: [prev], selectionBefore: null };
    const r = decideHistoryMerge({
      op: next,
      lastBatch,
      editorOperations: [],
      saving: undefined,
      merging: undefined,
      splittingOnce: false,
      selection: null,
    });
    expect(r.action).toBe("merge");
  });
});
