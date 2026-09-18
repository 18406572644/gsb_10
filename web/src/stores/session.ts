import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ConnStatus, Member, Role } from '../types';
import { socket } from '../net/socket';

const WS_URL =
  (import.meta.env.VITE_WS_URL as string | undefined) ||
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

export const useSessionStore = defineStore('session', () => {
  const joined = ref(false);
  const userId = ref('');
  const name = ref('');
  const docId = ref('demo');
  const role = ref<Role>('viewer');
  const members = ref<Member[]>([]);
  const connStatus = ref<ConnStatus>('offline');
  const latency = ref<number | null>(null);

  /** 登录并建立连接（重连由 socket 层自动完成，每次连接成功都会重新 join） */
  function join(form: { name: string; docId: string; role: Role }) {
    name.value = form.name;
    docId.value = form.docId || 'demo';
    role.value = form.role;
    joined.value = true;
    connStatus.value = 'connecting';
    socket.connect(WS_URL);
    // 断网刷新后恢复会话
    sessionStorage.setItem('collab.session', JSON.stringify(form));
  }

  function leave() {
    socket.disconnect();
    joined.value = false;
    connStatus.value = 'offline';
    members.value = [];
    userId.value = '';
    sessionStorage.removeItem('collab.session');
  }

  function restore(): boolean {
    try {
      const raw = sessionStorage.getItem('collab.session');
      if (!raw) return false;
      const form = JSON.parse(raw);
      if (!form?.name || !form?.role) return false;
      join({ name: form.name, docId: form.docId || 'demo', role: form.role });
      return true;
    } catch {
      return false;
    }
  }

  return { joined, userId, name, docId, role, members, connStatus, latency, join, leave, restore };
});
