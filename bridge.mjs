#!/usr/bin/env node

import { ScaleMCPServer } from '@hongmaple0820/scale-engine';

const server = new ScaleMCPServer('.scale');
const methods = server.getTools().map(t => t.name);

process.stderr.write(`[scale-bridge] Ready. Tools: ${methods.join(',')}\n`);

process.stdin.on('data', async (chunk) => {
  const lines = chunk.toString().split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      const req = JSON.parse(line);
      if (req.method === 'tools.list') {
        process.stdout.write(JSON.stringify({ id: req.id, result: server.getTools() }) + '\n');
      } else if (req.method === 'tool.call') {
        const result = await server.handleToolCall(req.params?.name ?? req.params?.tool_name, req.params?.arguments ?? req.params?.args ?? {});
        process.stdout.write(JSON.stringify({ id: req.id, result }) + '\n');
      } else if (req.method === 'ping') {
        process.stdout.write(JSON.stringify({ id: req.id, result: 'pong' }) + '\n');
      } else {
        const response = await server.handleRequest(req);
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } catch (err) {
      process.stderr.write(`[scale-bridge] Error: ${err.message}\n`);
      try {
        const req = JSON.parse(line);
        process.stdout.write(JSON.stringify({ id: req.id ?? 0, error: { code: -1, message: err.message } }) + '\n');
      } catch {
        // skip unparseable lines
      }
    }
  }
});