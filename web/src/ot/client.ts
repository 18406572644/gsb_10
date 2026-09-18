import type { Op } from '../types';
import { transformOp } from './operations';

let seq = 0;
const nextId = () => `c${Date.now().toString(36)}-${(seq++).toString(36)}`;

const ACK_TIMEOUT = 10_000; // ack 超时：认为消息丢失，触发全量重同步

export interface OtHooks {
  /** 把（已 rebase 到本地上下文的）远端操作应用到本地文档 */
  applyRemote(op: Op): void;
  /** 版本断裂 / ack 异常 / 操作被拒：本地乐观更新需要回滚，请求全量重同步 */
  requestResync(reason: string): void;
}

/**
 * 客户端 OT 状态机：
 *   inflight —— 已发送、等待 ack 的操作（最多一个）
 *   pending  —— 已本地应用、待发送的队列
 * 本地操作立即生效（乐观更新），远端操作到达时与 inflight/pending 做 rebase。
 * 服务端保证 version 连续递增，任何断裂都意味着消息丢失 -> 重同步。
 */
export class OtClient {
  serverVersion: number;
  private inflight: { op: Op | null; clientOpId: string } | null = null;
  private pending: Op[] = [];
  private ackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    initialVersion: number,
    private userId: string,
    private send: (msg: Record<string, unknown>) => void,
    private hooks: OtHooks,
  ) {
    this.serverVersion = initialVersion;
  }

  localOp(op: Op) {
    if (this.inflight) {
      this.pending.push(op);
    } else {
      this.sendOp(op);
    }
  }

  private sendOp(op: Op) {
    const clientOpId = nextId();
    this.inflight = { op, clientOpId };
    this.send({ t: 'op', op, baseVersion: this.serverVersion, clientOpId });
    this.ackTimer = setTimeout(() => this.hooks.requestResync('ack-timeout'), ACK_TIMEOUT);
  }

  private clearAckTimer() {
    if (this.ackTimer) {
      clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }
  }

  handleRemoteOp(op: Op | null, version: number, userId: string) {
    if (version !== this.serverVersion + 1) {
      // 版本断裂：中间丢了消息，本地状态不可信，全量重同步
      this.hooks.requestResync(`version-gap: 期望 ${this.serverVersion + 1}，收到 ${version}`);
      return;
    }
    this.serverVersion = version;
    if (!op) return; // 空操作 tick（并发删除完全重叠等场景），只占版本号

    // rebase：远端操作依次与本地未确认操作互相变换
    let remote: Op | null = op;
    const rebase = (local: Op | null): Op | null => {
      if (!local || !remote) return local;
      const l = transformOp(local, remote, this.userId, userId);
      remote = transformOp(remote, local, userId, this.userId);
      return l;
    };
    if (this.inflight?.op) this.inflight.op = rebase(this.inflight.op);
    this.pending = this.pending.map(rebase).filter((o): o is Op => !!o);

    if (remote) this.hooks.applyRemote(remote);
  }

  handleAck(clientOpId: string, version: number) {
    if (!this.inflight || this.inflight.clientOpId !== clientOpId || version !== this.serverVersion + 1) {
      this.hooks.requestResync('ack-mismatch');
      return;
    }
    this.clearAckTimer();
    this.inflight = null;
    this.serverVersion = version;
    const next = this.pending.shift();
    if (next) this.sendOp(next);
  }

  handleReject() {
    // 服务端拒绝（权限/版本过旧/非法操作）：本地乐观更新无法保留，回滚并重同步
    this.hooks.requestResync('op-rejected');
  }

  /** 丢弃所有未确认操作（回滚），以全量快照为新的起点 */
  reset(version: number) {
    this.clearAckTimer();
    this.inflight = null;
    this.pending = [];
    this.serverVersion = version;
  }
}
