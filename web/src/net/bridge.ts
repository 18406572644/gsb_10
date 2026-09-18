import { ElMessage } from 'element-plus';
import { socket } from './socket';
import { useSessionStore } from '../stores/session';
import { useDocumentStore } from '../stores/document';
import { useAnnotationStore } from '../stores/annotations';
import { usePresenceStore } from '../stores/presence';

/**
 * 传输层 -> 业务层的接线：把 socket 事件分发到各个 store。
 * 连接建立后第一件事总是 join，服务端随后下发全量快照（sync），
 * 因此重连 = 重新 join + 全量同步，天然覆盖"断网期间错过的所有消息"。
 */
export function initBridge() {
  const session = useSessionStore();
  const doc = useDocumentStore();
  const annotations = useAnnotationStore();
  const presence = usePresenceStore();

  socket.onStatus((s) => {
    if (s === 'online') {
      // 连接建立：先 join，等 sync 到达前标记为 syncing（编辑器只读）
      session.connStatus = 'syncing';
      socket.send({ t: 'join', docId: session.docId, name: session.name, role: session.role });
    } else {
      session.connStatus = s === 'connecting' ? 'connecting' : 'offline';
      doc.onDisconnected(); // 回滚未确认的乐观更新
      presence.clear();
    }
  });

  socket.onMessage((msg) => {
    switch (msg.t) {
      case 'sync':
        session.userId = msg.you.id;
        session.role = msg.you.role;
        session.members = msg.members;
        doc.applySync(msg);
        annotations.setAll(msg.annotations);
        presence.clear();
        session.connStatus = 'online';
        break;
      case 'op':
        doc.onRemoteOp(msg);
        break;
      case 'ack':
        doc.onAck(msg);
        break;
      case 'reject':
        doc.onReject(msg);
        break;
      case 'ann:add':
      case 'ann:update':
        annotations.upsert(msg.ann);
        break;
      case 'ann:del':
        annotations.remove(msg.id);
        break;
      case 'members':
        session.members = msg.members;
        presence.prune(msg.members);
        break;
      case 'presence':
        presence.update(msg);
        break;
      case 'pong':
        session.latency = Date.now() - msg.ts;
        break;
      case 'error':
        ElMessage.error(msg.message || '服务器错误');
        break;
    }
  });
}
