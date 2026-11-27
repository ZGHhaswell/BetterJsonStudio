import { invoke } from '@tauri-apps/api/core';

export type CliSource = 'configured' | 'path' | 'common_location';

export type AgentErrorCode =
  | 'cli_not_found'
  | 'invalid_cli_path'
  | 'cli_version_failed'
  | 'input_too_large'
  | 'spawn_failed'
  | 'authentication_failed'
  | 'network_failed'
  | 'quota_or_rate_limited'
  | 'model_failed'
  | 'timed_out'
  | 'cancelled'
  | 'invalid_agent_output'
  | 'unknown_cli_error';

export interface AgentCommandError {
  code: AgentErrorCode;
  message?: string;
}

export interface AgentCliStatus {
  available: boolean;
  path: string | null;
  version: string | null;
  source: CliSource | null;
  error: AgentCommandError | null;
}

export interface AgentRepairRequest {
  requestId: string;
  configuredPath: string;
  content: string;
}

const errorCodes = new Set<AgentErrorCode>([
  'cli_not_found',
  'invalid_cli_path',
  'cli_version_failed',
  'input_too_large',
  'spawn_failed',
  'authentication_failed',
  'network_failed',
  'quota_or_rate_limited',
  'model_failed',
  'timed_out',
  'cancelled',
  'invalid_agent_output',
  'unknown_cli_error',
]);

export class AgentServiceError extends Error {
  code: AgentErrorCode;

  constructor(code: AgentErrorCode, message?: string) {
    super(message || code);
    this.name = 'AgentServiceError';
    this.code = code;
  }
}

function normalizeAgentError(error: unknown): AgentServiceError {
  if (error instanceof AgentServiceError) return error;
  if (error && typeof error === 'object' && 'code' in error) {
    const value = error as { code?: unknown; message?: unknown };
    if (typeof value.code === 'string' && errorCodes.has(value.code as AgentErrorCode)) {
      return new AgentServiceError(
        value.code as AgentErrorCode,
        typeof value.message === 'string' ? value.message : undefined,
      );
    }
  }
  return new AgentServiceError('unknown_cli_error');
}

export async function detectCodexCli(configuredPath: string): Promise<AgentCliStatus> {
  try {
    return await invoke<AgentCliStatus>('detect_agent_cli', {
      agent: 'codex',
      configuredPath: configuredPath.trim() || null,
    });
  } catch (error) {
    throw normalizeAgentError(error);
  }
}

export async function selectCodexCli(): Promise<string | null> {
  try {
    return await invoke<string | null>('select_agent_cli', { agent: 'codex' });
  } catch (error) {
    throw normalizeAgentError(error);
  }
}

export async function repairJsonWithCodex(request: AgentRepairRequest): Promise<string> {
  try {
    const response = await invoke<{ repairedJson: string }>('repair_json_with_agent', {
      agent: 'codex',
      requestId: request.requestId,
      configuredPath: request.configuredPath.trim() || null,
      content: request.content,
    });
    return response.repairedJson;
  } catch (error) {
    throw normalizeAgentError(error);
  }
}

export async function cancelAgentTask(requestId: string): Promise<boolean> {
  try {
    return await invoke<boolean>('cancel_agent_task', { requestId });
  } catch (error) {
    throw normalizeAgentError(error);
  }
}
