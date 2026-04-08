import type { HistoryCustomCommand, PushCustomInput } from "./types.js";

/**
 * Append-merge: add `incoming` as a new step after `top.steps`, keep `top.mergeKey`.
 * Used by the memory store when {@link PushCustomOptions.mergeKey} matches the top custom entry.
 */
export function appendCustomStepsMerge(
  top: HistoryCustomCommand,
  incoming: PushCustomInput,
): HistoryCustomCommand {
  // Do not `{ ...incoming }`: `mergeKey` applies to the whole custom command, not each step.
  const { id, payload } = incoming;
  return {
    kind: "custom",
    steps: [...top.steps, { id, payload }],
    mergeKey: top.mergeKey,
  };
}
