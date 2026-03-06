import { Agent, TimelineEvent, TranscriptEntry, LogEntry } from './agent-monitor.service';

// ── Time helpers ──

function ago(minutes: number, seconds = 0): Date {
  return new Date(Date.now() - minutes * 60_000 - seconds * 1_000);
}

function agoISO(minutes: number, seconds = 0): string {
  return ago(minutes, seconds).toISOString();
}

// ── Agent IDs & session IDs ──

const IDS = {
  a1: 'demo-a1b2c3d4e5f6a1000',
  a2: 'demo-f7e8d9c0b1a2f7000',
  a3: 'demo-1a2b3c4d5e6f1a000',
  a4: 'demo-9f8e7d6c5b4a9f000',
  a5: 'demo-3c4d5e6f7a8b3c000',
  a6: 'demo-7b8c9d0e1f2a7b000',
  // subagents of a1
  s1: 'demo-sub1a2b3c4d5e6f00',
  s2: 'demo-sub2f7e8d9c0b1a200',
  s3: 'demo-sub3c4d5e6f7a8b300',
};

const SESSIONS = {
  a1: 'demo-sess-a1',
  a2: 'demo-sess-a2',
  a3: 'demo-sess-a3',
  a4: 'demo-sess-a4',
  a5: 'demo-sess-a5',
  a6: 'demo-sess-a6',
  s1: 'demo-sess-s1',
  s2: 'demo-sess-s2',
  s3: 'demo-sess-s3',
};

// ── Mock Agents ──

export function getDemoAgents(): Agent[] {
  return [
    {
      id: IDS.a1, name: 'Claude Code', type: 'claude-code',
      status: 'working',
      currentTask: 'Refactoring authentication module to use JWT tokens',
      currentTool: 'Edit',
      currentToolDescription: 'src/auth/middleware.ts',
      workingDirectory: '~/projects/web-app',
      startTime: ago(14, 22),
      lastActivity: ago(0, 12),
      toolCalls: 23,
      recentTools: ['Edit', 'Read', 'Grep', 'Bash'],
      lastToolUsed: 'Edit',
      lastToolTime: ago(0, 12),
      pid: 48201,
      activeDuration: 14 * 60 + 22,
    },
    {
      id: IDS.s1, name: 'Claude Code', type: 'claude-code',
      status: 'working',
      currentTask: 'Updating auth test fixtures',
      currentTool: 'Write',
      currentToolDescription: 'tests/fixtures/auth.json',
      workingDirectory: '~/projects/web-app',
      startTime: ago(6, 45),
      lastActivity: ago(0, 30),
      toolCalls: 8,
      recentTools: ['Write', 'Read'],
      lastToolUsed: 'Write',
      lastToolTime: ago(0, 30),
      pid: 48305,
      parentPid: 48201,
      activeDuration: 6 * 60 + 45,
    },
    {
      id: IDS.s2, name: 'Claude Code', type: 'claude-code',
      status: 'completed',
      currentTask: 'Generated API documentation for auth endpoints',
      lastTask: 'Generated API documentation for auth endpoints',
      workingDirectory: '~/projects/web-app',
      startTime: ago(10, 15),
      lastActivity: ago(4, 30),
      toolCalls: 12,
      recentTools: ['Read', 'Write', 'Glob'],
      lastToolUsed: 'Write',
      lastToolTime: ago(4, 30),
      pid: 48290,
      parentPid: 48201,
      activeDuration: 5 * 60 + 45,
    },
    {
      id: IDS.s3, name: 'Claude Code', type: 'claude-code',
      status: 'working',
      currentTask: 'Updating route guards for JWT auth',
      currentTool: 'Edit',
      currentToolDescription: 'src/routes/guards.ts',
      workingDirectory: '~/projects/web-app',
      startTime: ago(3, 20),
      lastActivity: ago(0, 18),
      toolCalls: 5,
      recentTools: ['Read', 'Edit'],
      lastToolUsed: 'Edit',
      lastToolTime: ago(0, 18),
      pid: 48410,
      parentPid: 48201,
      activeDuration: 3 * 60 + 20,
    },
    {
      id: IDS.a2, name: 'Claude Code', type: 'claude-code',
      status: 'working',
      currentTask: 'Fix the failing stripe webhook test',
      currentTool: 'Bash',
      currentToolDescription: 'npm test -- --watch payments',
      workingDirectory: '~/projects/api-server',
      startTime: ago(12, 0),
      lastActivity: ago(0, 45),
      toolCalls: 17,
      recentTools: ['Write', 'Bash', 'Read', 'Edit'],
      lastToolUsed: 'Bash',
      lastToolTime: ago(0, 45),
      pid: 48150,
      activeDuration: 12 * 60,
    },
    {
      id: IDS.a3, name: 'Claude Code', type: 'claude-code',
      status: 'awaiting-permission',
      currentTask: 'Awaiting permission -- Edit package.json',
      currentTool: 'Edit',
      workingDirectory: '~/projects/web-app',
      startTime: ago(3, 10),
      lastActivity: ago(1, 20),
      toolCalls: 5,
      recentTools: ['Read', 'Grep', 'Edit'],
      lastToolUsed: 'Edit',
      lastToolTime: ago(1, 20),
      pid: 48380,
      activeDuration: 3 * 60 + 10,
    },
    {
      id: IDS.a4, name: 'Claude Code', type: 'claude-code',
      status: 'completed',
      currentTask: 'Database migration complete',
      lastTask: 'Database migration complete',
      workingDirectory: '~/projects/data-service',
      startTime: ago(22, 0),
      lastActivity: ago(11, 30),
      toolCalls: 31,
      recentTools: ['Bash', 'Write', 'Read'],
      lastToolUsed: 'Bash',
      lastToolTime: ago(11, 30),
      pid: 47980,
      activeDuration: 10 * 60 + 30,
    },
    {
      id: IDS.a5, name: 'Claude Code', type: 'claude-code',
      status: 'idle',
      currentTask: 'Idle -- session started, awaiting prompt',
      workingDirectory: '~/projects/mobile-app',
      startTime: ago(1, 15),
      lastActivity: ago(1, 15),
      toolCalls: 0,
      recentTools: [],
      pid: 48420,
      activeDuration: 75,
    },
    {
      id: IDS.a6, name: 'Claude Code', type: 'claude-code',
      status: 'working',
      currentTask: 'Implementing cursor-based pagination hook',
      currentTool: 'Read',
      currentToolDescription: 'src/components/SearchResults.tsx',
      workingDirectory: '~/projects/web-app',
      startTime: ago(9, 0),
      lastActivity: ago(0, 8),
      toolCalls: 11,
      recentTools: ['Edit', 'Read', 'Grep'],
      lastToolUsed: 'Read',
      lastToolTime: ago(0, 8),
      pid: 48350,
      activeDuration: 9 * 60,
    },
  ];
}

// ── Mock Timeline Events ──

export function getDemoEvents(): TimelineEvent[] {
  // Helper to generate a working burst: UserPromptSubmit + N tool pairs + Stop
  type E = { type: string; agentKey: keyof typeof IDS; minutesAgo: number; secondsAgo?: number; message?: string; meta?: any };
  function burst(agentKey: keyof typeof IDS, startMin: number, startSec: number, tools: string[], msg?: string): E[] {
    const out: E[] = [];
    let m = startMin, s = startSec;
    if (msg) out.push({ type: 'UserPromptSubmit', agentKey, minutesAgo: m, secondsAgo: s, message: msg });
    for (const tool of tools) {
      s -= 2; if (s < 0) { m--; s += 60; }
      out.push({ type: 'PreToolUse', agentKey, minutesAgo: m, secondsAgo: s, meta: { tool_name: tool } });
      s -= 3; if (s < 0) { m--; s += 60; }
      out.push({ type: 'PostToolUse', agentKey, minutesAgo: m, secondsAgo: s, meta: { tool_name: tool } });
    }
    return out;
  }
  function stop(agentKey: keyof typeof IDS, m: number, s: number): E { return { type: 'Stop', agentKey, minutesAgo: m, secondsAgo: s }; }
  function sess(agentKey: keyof typeof IDS, m: number, s = 0): E { return { type: 'SessionStart', agentKey, minutesAgo: m, secondsAgo: s }; }
  function sub(type: 'SubagentStart' | 'SubagentStop', agentKey: keyof typeof IDS, m: number, s: number): E { return { type, agentKey, minutesAgo: m, secondsAgo: s }; }
  function perm(agentKey: keyof typeof IDS, m: number, s: number, meta: any): E { return { type: 'PermissionRequest', agentKey, minutesAgo: m, secondsAgo: s, meta }; }
  function fail(agentKey: keyof typeof IDS, m: number, s: number, meta: any): E { return { type: 'PostToolUseFailure', agentKey, minutesAgo: m, secondsAgo: s, meta }; }

  const T = ['Read','Edit','Grep','Write','Bash']; // shorthand
  const events: E[] = [
    // ── a1: dense bursts with idle gaps, subagents ──
    sess('a1', 14, 22),
    ...burst('a1', 14, 20, ['Read','Grep','Read','Read','Edit','Edit','Read','Edit','Edit','Bash'], 'Refactor the auth middleware to use JWT tokens'),
    stop('a1', 13, 20),
    // idle ~40s
    ...burst('a1', 12, 40, ['Read','Edit','Edit','Edit','Read','Edit'], 'Update the login handler for JWT'),
    stop('a1', 12, 5),
    // idle ~25s
    sub('SubagentStart', 's2', 11, 40),
    ...burst('a1', 11, 38, ['Edit','Bash','Read','Edit']),
    ...burst('s2', 11, 35, ['Read','Write','Read','Write','Write']),
    stop('a1', 11, 10),
    sub('SubagentStop', 's2', 10, 50),
    // idle ~20s
    sub('SubagentStart', 's1', 10, 30),
    ...burst('a1', 10, 28, ['Bash','Edit','Edit'], 'Run auth tests and fix failures'),
    ...burst('s1', 10, 25, ['Read','Write','Read']),
    stop('a1', 10, 0),
    // idle ~30s
    sub('SubagentStart', 's3', 9, 30),
    ...burst('a1', 9, 28, ['Edit','Edit','Read','Edit','Edit','Edit','Bash','Edit'], 'Final cleanup and run full test suite'),
    ...burst('s1', 9, 25, ['Write','Write','Read']),
    ...burst('s3', 9, 22, ['Read','Edit','Edit','Read']),
    stop('a1', 8, 45),
    // idle ~25s
    ...burst('a1', 8, 20, ['Edit','Edit','Bash']),
    stop('a1', 7, 55),
    // idle ~35s
    ...burst('s1', 7, 30, ['Write','Write']),
    ...burst('s3', 7, 25, ['Edit','Edit']),
    ...burst('a1', 7, 20, ['Read','Edit']),
    stop('a1', 6, 55),
    // idle ~25s
    ...burst('a1', 6, 30, ['Edit','Bash']),
    stop('a1', 6, 10),
    // idle ~30s
    ...burst('a1', 5, 40, ['Edit','Read','Edit']),
    stop('a1', 5, 10),
    // idle ~20s
    ...burst('s3', 4, 55, ['Edit']),
    ...burst('a1', 4, 50, ['Bash','Read','Edit']),
    stop('a1', 4, 25),
    // idle ~25s
    ...burst('a1', 4, 0, ['Edit','Edit']),
    stop('a1', 3, 40),
    // idle ~30s
    ...burst('s1', 3, 20, ['Write']),
    ...burst('s3', 3, 15, ['Edit','Edit']),
    ...burst('a1', 3, 10, ['Edit','Bash']),
    stop('a1', 2, 48),
    // idle ~18s
    ...burst('a1', 2, 30, ['Edit']),
    stop('a1', 2, 20),
    // idle ~20s
    ...burst('a1', 2, 0, ['Edit','Bash','Read']),
    ...burst('s3', 1, 55, ['Edit']),
    // a1 still working

    // ── a2: many task cycles, big + small bursts ──
    sess('a2', 13, 0),
    ...burst('a2', 12, 58, ['Read','Read','Grep','Read','Write','Write','Edit','Bash','Read','Edit'], 'Write integration tests for payments'),
    stop('a2', 12, 5),
    // idle ~35s
    ...burst('a2', 11, 30, ['Read','Edit','Edit','Bash','Bash'], 'Fix the failing stripe webhook test'),
    stop('a2', 11, 0),
    // idle ~40s
    ...burst('a2', 10, 20, ['Read','Edit','Edit','Write','Bash','Read','Edit','Bash'], 'Mock the signature verification'),
    stop('a2', 9, 35),
    // idle ~25s
    ...burst('a2', 9, 10, ['Read','Write','Bash']),
    stop('a2', 8, 50),
    // idle ~30s
    ...burst('a2', 8, 20, ['Edit','Edit','Bash'], 'Add refund edge case tests'),
    stop('a2', 7, 55),
    // idle ~25s
    ...burst('a2', 7, 30, ['Write','Bash']),
    stop('a2', 7, 10),
    // idle ~40s
    ...burst('a2', 6, 30, ['Read','Edit','Edit','Bash','Read','Edit']),
    stop('a2', 5, 55),
    // idle ~25s
    ...burst('a2', 5, 30, ['Edit','Bash']),
    stop('a2', 5, 10),
    // idle ~30s
    ...burst('a2', 4, 40, ['Read','Edit']),
    stop('a2', 4, 20),
    // idle ~20s
    ...burst('a2', 4, 0, ['Bash']),
    stop('a2', 3, 50),
    // idle ~30s
    ...burst('a2', 3, 20, ['Edit','Edit','Bash'], 'Run full payment test suite'),
    stop('a2', 2, 55),
    // idle ~25s
    ...burst('a2', 2, 30, ['Read','Edit']),
    stop('a2', 2, 10),
    // idle ~30s
    ...burst('a2', 1, 40, ['Edit','Bash','Bash']),

    // ── a3: working -> waiting ──
    sess('a3', 3, 10),
    ...burst('a3', 3, 8, ['Read','Grep','Read'], 'Add lodash dependency and update utility helpers'),
    perm('a3', 2, 30, { tool_name: 'Edit', file: 'package.json' }),

    // ── a4: working -> fail -> working -> idle cycles -> completed ──
    sess('a4', 14),
    ...burst('a4', 13, 58, ['Read','Read','Write','Edit','Bash'], 'Run database migration for user_preferences'),
    fail('a4', 13, 25, { tool_name: 'Bash', error: 'column already exists' }),
    ...burst('a4', 13, 18, ['Edit','Edit','Bash','Bash']),
    stop('a4', 12, 45),
    // idle ~25s
    ...burst('a4', 12, 20, ['Bash','Write','Bash','Read','Bash'], 'Verify migration and seed defaults'),
    stop('a4', 11, 40),
    // idle ~30s
    ...burst('a4', 11, 10, ['Read','Write','Bash']),
    stop('a4', 10, 50),
    // idle ~20s
    ...burst('a4', 10, 30, ['Bash','Bash']),
    stop('a4', 10, 10),
    // idle ~40s
    ...burst('a4', 9, 30, ['Read','Write','Bash'], 'Run final validation'),
    stop('a4', 9, 0),
    // idle ~30s
    ...burst('a4', 8, 30, ['Bash']),
    stop('a4', 8, 20),
    // idle ~20s
    ...burst('a4', 8, 0, ['Bash','Bash']),
    stop('a4', 7, 40),

    // ── a5: idle (just started) ──
    sess('a5', 1, 15),

    // ── a6: lots of short bursts ──
    sess('a6', 14, 0),
    ...burst('a6', 13, 58, ['Grep','Read','Read','Grep','Read'], 'Find all search-related components'),
    stop('a6', 13, 25),
    // idle ~25s
    ...burst('a6', 13, 0, ['Read','Edit','Edit','Read','Edit','Edit','Edit'], 'Add cursor-based pagination'),
    stop('a6', 12, 15),
    // idle ~25s
    ...burst('a6', 11, 50, ['Edit','Bash','Read','Edit']),
    stop('a6', 11, 20),
    // idle ~30s
    ...burst('a6', 10, 50, ['Read','Edit','Edit'], 'Wire up the usePagination hook'),
    stop('a6', 10, 25),
    // idle ~25s
    ...burst('a6', 10, 0, ['Edit','Edit','Edit','Bash','Edit']),
    stop('a6', 9, 25),
    // idle ~35s
    ...burst('a6', 8, 50, ['Read','Edit','Edit'], 'Add loading states and error handling'),
    stop('a6', 8, 20),
    // idle ~20s
    ...burst('a6', 8, 0, ['Edit','Bash']),
    stop('a6', 7, 40),
    // idle ~30s
    ...burst('a6', 7, 10, ['Read','Edit','Edit','Bash','Read']),
    stop('a6', 6, 30),
    // idle ~20s
    ...burst('a6', 6, 10, ['Edit','Edit']),
    stop('a6', 5, 50),
    // idle ~30s
    ...burst('a6', 5, 20, ['Edit','Bash','Read']),
    stop('a6', 4, 50),
    // idle ~20s
    ...burst('a6', 4, 30, ['Edit']),
    stop('a6', 4, 20),
    // idle ~30s
    ...burst('a6', 3, 50, ['Read','Edit','Edit']),
    stop('a6', 3, 20),
    // idle ~20s
    ...burst('a6', 3, 0, ['Edit','Bash']),
    stop('a6', 2, 40),
    // idle ~20s
    ...burst('a6', 2, 20, ['Edit']),
    stop('a6', 2, 10),
    // idle ~20s
    ...burst('a6', 1, 50, ['Edit','Bash','Read']),

  ];

  const agentNames: Record<string, string> = {
    a1: 'Claude Code', a2: 'Claude Code', a3: 'Claude Code',
    a4: 'Claude Code', a5: 'Claude Code', a6: 'Claude Code',
    s1: 'Claude Code', s2: 'Claude Code', s3: 'Claude Code',
  };

  return events.map(e => ({
    event_type: e.type,
    agent_id: IDS[e.agentKey],
    agent_name: agentNames[e.agentKey],
    session_id: SESSIONS[e.agentKey],
    timestamp: agoISO(e.minutesAgo, e.secondsAgo || 0),
    message: e.message || null,
    metadata: e.meta || {},
  }));
}

// ── Mock Transcripts ──

function buildA1Transcript(): TranscriptEntry[] {
  const agentId = IDS.a1;
  const sessionId = SESSIONS.a1;
  let line = 1;

  return [
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'user',
      content: 'Refactor the auth middleware to use JWT tokens instead of session-based authentication. Update the login and logout handlers accordingly.',
      tool_name: null, tool_input: null, tool_use_id: null,
      timestamp: agoISO(14, 20), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'assistant',
      content: 'I\'ll refactor the auth middleware from session-based to JWT authentication. Let me start by reading the current implementation to understand the existing code structure.',
      tool_name: null, tool_input: null, tool_use_id: null,
      timestamp: agoISO(14, 15), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'tool_use',
      content: null,
      tool_name: 'Read', tool_input: JSON.stringify({ file_path: 'src/auth/middleware.ts' }),
      tool_use_id: 'toolu_demo_001',
      timestamp: agoISO(13, 50), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'tool_result',
      content: 'import { Request, Response, NextFunction } from \'express\';\nimport session from \'express-session\';\n\nexport function authMiddleware(req: Request, res: Response, next: NextFunction) {\n  if (!req.session?.userId) {\n    return res.status(401).json({ error: \'Not authenticated\' });\n  }\n  next();\n}\n\nexport function loginHandler(req: Request, res: Response) {\n  const { email, password } = req.body;\n  // ... validate credentials\n  req.session.userId = user.id;\n  res.json({ success: true });\n}',
      tool_name: 'Read', tool_input: null, tool_use_id: 'toolu_demo_001',
      timestamp: agoISO(13, 48), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'tool_use',
      content: null,
      tool_name: 'Grep', tool_input: JSON.stringify({ pattern: 'session', path: 'src/', glob: '*.ts' }),
      tool_use_id: 'toolu_demo_002',
      timestamp: agoISO(13, 10), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'tool_result',
      content: 'src/auth/middleware.ts:2: import session from \'express-session\';\nsrc/auth/middleware.ts:5: if (!req.session?.userId) {\nsrc/auth/middleware.ts:12: req.session.userId = user.id;\nsrc/routes/api.ts:4: import { authMiddleware } from \'../auth/middleware\';',
      tool_name: 'Grep', tool_input: null, tool_use_id: 'toolu_demo_002',
      timestamp: agoISO(13, 5), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'assistant',
      content: 'I can see the session-based auth pattern. I\'ll now replace it with JWT-based authentication. I need to:\n\n1. Replace the session import with jsonwebtoken\n2. Update the middleware to verify JWT from the Authorization header\n3. Update login to return a JWT token\n4. Add a logout handler that works with token-based auth',
      tool_name: null, tool_input: null, tool_use_id: null,
      timestamp: agoISO(12, 45), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'tool_use',
      content: null,
      tool_name: 'Read', tool_input: JSON.stringify({ file_path: 'src/config/auth.ts' }),
      tool_use_id: 'toolu_demo_003',
      timestamp: agoISO(12, 30), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'tool_result',
      content: 'export const AUTH_CONFIG = {\n  sessionSecret: process.env.SESSION_SECRET || \'dev-secret\',\n  cookieMaxAge: 24 * 60 * 60 * 1000,\n};',
      tool_name: 'Read', tool_input: null, tool_use_id: 'toolu_demo_003',
      timestamp: agoISO(12, 28), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'tool_use',
      content: null,
      tool_name: 'Edit', tool_input: JSON.stringify({
        file_path: 'src/auth/middleware.ts',
        old_string: "import session from 'express-session';",
        new_string: "import jwt from 'jsonwebtoken';\nimport { AUTH_CONFIG } from '../config/auth';",
      }),
      tool_use_id: 'toolu_demo_004',
      timestamp: agoISO(11, 0), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'tool_result',
      content: 'File edited successfully.',
      tool_name: 'Edit', tool_input: null, tool_use_id: 'toolu_demo_004',
      timestamp: agoISO(10, 55), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'tool_use',
      content: null,
      tool_name: 'Bash', tool_input: JSON.stringify({ command: 'cd ~/projects/web-app && npm test -- --grep "auth"' }),
      tool_use_id: 'toolu_demo_005',
      timestamp: agoISO(4, 0), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'tool_result',
      content: 'PASS  tests/auth/middleware.test.ts\n  Auth Middleware\n    ✓ should reject requests without token (3ms)\n    ✓ should reject invalid tokens (2ms)\n    ✓ should pass valid JWT tokens (4ms)\n    ✓ should extract user from token payload (2ms)\n\nPASS  tests/auth/login.test.ts\n  Login Handler\n    ✓ should return JWT on valid credentials (5ms)\n    ✓ should reject invalid credentials (2ms)\n\nTest Suites: 2 passed, 2 total\nTests:       6 passed, 6 total',
      tool_name: 'Bash', tool_input: null, tool_use_id: 'toolu_demo_005',
      timestamp: agoISO(3, 30), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'assistant',
      content: 'All 6 auth tests pass. The refactoring is complete. Here\'s a summary of the changes:\n\n- **src/auth/middleware.ts** -- Replaced session-based auth with JWT verification from the `Authorization: Bearer` header\n- **src/config/auth.ts** -- Added `jwtSecret` and `jwtExpiresIn` config options\n- **src/auth/login.ts** -- Login now returns a signed JWT instead of setting a session cookie\n\nNow updating the remaining files that reference the old auth pattern.',
      tool_name: null, tool_input: null, tool_use_id: null,
      timestamp: agoISO(3, 15), line_number: line++, metadata: {},
    },
  ];
}

function buildA3Transcript(): TranscriptEntry[] {
  const agentId = IDS.a3;
  const sessionId = SESSIONS.a3;
  let line = 1;

  return [
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'user',
      content: 'Add lodash as a dependency and refactor the utility helpers in src/utils/ to use lodash methods where appropriate. Focus on the array and object manipulation functions.',
      tool_name: null, tool_input: null, tool_use_id: null,
      timestamp: agoISO(3, 8), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'assistant',
      content: 'I\'ll add lodash and refactor the utility helpers. Let me first look at the current utility files to understand what functions could benefit from lodash.',
      tool_name: null, tool_input: null, tool_use_id: null,
      timestamp: agoISO(3, 5), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'tool_use',
      content: null,
      tool_name: 'Read', tool_input: JSON.stringify({ file_path: 'src/utils/arrays.ts' }),
      tool_use_id: 'toolu_demo_a3_001',
      timestamp: agoISO(2, 50), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'tool_result',
      content: 'export function uniqBy<T>(arr: T[], key: keyof T): T[] {\n  const seen = new Set();\n  return arr.filter(item => {\n    const val = item[key];\n    if (seen.has(val)) return false;\n    seen.add(val);\n    return true;\n  });\n}\n\nexport function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {\n  return arr.reduce((acc, item) => {\n    const group = String(item[key]);\n    (acc[group] = acc[group] || []).push(item);\n    return acc;\n  }, {} as Record<string, T[]>);\n}\n\nexport function chunk<T>(arr: T[], size: number): T[][] {\n  const result: T[][] = [];\n  for (let i = 0; i < arr.length; i += size) {\n    result.push(arr.slice(i, i + size));\n  }\n  return result;\n}',
      tool_name: 'Read', tool_input: null, tool_use_id: 'toolu_demo_a3_001',
      timestamp: agoISO(2, 48), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'tool_use',
      content: null,
      tool_name: 'Grep', tool_input: JSON.stringify({ pattern: 'import.*from.*utils/(arrays|objects)', path: 'src/', glob: '*.ts' }),
      tool_use_id: 'toolu_demo_a3_002',
      timestamp: agoISO(2, 10), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'tool_result',
      content: 'src/services/user.service.ts:3: import { uniqBy, groupBy } from \'../utils/arrays\';\nsrc/services/report.service.ts:2: import { chunk, groupBy } from \'../utils/arrays\';\nsrc/controllers/dashboard.ts:5: import { groupBy } from \'../utils/arrays\';\nsrc/services/analytics.service.ts:4: import { uniqBy } from \'../utils/arrays\';',
      tool_name: 'Grep', tool_input: null, tool_use_id: 'toolu_demo_a3_002',
      timestamp: agoISO(2, 5), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'assistant',
      content: 'The utility functions `uniqBy`, `groupBy`, and `chunk` are all available directly from lodash. They\'re imported across 4 files. I\'ll:\n\n1. Add lodash to package.json\n2. Replace the hand-rolled implementations with lodash imports\n3. Update all import paths in the consuming files\n\nLet me first add lodash to the project dependencies.',
      tool_name: null, tool_input: null, tool_use_id: null,
      timestamp: agoISO(1, 55), line_number: line++, metadata: {},
    },
    {
      agent_id: agentId, session_id: sessionId,
      entry_type: 'tool_use',
      content: null,
      tool_name: 'Edit', tool_input: JSON.stringify({
        file_path: 'package.json',
        old_string: '"express": "^4.18.2"',
        new_string: '"express": "^4.18.2",\n    "lodash": "^4.17.21"',
      }),
      tool_use_id: 'toolu_demo_a3_003',
      timestamp: agoISO(1, 20), line_number: line++, metadata: {},
    },
  ];
}

export function getDemoTranscript(): TranscriptEntry[] {
  return [...buildA1Transcript(), ...buildA3Transcript()];
}

// ── Mock Heatmap Data (30 days) ──

export function getDemoHeatmapData(): { key: string; count: number }[] {
  const entries: { key: string; count: number }[] = [];
  const now = new Date();
  const rng = seedRandom(42);

  for (let dayOffset = 29; dayOffset >= 0; dayOffset--) {
    const d = new Date(now);
    d.setDate(d.getDate() - dayOffset);
    const dateStr = d.toISOString().slice(0, 10);
    const dayOfWeek = d.getDay(); // 0=Sun, 6=Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // More activity in recent days (adoption ramp)
    const recencyFactor = 1 - (dayOffset / 40);

    for (let hour = 0; hour < 24; hour++) {
      let weight = 0;

      // Working hours: 9-19 get most activity
      if (hour >= 9 && hour <= 18) {
        weight = 0.7 + rng() * 0.3;
        // Peak at 10-12 and 14-16
        if ((hour >= 10 && hour <= 12) || (hour >= 14 && hour <= 16)) {
          weight = 0.85 + rng() * 0.15;
        }
      } else if (hour >= 8 && hour < 9) {
        // Early morning -- occasional
        weight = rng() < 0.4 ? 0.1 + rng() * 0.15 : 0;
      } else if (hour > 18 && hour <= 20) {
        // Early evening -- light
        weight = rng() < 0.35 ? 0.15 + rng() * 0.2 : 0;
      } else if (hour > 20 && hour <= 22) {
        // Late evening -- rare
        weight = rng() < 0.15 ? 0.1 + rng() * 0.1 : 0;
      } else {
        // Night (23-7) -- very rare
        weight = rng() < 0.05 ? rng() * 0.1 : 0;
      }

      if (isWeekend) {
        weight *= rng() < 0.3 ? 0.4 : 0;
      }

      weight *= recencyFactor;

      if (weight > 0.05) {
        const count = Math.round(weight * (15 + rng() * 35));
        if (count > 0) {
          entries.push({
            key: `${dateStr}T${hour.toString().padStart(2, '0')}`,
            count,
          });
        }
      }
    }
  }

  return entries;
}

// ── Mock Daily Activity Data (30 days) ──

export function getDemoDailyData(): { date: string; count: number }[] {
  const data: { date: string; count: number }[] = [];
  const now = new Date();
  const rng = seedRandom(99);

  for (let dayOffset = 29; dayOffset >= 0; dayOffset--) {
    const d = new Date(now);
    d.setDate(d.getDate() - dayOffset);
    const dateStr = d.toISOString().slice(0, 10);
    const dayOfWeek = d.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const recencyFactor = 1 - (dayOffset / 45);
    let base = isWeekend ? (rng() < 0.3 ? 10 + rng() * 30 : 0) : 40 + rng() * 80;
    base *= recencyFactor;

    // Add some variation
    if (dayOffset === 0) {
      // Today -- partial day
      const hoursPassed = now.getHours();
      base = base * (hoursPassed / 18);
    }

    data.push({ date: dateStr, count: Math.round(base) });
  }

  return data;
}

// ── Mock Session History ──

export function getDemoSessions(): any[] {
  return [
    {
      id: SESSIONS.a1, agent_name: 'Claude Code', status: 'working',
      working_directory: '~/projects/web-app',
      start_time: agoISO(14, 22), end_time: null, pid: 48201, metadata: null,
    },
    {
      id: SESSIONS.a2, agent_name: 'Claude Code', status: 'working',
      working_directory: '~/projects/api-server',
      start_time: agoISO(8, 55), end_time: null, pid: 48150, metadata: null,
    },
    {
      id: SESSIONS.a3, agent_name: 'Claude Code', status: 'working',
      working_directory: '~/projects/web-app',
      start_time: agoISO(3, 10), end_time: null, pid: 48380, metadata: null,
    },
    {
      id: SESSIONS.a4, agent_name: 'Claude Code', status: 'completed',
      working_directory: '~/projects/data-service',
      start_time: agoISO(22, 0), end_time: agoISO(11, 30), pid: 47980, metadata: null,
    },
    {
      id: SESSIONS.a5, agent_name: 'Claude Code', status: 'idle',
      working_directory: '~/projects/mobile-app',
      start_time: agoISO(1, 15), end_time: null, pid: 48420, metadata: null,
    },
    {
      id: SESSIONS.a6, agent_name: 'Claude Code', status: 'working',
      working_directory: '~/projects/web-app',
      start_time: agoISO(5, 48), end_time: null, pid: 48350, metadata: null,
    },
    // Some older completed sessions
    {
      id: 'demo-sess-old1', agent_name: 'Claude Code', status: 'completed',
      working_directory: '~/projects/web-app',
      start_time: agoISO(120), end_time: agoISO(95), pid: 47500, metadata: null,
    },
    {
      id: 'demo-sess-old2', agent_name: 'Claude Code', status: 'completed',
      working_directory: '~/projects/api-server',
      start_time: agoISO(180), end_time: agoISO(155), pid: 47200, metadata: null,
    },
    {
      id: 'demo-sess-old3', agent_name: 'Claude Code', status: 'failed',
      working_directory: '~/projects/data-service',
      start_time: agoISO(240), end_time: agoISO(235), pid: 46900, metadata: null,
    },
  ];
}

// ── Mock Prompts ──

export function getDemoPrompts(): any[] {
  return [
    {
      timestamp: agoISO(14, 20),
      message: 'Refactor the auth middleware to use JWT tokens instead of session-based authentication. Update the login and logout handlers accordingly.',
      agent_id: IDS.a1, session_id: SESSIONS.a1, event_type: 'UserPromptSubmit',
    },
    {
      timestamp: agoISO(8, 53),
      message: 'Write integration tests for payment processing module',
      agent_id: IDS.a2, session_id: SESSIONS.a2, event_type: 'UserPromptSubmit',
    },
    {
      timestamp: agoISO(5, 45),
      message: 'Add cursor-based pagination to search results',
      agent_id: IDS.a6, session_id: SESSIONS.a6, event_type: 'UserPromptSubmit',
    },
    {
      timestamp: agoISO(3, 8),
      message: 'Add lodash dependency and update utility helpers',
      agent_id: IDS.a3, session_id: SESSIONS.a3, event_type: 'UserPromptSubmit',
    },
  ];
}

// ── Mock Logs ──

export function getDemoLogs(): LogEntry[] {
  return [
    { timestamp: ago(14, 22), level: 'info', message: 'Agent connected: agent-a1000', agentId: IDS.a1 },
    { timestamp: ago(13, 50), level: 'info', message: 'Reading src/auth/middleware.ts', agentId: IDS.a1 },
    { timestamp: ago(11, 0), level: 'info', message: 'Editing src/auth/middleware.ts', agentId: IDS.a1 },
    { timestamp: ago(8, 55), level: 'info', message: 'Agent connected: agent-f7000', agentId: IDS.a2 },
    { timestamp: ago(6, 40), level: 'info', message: 'Writing tests/payments/integration.test.ts', agentId: IDS.a2 },
    { timestamp: ago(5, 48), level: 'info', message: 'Agent connected: agent-7b000', agentId: IDS.a6 },
    { timestamp: ago(4, 0), level: 'info', message: 'Running tests: npm test -- --grep "auth"', agentId: IDS.a1 },
    { timestamp: ago(3, 30), level: 'info', message: 'All 6 tests passed', agentId: IDS.a1 },
    { timestamp: ago(3, 10), level: 'info', message: 'Agent connected: agent-1a000', agentId: IDS.a3 },
    { timestamp: ago(1, 20), level: 'warning', message: 'Permission requested: Edit package.json', agentId: IDS.a3 },
    { timestamp: ago(0, 45), level: 'info', message: 'Running tests: npm test -- --watch payments', agentId: IDS.a2 },
    { timestamp: ago(0, 12), level: 'info', message: 'Editing src/auth/middleware.ts', agentId: IDS.a1 },
  ];
}

// Simple seeded PRNG for deterministic heatmap data
function seedRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}
