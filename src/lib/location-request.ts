// Browser location requests cannot be aborted. Discard callbacks after cancellation.
export function createLocationRequestGate() {
  let generation = 0;
  return {
    begin() {
      const current = ++generation;
      return () => current === generation;
    },
    cancel() { generation += 1; },
  };
}
