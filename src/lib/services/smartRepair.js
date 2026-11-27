import { formatStrictJson } from './jsonRepair.js';
import {
  cancelLocalJsonRepair,
  repairJsonLocallyAsync,
} from './jsonRepairWorker.js';
import { isValidJson } from '../utils/jsonBigInt.js';

export const MAX_AGENT_REPAIR_BYTES = 256 * 1024;

/**
 * @typedef {{
 *   requestId: string,
 *   configuredPath: string,
 *   content: string,
 * }} AgentRepairRequest
 */

/**
 * @typedef {{
 *   tabId: string,
 *   modelUri: string,
 *   modelVersion: number,
 *   content: string,
 * }} RepairSnapshot
 */

/**
 * @typedef {{ status: 'valid' } | { status: 'unrepairable' } | {
 *   status: 'repaired',
 *   source: 'local' | 'codex',
 *   content: string,
 * }} SmartRepairResult
 */

/**
 * @param {string} tabId
 * @param {string} modelUri
 * @param {number} modelVersion
 * @param {string} content
 * @returns {RepairSnapshot}
 */
export function createRepairSnapshot(tabId, modelUri, modelVersion, content) {
  return { tabId, modelUri, modelVersion, content };
}

/**
 * @param {RepairSnapshot} expected
 * @param {RepairSnapshot} current
 */
export function isRepairSnapshotCurrent(expected, current) {
  return expected.tabId === current.tabId &&
    expected.modelUri === current.modelUri &&
    expected.modelVersion === current.modelVersion &&
    expected.content === current.content;
}

/**
 * @type {{
 *   isStrictJson: (content: string) => boolean,
 *   repairLocal: (content: string, indent: number) => Promise<string | null>,
 *   repairAgent: (request: AgentRepairRequest) => Promise<string>,
 *   formatStrict: (content: string, indent: number) => string,
 *   byteLength: (content: string) => number,
 * }}
 */
const defaultDependencies = {
  isStrictJson: isValidJson,
  repairLocal: repairJsonLocallyAsync,
  repairAgent: async request => {
    const { repairJsonWithCodex } = await import('./agent.js');
    return repairJsonWithCodex(request);
  },
  formatStrict: formatStrictJson,
  byteLength: getUtf8ByteLength,
};

/** @param {string} requestId */
async function cancelAgentRepair(requestId) {
  const { cancelAgentTask } = await import('./agent.js');
  await cancelAgentTask(requestId);
}

const defaultCancellationDependencies = {
  cancelLocal: cancelLocalJsonRepair,
  cancelAgent: cancelAgentRepair,
};

/** @param {string} value */
function getUtf8ByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * 仅执行本地 JSON 修复，不会调用 Codex。
 *
 * @param {{ content: string, indent: number }} request
 * @param {Pick<typeof defaultDependencies, 'isStrictJson' | 'repairLocal'>} dependencies
 * @returns {Promise<SmartRepairResult>}
 */
export async function runLocalRepair(request, dependencies = defaultDependencies) {
  if (dependencies.isStrictJson(request.content)) return { status: 'valid' };

  const local = await dependencies.repairLocal(request.content, request.indent);
  if (local !== null) {
    return { status: 'repaired', source: 'local', content: local };
  }

  return { status: 'unrepairable' };
}

/**
 * 仅调用 Codex 修复 JSON，不会先尝试本地修复。
 *
 * @param {{ content: string, indent: number, requestId: string, codexPath: string }} request
 * @param {Pick<typeof defaultDependencies, 'isStrictJson' | 'repairAgent' | 'formatStrict' | 'byteLength'>} dependencies
 * @returns {Promise<SmartRepairResult>}
 */
export async function runCodexRepair(request, dependencies = defaultDependencies) {
  if (dependencies.isStrictJson(request.content)) return { status: 'valid' };

  if (dependencies.byteLength(request.content) > MAX_AGENT_REPAIR_BYTES) {
    throw Object.assign(new Error('Agent input is too large'), {
      code: 'input_too_large',
    });
  }

  const repaired = await dependencies.repairAgent({
    requestId: request.requestId,
    configuredPath: request.codexPath,
    content: request.content,
  });
  try {
    return {
      status: 'repaired',
      source: 'codex',
      content: dependencies.formatStrict(repaired, request.indent),
    };
  } catch {
    throw Object.assign(new Error('Agent output is not valid JSON'), {
      code: 'invalid_agent_output',
    });
  }
}

/**
 * @param {string} requestId
 * @param {'local' | 'codex'} mode
 * @param {typeof defaultCancellationDependencies} dependencies
 */
export async function cancelRepair(
  requestId,
  mode,
  dependencies = defaultCancellationDependencies,
) {
  if (mode === 'local') {
    dependencies.cancelLocal();
    return;
  }

  try {
    await dependencies.cancelAgent(requestId);
  } catch {
    // 取消属于尽力而为，不能覆盖原始操作结果。
  }
}
