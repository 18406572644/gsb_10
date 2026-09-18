<script setup lang="ts">
import { computed } from 'vue';
import { useSessionStore } from '../stores/session';
import { ROLE_LABEL } from '../types';

const session = useSessionStore();

const statusTag = computed(() => {
  switch (session.connStatus) {
    case 'online':
      return { type: 'success' as const, text: '已连接' };
    case 'syncing':
      return { type: 'warning' as const, text: '同步中' };
    case 'connecting':
      return { type: 'warning' as const, text: '重连中' };
    default:
      return { type: 'danger' as const, text: '离线' };
  }
});

const roleTagType = computed(() =>
  session.role === 'editor' ? 'primary' : session.role === 'commenter' ? 'warning' : 'info',
);
</script>

<template>
  <el-tag :type="statusTag.type" size="small">{{ statusTag.text }}</el-tag>
  <el-tag v-if="session.latency !== null && session.connStatus === 'online'" size="small" type="info">
    {{ session.latency }}ms
  </el-tag>
  <el-tag :type="(roleTagType as any)" size="small">我的角色：{{ ROLE_LABEL[session.role] }}</el-tag>
  <el-button size="small" text type="danger" @click="session.leave()">退出文档</el-button>
</template>
