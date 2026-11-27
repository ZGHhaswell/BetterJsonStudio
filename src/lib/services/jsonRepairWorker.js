import { createPersistentWorker } from './persistentWorker.js';

/**
 * @typedef {{
 *   promise: Promise<string | null>,
 *   cancel: () => void,
 * }} ActiveRepairTask
 */

/** @type {ActiveRepairTask | null} */
let activeTask = null;
const repairWorker = createPersistentWorker(
  () => new Worker(
    new URL('../workers/jsonRepair.worker.js', import.meta.url),
    { type: 'module' },
  ),
);

/**
 * 在 Worker 中执行本地修复，开始新任务前取消旧任务。
 *
 * @param {string} content
 * @param {number} indent
 */
export function repairJsonLocallyAsync(content, indent = 2) {
  cancelLocalJsonRepair();
  const task = repairWorker.run({ content, indent });
  activeTask = task;
  return task.promise.finally(() => {
    if (activeTask === task) activeTask = null;
  });
}

/** 取消当前本地修复任务。 */
export function cancelLocalJsonRepair() {
  const task = activeTask;
  activeTask = null;
  task?.cancel();
}
