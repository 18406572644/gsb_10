<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useSessionStore } from '../stores/session';
import { usePresenceStore } from '../stores/presence';
import EditorPane from '../components/EditorPane.vue';
import AnnotationPanel from '../components/AnnotationPanel.vue';
import PresenceBar from '../components/PresenceBar.vue';
import StatusBar from '../components/StatusBar.vue';

const session = useSessionStore();
const presence = usePresenceStore();

const banner = computed(() => {
  switch (session.connStatus) {
    case 'connecting':
      return { type: 'warning', text: '连接已断开，正在自动重连…（期间编辑与批注已暂停）' };
    case 'syncing':
      return { type: 'warning', text: '正在与服务器同步最新状态…' };
    case 'offline':
      return { type: 'error', text: '连接已断开' };
    default:
      return null;
  }
});

let staleTimer: number;
onMounted(() => {
  staleTimer = window.setInterval(() => presence.pruneStale(), 5000);
});
onUnmounted(() => clearInterval(staleTimer));
</script>

<template>
  <div class="editor-page">
    <header class="editor-header">
      <span class="doc-title">📄 {{ session.docId }}</span>
      <StatusBar />
      <span class="spacer" />
      <PresenceBar />
    </header>
    <el-alert
      v-if="banner"
      :type="(banner.type as any)"
      :title="banner.text"
      :closable="false"
      class="offline-banner"
      show-icon
    />
    <main class="editor-main">
      <EditorPane />
      <AnnotationPanel />
    </main>
  </div>
</template>
