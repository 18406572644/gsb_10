/**
 * OT 核心：针对纯文本的 insert / delete 单操作。
 *
 * 操作模型（有意保持简单，便于推理与验证）：
 *   - insert: { type: 'insert', pos, text }   在 pos 处插入 text
 *   - delete: { type: 'delete', pos, len }    删除 [pos, pos+len)
 *
 * 并发冲突通过 transformOp(a, b) 解决：把 a 变换为"在 b 已应用之后"的等价操作。
 * insert/insert 同位置冲突用 tie（用户 id 字典序）做确定性裁决，
 * 服务端与客户端必须使用同一规则才能收敛。
 */

export function applyOp(doc, op) {
  if (!op) return doc;
  if (op.type === 'insert') {
    return doc.slice(0, op.pos) + op.text + doc.slice(op.pos);
  }
  if (op.type === 'delete') {
    return doc.slice(0, op.pos) + doc.slice(op.pos + op.len);
  }
  throw new Error(`unknown op type: ${op.type}`);
}

export function validateOp(doc, op) {
  if (!op || typeof op !== 'object') return false;
  if (op.type === 'insert') {
    return (
      Number.isInteger(op.pos) &&
      op.pos >= 0 &&
      op.pos <= doc.length &&
      typeof op.text === 'string' &&
      op.text.length > 0 &&
      op.text.length <= 10000
    );
  }
  if (op.type === 'delete') {
    return (
      Number.isInteger(op.pos) &&
      Number.isInteger(op.len) &&
      op.pos >= 0 &&
      op.len > 0 &&
      op.pos + op.len <= doc.length
    );
  }
  return false;
}

/**
 * 把操作 a 变换到"操作 b 已应用"的上下文中，返回 a'；若 a 变成空操作则返回 null。
 * tieA / tieB 为双方用户 id，用于 insert/insert 同位置时的确定性排序（小 id 在前）。
 */
export function transformOp(a, b, tieA = '', tieB = '') {
  if (!b) return a;
  if (a.type === 'insert') {
    if (b.type === 'insert') {
      let pos = a.pos;
      if (b.pos < a.pos || (b.pos === a.pos && tieB <= tieA)) pos += b.text.length;
      return { ...a, pos };
    }
    // b 是删除
    if (a.pos <= b.pos) return { ...a };
    if (a.pos >= b.pos + b.len) return { ...a, pos: a.pos - b.len };
    // 插入点落在被删区间内：收缩到区间起点
    return { ...a, pos: b.pos };
  }
  // a 是删除
  if (b.type === 'insert') {
    if (b.pos <= a.pos) return { ...a, pos: a.pos + b.text.length };
    if (b.pos >= a.pos + a.len) return { ...a };
    // 插入落在删除区间内：扩展删除范围将其覆盖（简单策略，避免拆分操作）
    return { ...a, len: a.len + b.text.length };
  }
  // b 也是删除
  if (b.pos + b.len <= a.pos) return { ...a, pos: a.pos - b.len };
  if (b.pos >= a.pos + a.len) return { ...a };
  // 区间重叠：扣除已被 b 删掉的部分
  const start = Math.max(a.pos, b.pos);
  const end = Math.min(a.pos + a.len, b.pos + b.len);
  const overlap = end - start;
  const len = a.len - overlap;
  const pos = b.pos < a.pos ? b.pos : a.pos;
  if (len <= 0) return null; // 目标文本已被对方删光，变为空操作
  return { ...a, pos, len };
}

/**
 * 变换一个位置（光标 / 批注锚点）。
 * assoc='left'：紧贴左侧（插入在同位置时不移动，用于区间起点）
 * assoc='right'：紧贴右侧（插入在同位置时随之右移，用于区间终点 / 光标）
 */
export function transformPos(pos, op, assoc = 'right') {
  if (!op) return pos;
  if (op.type === 'insert') {
    if (pos > op.pos || (pos === op.pos && assoc === 'right')) return pos + op.text.length;
    return pos;
  }
  // delete
  if (pos <= op.pos) return pos;
  if (pos >= op.pos + op.len) return pos - op.len;
  return op.pos; // 落在被删区间内：收缩到区间起点
}

/** 由新旧文本计算最小编辑操作序列（公共前缀/后缀 diff），一次输入事件最多产生 delete+insert 两个操作 */
export function diffOps(oldText, newText) {
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
  const ops = [];
  if (oldEnd > start) ops.push({ type: 'delete', pos: start, len: oldEnd - start });
  if (newEnd > start) ops.push({ type: 'insert', pos: start, text: newText.slice(start, newEnd) });
  return ops;
}
