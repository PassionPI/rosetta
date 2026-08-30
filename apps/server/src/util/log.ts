const ts = () => new Date().toISOString().slice(11, 23);
export const log = {
  info: (...a: unknown[]) => console.log(`[${ts()}] ℹ`, ...a),
  warn: (...a: unknown[]) => console.warn(`[${ts()}] ⚠`, ...a),
  error: (...a: unknown[]) => console.error(`[${ts()}] ✖`, ...a),
};
