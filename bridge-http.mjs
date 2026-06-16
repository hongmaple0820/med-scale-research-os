import { ScaleMCPServer } from '/workspace/core/scale-engine/dist/api/mcp.js';
import http from 'http';

const server = new ScaleMCPServer('.scale');
const PORT = parseInt(process.env.SCALE_PORT ?? '7790', 10);

const serverInstance = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', tools: server.getTools().map(t => t.name) }));
    return;
  }

  if (req.method === 'GET' && req.url === '/tools') {
    res.writeHead(200);
    res.end(JSON.stringify({ tools: server.getTools() }));
    return;
  }

  if (req.method === 'POST' && req.url === '/call') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      try {
        const { name, arguments: args = {} } = JSON.parse(body);
        const result = await server.handleToolCall(name, args);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, result }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/mcp') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      try {
        const mcpReq = JSON.parse(body);
        const response = await server.handleRequest(mcpReq);
        res.writeHead(200);
        res.end(JSON.stringify(response));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -1, message: err.message } }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

serverInstance.listen(PORT, () => {
  console.log(`[scale-engine-bridge] HTTP server listening on port ${PORT}`);
});