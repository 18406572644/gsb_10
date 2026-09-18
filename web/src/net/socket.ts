type MsgHandler = (msg: any) => void;
type StatusHandler = (status: 'online' | 'connecting' | 'offline') => void;

const HEARTBEAT_INTERVAL = 15_000; // 客户端 ping 间隔
const WATCHDOG_TIMEOUT = 45_000; // 超过该时长无任何消息 -> 判定连接死亡，主动断开触发重连
const MAX_RECONNECT_DELAY = 10_000;

/**
 * WebSocket 传输层：只负责连接生命周期，不感知业务。
 * - 断线自动重连：指数退避（1s -> 2s -> ... -> 上限 10s）+ 随机抖动，避免重连风暴
 * - 心跳 + 看门狗：检测"假死"连接（TCP 半开）
 * - 断线期间 send 返回 false，由上层决定丢弃（presence）还是阻止（编辑）
 */
class CollabSocket {
  private ws: WebSocket | null = null;
  private url = '';
  private manualClose = false;
  private reconnectDelay = 1000;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private watchdogTimer: number | null = null;
  private msgHandlers: MsgHandler[] = [];
  private statusHandlers: StatusHandler[] = [];

  onMessage(h: MsgHandler) {
    this.msgHandlers.push(h);
  }

  onStatus(h: StatusHandler) {
    this.statusHandlers.push(h);
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(url: string) {
    this.url = url;
    this.manualClose = false;
    this.reconnectDelay = 1000;
    this.open();
  }

  disconnect() {
    this.manualClose = true;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    this.emitStatus('offline');
  }

  send(msg: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private open() {
    this.emitStatus('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.startHeartbeat();
      this.resetWatchdog();
      this.emitStatus('online');
    };
    ws.onmessage = (ev) => {
      this.resetWatchdog();
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      for (const h of this.msgHandlers) h(msg);
    };
    ws.onclose = () => {
      this.stopHeartbeat();
      if (this.manualClose) {
        this.emitStatus('offline');
        return;
      }
      // 异常断开：退避重连
      this.emitStatus('connecting');
      const delay = this.reconnectDelay + Math.random() * 500;
      this.reconnectTimer = window.setTimeout(() => this.open(), delay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY);
    };
    ws.onerror = () => {
      ws.close();
    };
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      this.send({ t: 'ping', ts: Date.now() });
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private resetWatchdog() {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = window.setTimeout(() => {
      // 长时间无任何消息（含 pong），连接可能已假死
      this.ws?.close();
    }, WATCHDOG_TIMEOUT);
  }

  private clearTimers() {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emitStatus(s: 'online' | 'connecting' | 'offline') {
    for (const h of this.statusHandlers) h(s);
  }
}

export const socket = new CollabSocket();
