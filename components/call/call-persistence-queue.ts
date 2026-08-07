// Browser-softphone hang-up logging and cockpit wrap-up both write the same
// authoritative snapshot. Keep those requests sequential within a tab so they
// cannot spend their transaction budgets racing each other for the snapshot CAS.
let callPersistenceTail: Promise<void> = Promise.resolve();

export function enqueueCallPersistence<T>(request: () => Promise<T>): Promise<T> {
  const result = callPersistenceTail.then(request);
  callPersistenceTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
