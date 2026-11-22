import { z } from 'zod';
import type { ActionResult, AssistantAction, ToolRisk } from '@nexus/core';
import { addAuditLog, getPermissionPromptCount, hasToolPermission, incrementPermissionPromptCount } from '../db.js';
import { config } from '../config.js';

export interface ToolDefinition {
  name: string;
  description: string;
  risk: ToolRisk;
  argsSchema: z.ZodType<Record<string, unknown>>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  localDevice?: boolean;
}

const registry = new Map<string, ToolDefinition>();

export const MAX_PERMISSION_PROMPTS = 4;

export function registerTool(tool: ToolDefinition): void {
  registry.set(tool.name, tool);
}

export function listTools(): ToolDefinition[] {
  return [...registry.values()];
}

export function getTool(name: string): ToolDefinition | undefined {
  return registry.get(name);
}

export function toolCatalogForPrompt(): string {
  if (registry.size === 0) return 'No tools are currently registered.';
  return listTools()
    .map((tool) => `- ${tool.name} (${tool.risk}): ${tool.description}`)
    .join('\n');
}

export interface ExecuteContext {
  userId: string;
  sessionId?: string;
  requestText?: string;
  confirmed?: boolean;
  countedPromptTools?: Set<string>;
}

export async function executeAction(action: AssistantAction, context: ExecuteContext): Promise<ActionResult> {
  const tool = getTool(action.tool);
  const argsJson = JSON.stringify(action.arguments ?? {});

  const audit = (decision: string, status: ActionResult['status'], output?: unknown, error?: string, confirmation?: string) => {
    addAuditLog({
      user_id: context.userId,
      session_id: context.sessionId ?? null,
      request_text: context.requestText ?? null,
      tool_name: action.tool,
      arguments_json: argsJson,
      risk_level: tool?.risk ?? 'unknown',
      permission_decision: decision,
      confirmation: confirmation ?? null,
      result_status: status,
      result_output: output === undefined ? null : JSON.stringify(output).slice(0, 4000),
      error: error ?? null,
    });
  };

  if (!tool) {
    audit('rejected-unknown-tool', 'rejected', undefined, 'Tool is not registered');
    return { tool: action.tool, status: 'rejected', message: `Unknown tool "${action.tool}". It is not registered.` };
  }

  if (config.cloudMode && tool.localDevice) {
    audit('unavailable-cloud-mode', 'rejected', undefined, 'Local device action is disabled in cloud mode');
    return {
      tool: action.tool,
      status: 'rejected',
      message: `${tool.name} controls this device and is only available in the NEXUS desktop app — it is turned off in cloud mode.`,
    };
  }

  const parsed = tool.argsSchema.safeParse(action.arguments ?? {});
  if (!parsed.success) {
    audit('rejected-invalid-args', 'rejected', undefined, parsed.error.message.slice(0, 500));
    return { tool: action.tool, status: 'rejected', message: `Invalid arguments for ${action.tool}: ${parsed.error.issues[0]?.message ?? 'validation failed'}` };
  }

  const remembered = tool.risk !== 'safe' && hasToolPermission(context.userId, tool.name);
  if (tool.risk !== 'safe' && !context.confirmed && !remembered) {
    const alreadyCounted = context.countedPromptTools?.has(tool.name) ?? false;
    const promptsShown = alreadyCounted ? 0 : getPermissionPromptCount(context.userId, tool.name);
    if (promptsShown >= MAX_PERMISSION_PROMPTS) {
      audit('prompt-limit-reached', 'rejected', undefined, `Permission prompt limit (${MAX_PERMISSION_PROMPTS}) reached — action skipped`);
      return {
        tool: action.tool,
        status: 'rejected',
        message: `${tool.name} was already asked ${MAX_PERMISSION_PROMPTS} times and never allowed — skipping it now instead of asking again. You can reset permissions in Settings to re-enable prompts.`,
      };
    }
    if (!alreadyCounted) {
      incrementPermissionPromptCount(context.userId, tool.name);
      context.countedPromptTools?.add(tool.name);
    }
    audit('requires-confirmation', 'needs-confirmation', undefined, undefined, tool.risk);
    return {
      tool: action.tool,
      status: 'needs-confirmation',
      message: `${tool.name} is ${tool.risk} risk and requires explicit user confirmation before it can run.`,
    };
  }

  try {
    const output = await tool.handler(parsed.data);
    const decision = tool.risk === 'safe' ? 'auto-safe' : context.confirmed ? 'confirmed' : 'remembered-grant';
    audit(decision, 'completed', output);
    return { tool: action.tool, status: 'completed', output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    audit('execution-failed', 'error', undefined, message.slice(0, 500));
    return { tool: action.tool, status: 'error', message };
  }
}
