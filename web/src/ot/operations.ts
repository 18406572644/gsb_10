import type { Op } from '../types';

/**
 * OT 核心（与服务端 src/ot.js 同一套规则，两边必须保持一致才能收敛）。
 */

export function applyOp(doc: string, op: Op | null): string {
  if (!op) return doc;
  if (op.type === 'insert') {
    return doc.slice(0, op.pos) + op.text + doc.slice(op.pos);
  }
  return doc.slice(0, op.pos) + doc.slice(op.pos + op.len);
}

/** 把 a 变换到「b 已应用」之后；a 变为空操作时返回 null。tie 用于 insert/insert 同位置的确定性排序（小 id 在前）。 */
export function transformOp(a: Op, b: Op | null, tieA = '', tieB = ''): Op | null {
  if (!b) return a;
  if (a.type === 'insert') {
    if (b.type === 'insert') {
      let pos = a.pos;
      if (b.pos < a.pos || (b.pos === a.pos && tieB <= tieA)) pos += b.text.length;
      return { ...a, pos };
    }
    if (a.pos <= b.pos) return { ...a };
    if (a.pos >= b.pos + b.len) return { ...a, pos: a.pos - b.len };
    return { ...a, pos: b.pos };
  }
  // a 是 delete
  if (b.type === 'insert') {
    if (b.pos <= a.pos) return { ...a, pos: a.pos + b.text.length };
    if (b.pos >= a.pos + a.len) return { ...a };
    return { ...a, len: a.len + b.text.length };
  }
  // b 也是 delete
  if (b.pos + b.len <= a.pos) return { ...a, pos: a.pos - b.len };
  if (b.pos >= a.pos + a.len) return { ...a };
  const start = Math.max(a.pos, b.pos);
  const end = Math.min(a.pos + a.len, b.pos + b.len);
  const len = a.len - (end - start);
  const pos = b.pos < a.pos ? b.pos : a.pos;
  if (len <= 0) return null;
  return { ...a, pos, len };
}

/** 变换光标/锚点位置。assoc='left' 用于区间起点，'right' 用于终点/光标。 */
export function transformPos(pos: number, op: Op | null, assoc: 'left' | 'right' = 'right'): number {
  if (!op) return pos;
  if (op.type === 'insert') {
    if (pos > op.pos || (pos === op.pos && assoc === 'right')) return pos + op.text.length;
    return pos;
  }
  if (pos <= op.pos) return pos;
  if (pos >= op.pos + op.len) return pos - op.len;
  return op.pos;
}

/** 新旧文本 diff 出最小操作序列（一次输入事件最多 delete + insert 两个操作） */
export function diffOps(oldText: string, newText: string): Op[] {
  if (oldText === newText) return [];
  let start = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (start < minLen && oldText[start] === newText[start]) start++;
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const ops: Op[] = [];
  if (oldEnd > start) ops.push({ type: 'delete', pos: start, len: oldEnd - start });
  if (newEnd > start) ops.push({ type: 'insert', pos: start, text: newText.slice(start, newEnd) });
  return ops;
}
