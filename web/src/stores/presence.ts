import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Cursor, Member, Role } from '../types';

export interface PresenceEntry {
  name: string;
  role: Role;
  cursor: Cursor | null;
  ts: number;
}

const STALE_TIMEOUT = 15_000;

/** 由用户 id 生成稳定颜色 */
export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 70% 45%)`;
}

export const usePresenceStore = defineStore('presence', () => {
  /** 其他成员的光标（自己的不显示） */
  const cursors = ref<Record<string, PresenceEntry>>({});

  function update(msg: any) {
    if (msg.cursor === null) {
      delete cursors.value[msg.userId];
      return;
    }
    cursors.value[msg.userId] = {
      name: msg.name,
      role: msg.role,
      cursor: msg.cursor,
      ts: Date.now(),
    };
  }

  /** 成员列表变化时剔除已离开者 */
  function prune(members: Member[]) {
    const ids = new Set(members.map((m) => m.id));
    for (const id of Object.keys(cursors.value)) {
      if (!ids.has(id)) delete cursors.value[id];
    }
  }

  /** 清理超时未更新的光标（对方假死但还没断线） */
  function pruneStale() {
    const now = Date.now();
    for (const [id, p] of Object.entries(cursors.value)) {
      if (now - p.ts > STALE_TIMEOUT) delete cursors.value[id];
    }
  }

  function clear() {
    cursors.value = {};
  }

  return { cursors, update, prune, pruneStale, clear };
});
