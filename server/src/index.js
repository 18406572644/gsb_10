import http from 'node:http';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';

const PORT = Number(process.env.PORT || 8080);

const SEED_CONTENT = `欢迎使用多人协同批注编辑器。

这是一篇共享文档，你可以：
1. 以「编辑」角色直接修改本文，多人同时编辑时由 OT（操作变换）自动解决冲突；
2. 以「批注」角色选中一段文字添加批注，批注锚点会随文档编辑自动移动；
3. 以「只读」角色旁观，实时看到他人的编辑与光标位置。

试试打开多个浏览器标签页，用不同角色加入同一个文档 ID 吧。
`;

const rooms = new Map();
function getRoom(id) {
  if (!rooms.has(id)) {
    rooms.set(id, new Room(id, id === 'demo' ? SEED_CONTENT : ''));
  }
  return rooms.get(id);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, rooms: rooms.size, uptime: process.uptime() }));
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  let room = null;
  let client = null;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return; // 非法 JSON 直接丢弃
    }
    try {
      if (msg.t === 'join') {
        // 重复 join（重连）时先清理旧会话
        if (room && client) room.removeClient(client.id);
        const docId = String(msg.docId || 'demo').slice(0, 64) || 'demo';
        const name = String(msg.name || '匿名').slice(0, 32).trim() || '匿名';
        const role = ['editor', 'commenter', 'viewer'].includes(msg.role) ? msg.role : 'viewer';
        room = getRoom(docId);
        client = room.addClient(ws, { name, role });
        return;
      }
      if (!room || !client) return; // 未 join 的消息一律忽略

      switch (msg.t) {
        case 'resync':
          ws.send(JSON.stringify(room.snapshot(client)));
          break;
        case 'op':
          room.handleOp(client, msg);
          break;
        case 'ann:add':
          room.handleAnnAdd(client, msg);
          break;
        case 'ann:update':
          room.handleAnnUpdate(client, msg);
          break;
        case 'ann:del':
          room.handleAnnDel(client, msg);
          break;
        case 'presence':
          room.handlePresence(client, msg);
          break;
        case 'ping':
          ws.send(JSON.stringify({ t: 'pong', ts: msg.ts }));
          break;
        default:
          break;
      }
    } catch (err) {
      console.error('[room] handle message error:', err);
      try {
        ws.send(JSON.stringify({ t: 'error', code: 'internal', message: '服务器内部错误，请刷新重试' }));
      } catch {
        /* 连接可能已断开 */
      }
    }
  });

  ws.on('close', () => {
    if (room && client) room.removeClient(client.id);
  });
});

// 心跳：30s 一轮 ping，未响应的连接直接 terminate（触发客户端重连链路）
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`[server] http+ws listening on :${PORT} (ws path: /ws)`);
});
