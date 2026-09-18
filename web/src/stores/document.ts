import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { ElMessage } from 'element-plus';
import type { Op } from '../types';
import { applyOp, diffOps } from '../ot/operations';
import { OtClient } from '../ot/client';
import { socket } from '../net/socket';
import { useSessionStore } from './session';
import { useAnnotationStore } from './annotations';

let resyncToastAt = 0;

export const useDocumentStore = defineStore('document', () => {
  const session = useSessionStore();
  const annotations = useAnnotationStore();

  const content = ref('');
  const version = ref(0);
  /** 最近一次应用到文档的远端操作（EditorPane 用它修正本地光标） */
  const lastRemoteOp = shallowRef<{ op: Op; n: number } | null>(null);
  /** 全量同步计数（EditorPane 用它重置编辑器） */
  const syncSeq = ref(0);
  /** 批注面板 -> 编辑器 的"定位到区间"信号 */
  const revealRange = shallowRef<{ start: number; end: number; n: number } | null>(null);

  let ot: OtClient | null = null;

  const canEdit = computed(() => session.role === 'editor' && session.connStatus === 'online');
  const canAnnotate = computed(
    () => (session.role === 'editor' || session.role === 'commenter') && session.connStatus === 'online',
  );

  // ---------- 本地编辑 ----------

  function localEdit(newText: string) {
    const ops = diffOps(content.value, newText);
    if (!ops.length) return;
    content.value = newText; // 乐观更新：本地立即生效
    if (!ot) {
      // 连接未就绪（理论上编辑器此时是只读的，双保险）
      requestResync('edit-while-not-ready');
      return;
    }
    for (const op of ops) {
      ot.localOp(op);
      annotations.transformAnchors(op);
    }
  }

  // ---------- 远端消息 ----------

  function applySync(msg: any) {
    content.value = msg.content;
    version.value = msg.version;
    syncSeq.value++;
    ot = new OtClient(msg.version, msg.you.id, (m) => socket.send(m), {
      applyRemote,
      requestResync,
    });
  }

  function applyRemote(op: Op) {
    content.value = applyOp(content.value, op);
    annotations.transformAnchors(op);
    lastRemoteOp.value = { op, n: Date.now() };
  }

  function onRemoteOp(msg: any) {
    ot?.handleRemoteOp(msg.op ?? null, msg.version, msg.userId);
  }

  function onAck(msg: any) {
    ot?.handleAck(msg.clientOpId, msg.version);
  }

  function onReject(msg: any) {
    ElMessage.error(`操作被服务器拒绝：${msg.reason || '未知原因'}，正在重新同步`);
    ot?.handleReject();
  }

  // ---------- 回滚与重同步 ----------

  /**
   * 状态回滚的唯一入口：丢弃所有未确认的乐观更新，向服务器请求全量快照。
   * 触发场景：版本断裂（丢消息）、ack 超时/不匹配、操作被拒、断线重连。
   */
  function requestResync(reason: string) {
    if (session.connStatus !== 'online' && session.connStatus !== 'syncing') return;
    ot = null; // 未确认操作随 OT 实例一起丢弃
    session.connStatus = 'syncing';
    const now = Date.now();
    if (now - resyncToastAt > 3000) {
      resyncToastAt = now;
      ElMessage.warning(`连接状态异常（${reason}），正在回滚并重新同步…`);
    }
    if (!socket.send({ t: 'resync' })) {
      // 连发送都失败说明连接已断，等待重连后由 open 事件触发 join -> sync
      session.connStatus = 'connecting';
    }
  }

  /** 断线：未确认的乐观更新无法保证送达，直接回滚，等重连后的全量快照 */
  function onDisconnected() {
    ot = null;
  }

  return {
    content,
    version,
    lastRemoteOp,
    syncSeq,
    revealRange,
    canEdit,
    canAnnotate,
    localEdit,
    applySync,
    onRemoteOp,
    onAck,
    onReject,
    requestResync,
    onDisconnected,
  };
});
