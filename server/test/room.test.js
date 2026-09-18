import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../src/room.js';

function fakeWs() {
  return {
    readyState: 1,
    received: [],
    send(data) {
      this.received.push(JSON.parse(data));
    },
  };
}

function join(room, name, role) {
  const ws = fakeWs();
  const client = room.addClient(ws, { name, role });
  return { ws, client };
}

test('join 下发快照，成员变更广播', () => {
  const room = new Room('demo', 'hello');
  const a = join(room, 'A', 'editor');
  const sync = a.ws.received.find((m) => m.t === 'sync');
  assert.equal(sync.content, 'hello');
  assert.equal(sync.version, 0);
  assert.equal(sync.you.role, 'editor');

  join(room, 'B', 'viewer');
  const members = a.ws.received.filter((m) => m.t === 'members').at(-1);
  assert.equal(members.members.length, 2);
});

test('并发编辑：服务端串行变换，版本连续，双方最终一致', () => {
  const room = new Room('demo', 'abc');
  const a = join(room, 'A', 'editor');
  const b = join(room, 'B', 'editor');

  // 双方都基于 version 0 在 pos 1 处插入
  room.handleOp(a.client, { op: { type: 'insert', pos: 1, text: 'X' }, baseVersion: 0, clientOpId: 'a1' });
  room.handleOp(b.client, { op: { type: 'insert', pos: 1, text: 'Y' }, baseVersion: 0, clientOpId: 'b1' });

  assert.equal(room.version, 2);
  // u1(A) 字典序小于 u2(B)，同位置插入 A 在前
  assert.equal(room.content, 'aXYbc');

  const ackA = a.ws.received.find((m) => m.t === 'ack');
  assert.equal(ackA.version, 1);
  const ackB = b.ws.received.find((m) => m.t === 'ack');
  assert.equal(ackB.version, 2);
  // A 收到 B 的广播操作（已变换到 pos 2）
  const opForA = a.ws.received.find((m) => m.t === 'op');
  assert.equal(opForA.version, 2);
  assert.deepEqual(opForA.op, { type: 'insert', pos: 2, text: 'Y' });
});

test('权限：viewer 编辑被拒绝，commenter 可批注不可编辑', () => {
  const room = new Room('demo', 'abc');
  const v = join(room, 'V', 'viewer');
  const c = join(room, 'C', 'commenter');

  room.handleOp(v.client, { op: { type: 'insert', pos: 0, text: 'X' }, baseVersion: 0, clientOpId: 'v1' });
  room.handleOp(c.client, { op: { type: 'insert', pos: 0, text: 'X' }, baseVersion: 0, clientOpId: 'c1' });
  assert.equal(room.content, 'abc');
  assert.equal(room.version, 0);
  assert.match(v.ws.received.find((m) => m.t === 'reject').reason, /forbidden/);
  assert.match(c.ws.received.find((m) => m.t === 'reject').reason, /forbidden/);

  room.handleAnnAdd(v.client, { start: 0, end: 1, content: 'hi' });
  assert.equal(room.annotations.size, 0);
  room.handleAnnAdd(c.client, { start: 0, end: 2, content: 'hi' });
  assert.equal(room.annotations.size, 1);
});

test('版本过旧的操作被拒绝并要求重同步', () => {
  const room = new Room('demo', 'abc');
  const a = join(room, 'A', 'editor');
  room.handleOp(a.client, { op: { type: 'insert', pos: 0, text: 'X' }, baseVersion: 0, clientOpId: 'a1' });
  room.handleOp(a.client, { op: { type: 'insert', pos: 0, text: 'Y' }, baseVersion: 5, clientOpId: 'a2' });
  const reject = a.ws.received.filter((m) => m.t === 'reject').at(-1);
  assert.match(reject.reason, /stale/);
  assert.equal(room.version, 1);
});

test('批注锚点随编辑操作移动', () => {
  const room = new Room('demo', 'hello world');
  const e = join(room, 'E', 'editor');
  room.handleAnnAdd(e.client, { start: 6, end: 11, content: '注意这里' });
  // 在批注区间前插入 3 个字符
  room.handleOp(e.client, { op: { type: 'insert', pos: 0, text: '>>> ' }, baseVersion: 0, clientOpId: 'e1' });
  const ann = [...room.annotations.values()][0];
  assert.equal(ann.start, 10);
  assert.equal(ann.end, 15);
  assert.equal(room.content.slice(ann.start, ann.end), 'world');
});

test('批注解决/删除权限', () => {
  const room = new Room('demo', 'abc');
  const c = join(room, 'C', 'commenter');
  const d = join(room, 'D', 'commenter');
  room.handleAnnAdd(c.client, { start: 0, end: 1, content: 'note' });
  const id = [...room.annotations.keys()][0];

  // 非作者且非 editor 不能解决/删除
  room.handleAnnUpdate(d.client, { id, patch: { resolved: true } });
  assert.equal(room.annotations.get(id).resolved, false);
  room.handleAnnDel(d.client, { id });
  assert.equal(room.annotations.size, 1);

  // 任何人（非 viewer）可回复；作者可解决、删除
  room.handleAnnUpdate(d.client, { id, patch: { reply: '同意' } });
  assert.equal(room.annotations.get(id).replies.length, 1);
  room.handleAnnUpdate(c.client, { id, patch: { resolved: true } });
  assert.equal(room.annotations.get(id).resolved, true);
  room.handleAnnDel(c.client, { id });
  assert.equal(room.annotations.size, 0);
});

test('presence 节流转发，离开时广播清除', async () => {
  const room = new Room('demo', 'abc');
  const a = join(room, 'A', 'editor');
  const b = join(room, 'B', 'editor');

  room.handlePresence(a.client, { cursor: { pos: 1, start: 1, end: 1 } });
  room.handlePresence(a.client, { cursor: { pos: 2, start: 2, end: 2 } });
  const immediate = b.ws.received.filter((m) => m.t === 'presence');
  assert.equal(immediate.length, 1); // 第二条被节流，进入尾随发送

  await new Promise((r) => setTimeout(r, 150));
  const all = b.ws.received.filter((m) => m.t === 'presence');
  assert.equal(all.length, 2);
  assert.equal(all[1].cursor.pos, 2); // 尾随发送的是最新值

  room.removeClient(a.client.id);
  const gone = b.ws.received.filter((m) => m.t === 'presence').at(-1);
  assert.equal(gone.cursor, null);
});
