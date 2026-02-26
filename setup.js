#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function ensureDirectoryExists(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log(`✅ Created directory: ${dir}`, colors.green);
  }
}

function setupClaudeHooks() {
  log('\n🚀 Setting up Claude Code hooks for Minion Orchestra\n', colors.cyan);

  // Get the Claude settings directory
  const homeDir = os.homedir();
  const claudeDir = path.join(homeDir, '.claude');
  const hooksDir = path.join(claudeDir, 'hooks');
  const settingsFile = path.join(claudeDir, 'settings.json');

  // Ensure directories exist
  ensureDirectoryExists(claudeDir);
  ensureDirectoryExists(hooksDir);

  // Create the Python hook script
  const hookScript = `#!/usr/bin/env python3
"""
Minion Orchestra Hook for Claude Code
Automatically sends events to Minion Orchestra server
"""

import json
import sys
import os
from urllib import request, parse, error
from datetime import datetime

# Configuration
MINION_ORCHESTRA_URL = os.environ.get('MINION_ORCHESTRA_URL', 'http://localhost:3000')
HOOK_ENDPOINT = f"{MINION_ORCHESTRA_URL}/api/hook"
TASK_ENDPOINT = f"{MINION_ORCHESTRA_URL}/api/task"

def send_to_minion_orchestra(endpoint, data):
    """Send data to Minion Orchestra server"""
    try:
        headers = {'Content-Type': 'application/json'}
        req = request.Request(
            endpoint,
            data=json.dumps(data).encode('utf-8'),
            headers=headers,
            method='POST'
        )
        
        with request.urlopen(req, timeout=1) as response:
            if response.status == 200:
                print(f"\\033[92m✅ Sent to {endpoint.replace(MINION_ORCHESTRA_URL, '')} - Status: {response.status}\\033[0m", file=sys.stderr)
            return response.status == 200
    except Exception as e:
        print(f"\\033[91m❌ Failed to send to {endpoint.replace(MINION_ORCHESTRA_URL, '')}: {e}\\033[0m", file=sys.stderr)
        return False

def main():
    # Read the hook event from stdin
    try:
        event_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"\\033[91m❌ Failed to parse event data: {e}\\033[0m", file=sys.stderr)
        return
    
    # Extract event information
    event_type = event_data.get('hook_event_name', 'Unknown')
    
    # Get agent information from environment or event data
    agent_id = f"claude-pid-{os.getpid()}"
    if 'cwd' in event_data:
        agent_name = os.path.basename(event_data['cwd']) or 'Claude Agent'
    else:
        agent_name = os.uname().nodename
    
    # Add agent name for specific events
    if event_type == 'UserPromptSubmit' and 'prompt' in event_data:
        prompt_preview = event_data['prompt'][:50] + '...' if len(event_data['prompt']) > 50 else event_data['prompt']
        agent_name = f"{agent_name}: {prompt_preview}"
    
    # Prepare the payload
    payload = {
        'eventType': event_type,
        'agentId': agent_id,
        'agentName': agent_name,
        'timestamp': datetime.now().isoformat(),
        'data': event_data
    }

    # Send to hook endpoint
    send_to_minion_orchestra(HOOK_ENDPOINT, payload)

    # For UserPromptSubmit, also send to task endpoint
    if event_type == 'UserPromptSubmit':
        task_payload = {
            'prompt': event_data.get('prompt', ''),
            'sessionId': event_data.get('session_id', ''),
            'timestamp': datetime.now().isoformat()
        }
        send_to_minion_orchestra(TASK_ENDPOINT, task_payload)
    
    # Always pass through the original output
    json.dump({}, sys.stdout)

if __name__ == '__main__':
    main()
`;

  const hookScriptPath = path.join(hooksDir, 'minion_orchestra_hook.py');
  fs.writeFileSync(hookScriptPath, hookScript);
  fs.chmodSync(hookScriptPath, '755');
  log(`✅ Created hook script: ${hookScriptPath}`, colors.green);

  // Create or update Claude settings
  let settings = {};
  if (fs.existsSync(settingsFile)) {
    try {
      const content = fs.readFileSync(settingsFile, 'utf8');
      settings = JSON.parse(content);
      log(`📖 Found existing Claude settings`, colors.blue);
    } catch (err) {
      log(`⚠️  Could not parse existing settings, creating new ones`, colors.yellow);
    }
  }

  // Configure hooks for all relevant events
  const hookCommand = `${hookScriptPath}`;
  const hookEvents = [
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'SessionStart',
    'Stop',
    'SubagentStart',
    'SubagentStop',
    'Notification',
    'PreCompact',
    'PostCompact',
    'ContextTruncation'
  ];

  if (!settings.hooks) {
    settings.hooks = {};
  }

  // Configure each hook event (preserve existing hooks)
  hookEvents.forEach(event => {
    if (!settings.hooks[event]) {
      settings.hooks[event] = [];
    }
    
    // Check if our hook is already configured
    const existingHook = settings.hooks[event].find(hook =>
      hook.command && hook.command.includes('minion_orchestra_hook.py')
    );

    if (!existingHook) {
      // Add our hook to the existing array
      settings.hooks[event].push({
        command: hookCommand
      });
      log(`  ➕ Added Minion Orchestra hook for ${event}`, colors.blue);
    } else {
      log(`  ✓ Minion Orchestra hook already configured for ${event}`, colors.gray);
    }
  });

  // Write the updated settings
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  log(`✅ Updated Claude settings: ${settingsFile}`, colors.green);

  // Create a test script
  const testScript = `#!/bin/bash
echo "Testing Minion Orchestra connection..."
echo '{"hook_event_name": "SessionStart", "test": true}' | ${hookScriptPath}
`;

  const testScriptPath = path.join(hooksDir, 'test_minion_orchestra.sh');
  fs.writeFileSync(testScriptPath, testScript);
  fs.chmodSync(testScriptPath, '755');

  log('\n✨ Setup complete!', colors.green);
  log('\nMinion Orchestra hooks have been configured for Claude Code.', colors.cyan);
  log('\nTo test the connection:', colors.yellow);
  log(`  1. Make sure Minion Orchestra is running: npm run start`);
  log(`  2. Run: ${testScriptPath}`);
  log(`  3. Start using Claude Code - events will appear in the dashboard automatically!`);

  log('\n📝 Notes:', colors.blue);
  log('  - Hooks are configured in: ~/.claude/settings.json');
  log('  - Hook script is at: ~/.claude/hooks/minion_orchestra_hook.py');
  log('  - To use a different server, set MINION_ORCHESTRA_URL environment variable');
}

// Run the setup
try {
  setupClaudeHooks();
  process.exit(0);
} catch (err) {
  log(`\n❌ Setup failed: ${err.message}`, colors.red);
  process.exit(1);
}