import { describe, expect, it, vi } from "vitest";
import { createMemoryUnifiedStore } from "../src/createMemoryUnifiedStore.js";

describe("createMemoryUnifiedStore", () => {
  it("meta snapshot is referentially stable when stacks unchanged", () => {
    const store = createMemoryUnifiedStore();
    const a = store.getMetaSnapshot();
    const b = store.getMetaSnapshot();
    expect(a).toBe(b);
  });

  it("batches meta notifications in a microtask", async () => {
    const store = createMemoryUnifiedStore({
      customHandlers: {
        x: { undo: () => {}, redo: () => {} },
        y: { undo: () => {}, redo: () => {} },
      },
    });
    let n = 0;
    store.subscribeMeta(() => {
      n++;
    });
    store.pushCustom({ id: "x" });
    store.pushCustom({ id: "y" });
    expect(n).toBe(0);
    await Promise.resolve();
    expect(n).toBe(1);
  });

  it("merges when push mergeKey matches top custom entry mergeKey", () => {
    const u1 = vi.fn();
    const u2 = vi.fn();
    const r1 = vi.fn();
    const r2 = vi.fn();
    const store = createMemoryUnifiedStore({
      customHandlers: {
        g: {
          undo: (p) => {
            if (p === 1) u1();
            if (p === 2) u2();
          },
          redo: (p) => {
            if (p === 1) r1();
            if (p === 2) r2();
          },
        },
      },
    });
    store.pushCustom({ id: "g", payload: 1 }, { mergeKey: "k" });
    store.pushCustom({ id: "g", payload: 2 }, { mergeKey: "k" });
    expect(store.getStacksForUI().undos).toHaveLength(1);
    const top = store.getStacksForUI().undos[0];
    expect(top.kind).toBe("custom");
    if (top.kind === "custom") {
      expect(top.steps).toEqual([
        { id: "g", payload: 1 },
        { id: "g", payload: 2 },
      ]);
    }
    store.undo();
    expect(u2).toHaveBeenCalledTimes(1);
    expect(u1).toHaveBeenCalledTimes(1);
    store.redo();
    expect(r1).toHaveBeenCalledTimes(1);
    expect(r2).toHaveBeenCalledTimes(1);
  });

  it("does not merge when mergeKey differs from top entry", () => {
    const store = createMemoryUnifiedStore({
      customHandlers: { h: { undo: () => {}, redo: () => {} } },
    });
    store.pushCustom({ id: "h" }, { mergeKey: "a" });
    store.pushCustom({ id: "h" }, { mergeKey: "b" });
    expect(store.getStacksForUI().undos).toHaveLength(2);
  });

  it("merges with shouldMerge predicate (append steps)", () => {
    const store = createMemoryUnifiedStore({
      customHandlers: {
        a: { undo: () => {}, redo: () => {} },
        b: { undo: () => {}, redo: () => {} },
      },
    });
    store.pushCustom({ id: "a" });
    store.pushCustom({ id: "b" }, { shouldMerge: () => true });
    const undos = store.getStacksForUI().undos;
    expect(undos).toHaveLength(1);
    expect(undos[0].kind).toBe("custom");
    if (undos[0].kind === "custom") {
      expect(undos[0].steps.map((s) => s.id)).toEqual(["a", "b"]);
    }
  });

  it("serializes custom stack entries without handlers", () => {
    const store = createMemoryUnifiedStore({
      customHandlers: { noop: { undo: () => {}, redo: () => {} } },
    });
    store.pushCustom({ id: "noop", payload: { n: 1 } });
    const { undos } = store.getStacksForUI();
    const json = JSON.stringify(undos);
    expect(json).toContain("noop");
    expect(json).toContain('"n":1');
  });

  it("registerCustomHandler after creation", () => {
    const store = createMemoryUnifiedStore();
    const undo = vi.fn();
    const redo = vi.fn();
    const un = store.registerCustomHandler("z", { undo, redo });
    store.pushCustom({ id: "z" });
    store.undo();
    expect(undo).toHaveBeenCalledOnce();
    store.redo();
    expect(redo).toHaveBeenCalledOnce();
    un();
  });

  // subscribeDeep fires synchronously on each mutation.
  describe("subscribeDeep", () => {
    it("fires synchronously when pushCustom is called", () => {
      const store = createMemoryUnifiedStore({
        customHandlers: { a: { undo: () => {}, redo: () => {} } },
      });
      const listener = vi.fn();
      store.subscribeDeep(listener);
      store.pushCustom({ id: "a" });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("fires synchronously on undo and redo", () => {
      const store = createMemoryUnifiedStore({
        customHandlers: { a: { undo: () => {}, redo: () => {} } },
      });
      const listener = vi.fn();
      store.subscribeDeep(listener);
      store.pushCustom({ id: "a" });
      store.undo();
      store.redo();
      // pushCustom + undo + redo = 3 synchronous calls
      expect(listener).toHaveBeenCalledTimes(3);
    });

    it("stops firing after unsubscribe", () => {
      const store = createMemoryUnifiedStore({
        customHandlers: { a: { undo: () => {}, redo: () => {} } },
      });
      const listener = vi.fn();
      const unsub = store.subscribeDeep(listener);
      store.pushCustom({ id: "a" });
      unsub();
      store.undo();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("maxUndos trimming", () => {
    it("drops the oldest entry once the limit is exceeded", () => {
      const store = createMemoryUnifiedStore({
        maxUndos: 2,
        customHandlers: {
          a: { undo: () => {}, redo: () => {} },
          b: { undo: () => {}, redo: () => {} },
          c: { undo: () => {}, redo: () => {} },
        },
      });
      store.pushCustom({ id: "a" });
      store.pushCustom({ id: "b" });
      store.pushCustom({ id: "c" });
      const { undos } = store.getStacksForUI();
      expect(undos).toHaveLength(2);
      // "a" (oldest) is dropped; "b" and "c" remain.
      expect(undos[0].kind === "custom" && undos[0].steps[0].id).toBe("b");
      expect(undos[1].kind === "custom" && undos[1].steps[0].id).toBe("c");
    });
  });

  describe("error paths", () => {
    it("throws when undoing a slate command but no editor is registered for the key", () => {
      const store = createMemoryUnifiedStore();
      // Directly push a slate entry without registering an editor.
      store.applySlateHistoryStep("missing-editor", {
        action: "newBatch",
        batch: { operations: [], selectionBefore: null },
      });
      expect(() => store.undo()).toThrow(
        /no editor registered for key "missing-editor"/,
      );
    });

    it("throws when undoing a custom command whose handler id is not registered", () => {
      const store = createMemoryUnifiedStore({
        customHandlers: { registered: { undo: () => {}, redo: () => {} } },
      });
      // Push a valid entry first so we can test the handler-lookup path.
      store.pushCustom({ id: "registered" });
      // Now manually craft a situation: register a handler, push, then unregister it.
      const unsub = store.registerCustomHandler("gone", {
        undo: () => {},
        redo: () => {},
      });
      store.pushCustom({ id: "gone" });
      unsub(); // remove the handler before undo
      expect(() => store.undo()).toThrow(
        /no custom handler registered for id "gone"/,
      );
    });
  });

  describe("applySlateHistoryStep merge-fallback", () => {
    it("pushes a new slate entry when top is a custom command (no merge target)", () => {
      const store = createMemoryUnifiedStore({
        customHandlers: { c: { undo: () => {}, redo: () => {} } },
      });
      store.pushCustom({ id: "c" });
      // Ask to merge but the top of the stack is custom, not slate for "e1".
      store.applySlateHistoryStep("e1", {
        action: "merge",
        op: {
          type: "insert_text",
          path: [0, 0],
          offset: 0,
          text: "x",
        } as import("slate").Operation,
      });
      const { undos } = store.getStacksForUI();
      expect(undos).toHaveLength(2);
      expect(undos[1].kind).toBe("slate");
    });
  });

  describe("tryMergeCustomPush — shouldMerge returns false", () => {
    it("does not merge when shouldMerge predicate returns false", () => {
      const store = createMemoryUnifiedStore({
        customHandlers: { a: { undo: () => {}, redo: () => {} } },
      });
      store.pushCustom({ id: "a" });
      store.pushCustom({ id: "a" }, { shouldMerge: () => false });
      expect(store.getStacksForUI().undos).toHaveLength(2);
    });
  });

  describe("clearRedosIfNeeded", () => {
    it("clears the redo stack when a new command is pushed after an undo", () => {
      const store = createMemoryUnifiedStore({
        customHandlers: { a: { undo: () => {}, redo: () => {} } },
      });
      store.pushCustom({ id: "a" });
      store.undo();
      expect(store.getStacksForUI().redos).toHaveLength(1);
      store.pushCustom({ id: "a" });
      expect(store.getStacksForUI().redos).toHaveLength(0);
    });
  });

  describe("getStacksForUI", () => {
    it("returns shallow copies that do not expose the internal arrays", () => {
      const store = createMemoryUnifiedStore({
        customHandlers: { a: { undo: () => {}, redo: () => {} } },
      });
      store.pushCustom({ id: "a" });
      const snap1 = store.getStacksForUI();
      store.pushCustom({ id: "a" });
      const snap2 = store.getStacksForUI();
      // snap1 was taken before the second push, so it should still have length 1.
      expect(snap1.undos).toHaveLength(1);
      expect(snap2.undos).toHaveLength(2);
    });
  });
});
