import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, transformOp, transformPos, diffOps, validateOp } from '../src/ot.js';

test('applyOp: insert / delete', () => {
  assert.equal(applyOp('hello', { type: 'insert', pos: 5, text: ' world' }), 'hello world');
  assert.equal(applyOp('hello world', { type: 'delete', pos: 5, len: 6 }), 'hello');
  assert.equal(applyOp('abc', null), 'abc');
});

test('validateOp: 越界与非法操作', () => {
  assert.equal(validateOp('abc', { type: 'insert', pos: 3, text: 'x' }), true);
  assert.equal(validateOp('abc', { type: 'insert', pos: 4, text: 'x' }), false);
  assert.equal(validateOp('abc', { type: 'delete', pos: 1, len: 2 }), true);
  assert.equal(validateOp('abc', { type: 'delete', pos: 1, len: 3 }), false);
  assert.equal(validateOp('abc', { type: 'insert', pos: 0, text: '' }), false);
});

test('transformOp: insert vs insert', () => {
  const a = { type: 'insert', pos: 5, text: 'A' };
  // b 在 a 之前插入 -> a 右移
  assert.deepEqual(transformOp(a, { type: 'insert', pos: 2, text: 'BB' }), { type: 'insert', pos: 7, text: 'A' });
  // b 在 a 之后插入 -> a 不变
  assert.deepEqual(transformOp(a, { type: 'insert', pos: 8, text: 'BB' }), a);
  // 同位置：tie 小者在前（tieB <= tieA 时 a 右移）
  assert.deepEqual(transformOp(a, { type: 'insert', pos: 5, text: 'B' }, 'u2', 'u1'), { type: 'insert', pos: 6, text: 'A' });
  assert.deepEqual(transformOp(a, { type: 'insert', pos: 5, text: 'B' }, 'u1', 'u2'), a);
});

test('transformOp: insert vs delete', () => {
  const a = { type: 'insert', pos: 5, text: 'A' };
  assert.deepEqual(transformOp(a, { type: 'delete', pos: 0, len: 3 }), { type: 'insert', pos: 2, text: 'A' });
  assert.deepEqual(transformOp(a, { type: 'delete', pos: 6, len: 2 }), a);
  // 插入点落在被删区间内 -> 收缩到区间起点
  assert.deepEqual(transformOp(a, { type: 'delete', pos: 4, len: 4 }), { type: 'insert', pos: 4, text: 'A' });
});

test('transformOp: delete vs insert', () => {
  const a = { type: 'delete', pos: 5, len: 3 };
  assert.deepEqual(transformOp(a, { type: 'insert', pos: 0, text: 'XX' }), { type: 'delete', pos: 7, len: 3 });
  assert.deepEqual(transformOp(a, { type: 'insert', pos: 9, text: 'XX' }), a);
  // 插入落在删除区间内 -> 扩展删除范围
  assert.deepEqual(transformOp(a, { type: 'insert', pos: 6, text: 'XX' }), { type: 'delete', pos: 5, len: 5 });
});

test('transformOp: delete vs delete（重叠 -> 扣除/空操作）', () => {
  // 完全不重叠
  assert.deepEqual(
    transformOp({ type: 'delete', pos: 10, len: 3 }, { type: 'delete', pos: 0, len: 5 }),
    { type: 'delete', pos: 5, len: 3 },
  );
  // 部分重叠：b 删 [2,6)，a 删 [4,9) -> a' 删 [2,5)
  assert.deepEqual(
    transformOp({ type: 'delete', pos: 4, len: 5 }, { type: 'delete', pos: 2, len: 4 }),
    { type: 'delete', pos: 2, len: 3 },
  );
  // a 的目标被 b 完全删除 -> 空操作
  assert.equal(
    transformOp({ type: 'delete', pos: 3, len: 2 }, { type: 'delete', pos: 0, len: 10 }),
    null,
  );
});

test('transformPos: 光标/锚点', () => {
  const ins = { type: 'insert', pos: 5, text: 'XX' };
  assert.equal(transformPos(8, ins), 10);
  assert.equal(transformPos(5, ins, 'right'), 7);
  assert.equal(transformPos(5, ins, 'left'), 5);
  const del = { type: 'delete', pos: 2, len: 4 };
  assert.equal(transformPos(10, del), 6);
  assert.equal(transformPos(2, del), 2);
  assert.equal(transformPos(4, del), 2); // 落在被删区间内收缩
});

test('diffOps: 最小编辑序列', () => {
  assert.deepEqual(diffOps('abc', 'abc'), []);
  assert.deepEqual(diffOps('abc', 'abXc'), [{ type: 'insert', pos: 2, text: 'X' }]);
  assert.deepEqual(diffOps('abXc', 'abc'), [{ type: 'delete', pos: 2, len: 1 }]);
  // 替换 -> delete + insert
  assert.deepEqual(diffOps('hello world', 'hello OT'), [
    { type: 'delete', pos: 6, len: 5 },
    { type: 'insert', pos: 6, text: 'OT' },
  ]);
});

test('并发收敛：两个客户端同位置插入，双方变换后结果一致', () => {
  const doc = 'abc';
  const opA = { type: 'insert', pos: 1, text: 'X' }; // 用户 u1
  const opB = { type: 'insert', pos: 1, text: 'Y' }; // 用户 u2
  // 服务端先应用 A，再把 B 变换到 A 之后
  const s1 = applyOp(doc, opA);
  const bPrime = transformOp(opB, opA, 'u2', 'u1');
  const serverDoc = applyOp(s1, bPrime);
  // 客户端 B 本地已应用 B，收到 A 的广播后把 A 变换到 B 之后
  const s2 = applyOp(doc, opB);
  const aPrime = transformOp(opA, opB, 'u1', 'u2');
  const clientDoc = applyOp(s2, aPrime);
  assert.equal(serverDoc, clientDoc);
});
