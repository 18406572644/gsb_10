<script setup lang="ts">
import { computed } from 'vue';
import { useSessionStore } from '../stores/session';
import { usePresenceStore, colorFor } from '../stores/presence';
import { ROLE_LABEL } from '../types';

const session = useSessionStore();
const presence = usePresenceStore();

const others = computed(() =>
  Object.entries(presence.cursors).map(([id, p]) => ({ id, ...p })),
);

function cursorText(userId: string) {
  const p = presence.cursors[userId];
  if (!p?.cursor) return '';
  return p.cursor.start === p.cursor.end
    ? `光标位于第 ${p.cursor.pos} 字符`
    : `选中了 ${p.cursor.end - p.cursor.start} 个字符`;
}
</script>

<template>
  <div class="presence-list">
    <el-tooltip
      v-for="m in session.members"
      :key="m.id"
      placement="bottom"
      :content="`${m.name}（${ROLE_LABEL[m.role]}）${m.id === session.userId ? ' - 我' : '：' + (cursorText(m.id) || '在线')}`"
    >
      <div class="presence-item">
        <span class="presence-dot" :style="{ background: colorFor(m.id) }" />
        <span>{{ m.name }}{{ m.id === session.userId ? '（我）' : '' }}</span>
        <el-tag size="small" :type="m.role === 'editor' ? 'primary' : m.role === 'commenter' ? 'warning' : 'info'">
          {{ ROLE_LABEL[m.role] }}
        </el-tag>
      </div>
    </el-tooltip>
    <span v-if="others.length === 0 && session.members.length <= 1" style="font-size: 12px; color: #909399">
      暂无其他协作者，可再开一个标签页加入
    </span>
  </div>
</template>
