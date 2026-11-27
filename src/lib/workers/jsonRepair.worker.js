import { tryRepairJsonLocally } from '../services/jsonRepair.js';

self.onmessage = (event) => {
  const { id, payload } = event.data;
  try {
    const result = tryRepairJsonLocally(payload.content, payload.indent);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Local JSON repair failed',
    });
  }
};
