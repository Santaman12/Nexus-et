import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = ':memory:';
process.env.JWT_SECRET = 'vitest-secret';
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';

let executeAction: typeof import('./registry.js').executeAction;
let registerTool: typeof import('./registry.js').registerTool;
let getAuditLog: typeof import('../db.js').getAuditLog;
let createUser: typeof import('../db.js').createUser;
let registerAllTools: typeof import('./index.js').registerAllTools;

let userId = '';

beforeAll(async () => {
  ({ executeAction, registerTool } = await import('./registry.js'));
  ({ getAuditLog, createUser } = await import('../db.js'));
  ({ registerAllTools } = await import('./index.js'));
  registerAllTools();
  userId = createUser({ email: 'registry-test@example.com', name: 'Registry Test', passwordHash: 'x' }).id;
});

describe('tool registry and safety', () => {

  it('executes a registered safe tool and writes an audit entry', async () => {
    const result = await executeAction(
      { tool: 'get_datetime', arguments: {} },
      { userId, requestText: 'what time is it' },
    );
    expect(result.status).toBe('completed');
    expect((result.output as { unix: number }).unix).toBeGreaterThan(0);

    const audit = getAuditLog(userId);
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0].tool_name).toBe('get_datetime');
    expect(audit[0].result_status).toBe('completed');
    expect(audit[0].risk_level).toBe('safe');
  });

  it('rejects unknown tools without executing anything', async () => {
    const result = await executeAction(
      { tool: 'delete_everything', arguments: {} },
      { userId, requestText: 'delete everything' },
    );
    expect(result.status).toBe('rejected');
    expect(result.message).toContain('not registered');
  });

  it('rejects invalid arguments for a registered tool', async () => {
    const result = await executeAction(
      { tool: 'get_system_info', arguments: { bogus: true } },
      { userId },
    );
    expect(result.status).toBe('rejected');
    expect(result.message).toContain('Invalid arguments');
  });

  it('requires confirmation for non-safe tools and audits the decision', async () => {
    const { z } = await import('zod');
    registerTool({
      name: 'test_sensitive_tool',
      description: 'test-only sensitive tool',
      risk: 'sensitive',
      argsSchema: z.object({}).strict(),
      handler: () => 'should-not-run',
    });

    const denied = await executeAction(
      { tool: 'test_sensitive_tool', arguments: {} },
      { userId, requestText: 'do the sensitive thing' },
    );
    expect(denied.status).toBe('needs-confirmation');

    const allowed = await executeAction(
      { tool: 'test_sensitive_tool', arguments: {} },
      { userId, confirmed: true },
    );
    expect(allowed.status).toBe('completed');
    expect(allowed.output).toBe('should-not-run');
  });
});
