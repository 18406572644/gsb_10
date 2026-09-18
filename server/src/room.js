import { applyOp, transformOp, transformPos, validateOp } from './ot.js';

const MAX_LOG = 1000; // 操作日志上限，超出后拒绝过旧的 baseVersion，要求客户端全量重同步
const PRESENCE_INTERVAL = 100; // presence 转发节流：同一用户最小间隔 ms（尾随发送保证最终位置）
const MAX_ANNOTATIONS = 500;

let clientSeq = 0;

function transformCursor(cursor, op) {
  return {
    pos: transformPos(cursor.pos, op, 'right'),
    start: transformPos(cursor.start, op, 'left'),
    end: transformPos(cursor.end, op, 'right'),
  };
}

/**
 * 一个房间 = 一篇文档。服务端是唯一排序者（sequencer）：
 * 所有操作按到达顺序串行变换、应用、编号（version 单调递增），
 * 客户端通过 version 连续性检测消息丢失。
 */
export class Room {
  constructor(id, initialContent = '') {
    this.id = id;
    this.content = initialContent;
    this.version = 0;
    this.log = []; // { version, op, userId }，version 为应用该操作后的版本号
    this.annotations = new Map();
    this.clients = new Map(); // id -> client
    this.annSeq = 0;
  }

  // ---------- 成员 ----------

  addClient(ws, { name, role }) {
    const id = `u${++clientSeq}`;
    const client = {
      id,
      ws,
      name,
      role,
      cursor: null,
      lastPresenceRelay: 0,
      pendingPresence: null,
    };
    this.clients.set(id, client);
    this.sendTo(id, this.snapshot(client));
    this.broadcast({ t: 'members', members: this.members() }, id);
    return client;
  }

  removeClient(id) {
    const client = this.clients.get(id);
    if (!client) return;
    if (client.pendingPresence) clearTimeout(client.pendingPresence);
    this.clients.delete(id);
    this.broadcast({ t: 'members', members: this.members() });
    this.broadcast({ t: 'presence', userId: id, cursor: null });
  }

  members() {
    return [...this.clients.values()].map((c) => ({ id: c.id, name: c.name, role: c.role }));
  }

  snapshot(client) {
    return {
      t: 'sync',
      docId: this.id,
      version: this.version,
      content: this.content,
      annotations: [...this.annotations.values()],
      members: this.members(),
      you: { id: client.id, name: client.name, role: client.role },
    };
  }

  // ---------- 消息收发 ----------

  sendTo(id, msg) {
    const c = this.clients.get(id);
    if (c && c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
  }

  broadcast(msg, exceptId = null) {
    const data = JSON.stringify(msg);
    for (const c of this.clients.values()) {
      if (c.id === exceptId) continue;
      if (c.ws.readyState === 1) c.ws.send(data);
    }
  }

  // ---------- 文档操作（OT） ----------

  handleOp(client, msg) {
    const reject = (reason) =>
      this.sendTo(client.id, { t: 'reject', clientOpId: msg.clientOpId, reason });

    if (client.role !== 'editor') return reject('forbidden: 当前角色无编辑权限');
    const { op, baseVersion, clientOpId } = msg;
    if (!op || typeof baseVersion !== 'number') return reject('malformed: 操作格式非法');
    if (baseVersion > this.version || baseVersion < this.version - this.log.length) {
      return reject('stale: 本地版本过旧，请全量重同步');
    }

    // 把客户端操作变换到最新版本之后（对客户端未知晓的每个已应用操作逐个变换）
    let cur = op;
    for (const entry of this.log) {
      if (entry.version <= baseVersion) continue;
      cur = transformOp(cur, entry.op, client.id, entry.userId);
      if (!cur) break; // 变换为空操作（如并发删除同一区间）
    }
    if (cur && !validateOp(this.content, cur)) return reject('invalid: 操作越界或非法');

    this.version += 1;
    if (cur) {
      this.content = applyOp(this.content, cur);
      this.transformAnchors(cur);
      // 已保存的他人光标也随文档变换，保证下次 presence 广播位置正确
      for (const c of this.clients.values()) {
        if (c.cursor) c.cursor = transformCursor(c.cursor, cur);
      }
    }
    this.log.push({ version: this.version, op: cur, userId: client.id });
    if (this.log.length > MAX_LOG) this.log.shift();

    // 每个操作（含空操作）都占用一个版本号：作者收 ack，其他人收广播，
    // 这样所有客户端都能用 version 连续性做丢包检测。
    this.sendTo(client.id, { t: 'ack', clientOpId, version: this.version });
    this.broadcast(
      { t: 'op', op: cur, version: this.version, userId: client.id, name: client.name },
      client.id,
    );
  }

  transformAnchors(op) {
    for (const ann of this.annotations.values()) {
      ann.start = transformPos(ann.start, op, 'left');
      ann.end = transformPos(ann.end, op, 'right');
      if (ann.end < ann.start) ann.end = ann.start;
    }
  }

  // ---------- 批注 ----------

  static canAnnotate(role) {
    return role === 'editor' || role === 'commenter';
  }

  handleAnnAdd(client, msg) {
    if (!Room.canAnnotate(client.role)) {
      return this.sendTo(client.id, { t: 'error', code: 'forbidden', message: '只读角色无法添加批注' });
    }
    if (this.annotations.size >= MAX_ANNOTATIONS) {
      return this.sendTo(client.id, { t: 'error', code: 'limit', message: '批注数量已达上限' });
    }
    const { start, end, quote, content } = msg;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      end > this.content.length ||
      typeof content !== 'string' ||
      !content.trim()
    ) {
      return this.sendTo(client.id, { t: 'error', code: 'invalid', message: '批注参数非法' });
    }
    const ann = {
      id: `a${++this.annSeq}`,
      start,
      end,
      quote: String(quote ?? this.content.slice(start, end)).slice(0, 500),
      content: content.slice(0, 2000),
      authorId: client.id,
      authorName: client.name,
      resolved: false,
      createdAt: Date.now(),
      replies: [],
    };
    this.annotations.set(ann.id, ann);
    this.broadcast({ t: 'ann:add', ann }); // 含作者：批注以服务端回显为准，不做本地乐观更新
  }

  handleAnnUpdate(client, msg) {
    const ann = this.annotations.get(msg.id);
    if (!ann) return;
    const patch = msg.patch || {};
    const isAuthor = ann.authorId === client.id;

    if (typeof patch.resolved === 'boolean') {
      if (!isAuthor && client.role !== 'editor') {
        return this.sendTo(client.id, { t: 'error', code: 'forbidden', message: '仅作者或编辑者可解决/重开批注' });
      }
      ann.resolved = patch.resolved;
    }
    if (typeof patch.content === 'string' && patch.content.trim()) {
      if (!isAuthor) {
        return this.sendTo(client.id, { t: 'error', code: 'forbidden', message: '仅作者可修改批注内容' });
      }
      ann.content = patch.content.slice(0, 2000);
    }
    if (typeof patch.reply === 'string' && patch.reply.trim()) {
      if (!Room.canAnnotate(client.role)) {
        return this.sendTo(client.id, { t: 'error', code: 'forbidden', message: '只读角色无法回复批注' });
      }
      ann.replies.push({
        id: `r${ann.replies.length + 1}`,
        authorId: client.id,
        authorName: client.name,
        content: patch.reply.slice(0, 2000),
        ts: Date.now(),
      });
    }
    this.broadcast({ t: 'ann:update', ann });
  }

  handleAnnDel(client, msg) {
    const ann = this.annotations.get(msg.id);
    if (!ann) return;
    if (ann.authorId !== client.id && client.role !== 'editor') {
      return this.sendTo(client.id, { t: 'error', code: 'forbidden', message: '仅作者或编辑者可删除批注' });
    }
    this.annotations.delete(msg.id);
    this.broadcast({ t: 'ann:del', id: msg.id });
  }

  // ---------- 在线状态 / 光标 ----------

  handlePresence(client, msg) {
    const c = msg.cursor;
    if (c === null) {
      client.cursor = null;
    } else if (
      c &&
      Number.isInteger(c.pos) &&
      Number.isInteger(c.start) &&
      Number.isInteger(c.end)
    ) {
      const max = this.content.length;
      client.cursor = {
        pos: Math.max(0, Math.min(c.pos, max)),
        start: Math.max(0, Math.min(c.start, max)),
        end: Math.max(0, Math.min(c.end, max)),
      };
    } else {
      return;
    }
    // 节流转发：最小间隔 PRESENCE_INTERVAL，间隔内记录最新值并尾随补发
    const now = Date.now();
    const relay = () => {
      client.lastPresenceRelay = Date.now();
      this.broadcast(
        { t: 'presence', userId: client.id, name: client.name, role: client.role, cursor: client.cursor },
        client.id,
      );
    };
    if (now - client.lastPresenceRelay >= PRESENCE_INTERVAL) {
      relay();
    } else if (!client.pendingPresence) {
      client.pendingPresence = setTimeout(() => {
        client.pendingPresence = null;
        relay();
      }, PRESENCE_INTERVAL - (now - client.lastPresenceRelay));
    }
  }
}
