import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage<AbortSignal>();

/**
 * Runs a tool call with its cancel signal reachable from anywhere inside it (a handler, the gh and git runners)
 * without threading it through every function in between.
 */
export const withCallSignal = <T>(signal: AbortSignal, run: () => T): T => store.run(signal, run);

export const callSignal = (): AbortSignal | undefined => store.getStore();
