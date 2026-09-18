<script setup lang="ts">
import { onMounted } from 'vue';
import { useSessionStore } from './stores/session';
import LoginView from './views/LoginView.vue';
import EditorView from './views/EditorView.vue';

const session = useSessionStore();

onMounted(() => {
  // 刷新页面时尝试恢复会话（重连场景）
  session.restore();
});
</script>

<template>
  <LoginView v-if="!session.joined" />
  <EditorView v-else />
</template>
