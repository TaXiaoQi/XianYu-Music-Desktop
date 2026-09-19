export function useConcurrentScheduler() {
  let activePromise: Promise<any> | null = null;
  let pendingRequest: (() => Promise<any>) | null = null;

  const execute = <T>(taskFn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const wrappedTask = () => {
        return taskFn()
          .then(resolve)
          .catch(reject);
      };

      if (activePromise) {
        pendingRequest = wrappedTask;
        return;
      }

      const promise = wrappedTask();
      activePromise = promise;

      const cleanUpAndNext = () => {
        activePromise = null;
        if (pendingRequest) {
          const next = pendingRequest;
          pendingRequest = null;
          
          const nextPromise = next();
          activePromise = nextPromise;
          nextPromise.finally(cleanUpAndNext);
        }
      };

      promise.finally(cleanUpAndNext);
    });
  };

  const cancel = () => {
    pendingRequest = null;
  };

  return {
    execute,
    cancel,
  };
}
