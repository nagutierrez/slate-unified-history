import { createEditor, Editor, Transforms } from "slate";
import type { HistoryEditor } from "../src/history-editor.js";

export function makeTestEditor(): HistoryEditor {
  const e = createEditor() as HistoryEditor;
  e.children = [
    {
      type: "paragraph",
      children: [{ text: "" }],
    },
  ] as HistoryEditor["children"];
  Transforms.select(e, Editor.start(e, []));
  return e;
}
