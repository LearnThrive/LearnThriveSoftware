export type LogCategory = 'signalling' | 'peer' | 'ice' | 'media' | 'devices' | 'chat' | 'stats';

/** Categorized logging so the console stays scannable instead of a wall of uncontrolled console.log calls. */
export function createLogger(category: LogCategory) {
  const prefix = `[LearnThrive][${category}]`;
  return {
    info: (...args: unknown[]) => { if (import.meta.env.DEV) console.info(prefix, ...args); },
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
  };
}
