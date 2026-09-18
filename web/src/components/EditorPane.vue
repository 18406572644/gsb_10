<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useDocumentStore } from '../stores/document';
import { useAnnotationStore } from '../stores/annotations';
import { useSessionStore } from '../stores/session';
import { transformPos } from '../ot/operations';
import { socket } from '../net/socket';

const doc = useDocumentStore();
const annotations = useAnnotationStore();
const session = useSessionStore();

const ta = ref<HTMLTextAreaElement>();
const composing = ref(false); // 中文输入法组合中：暂不 diff，组合结束统一结算
const annDialogVisible = ref(false);
const annContent = ref('');
const annSelection = ref<{ start: number; end: number } | null>(null);

const charCount = computed(() => doc.content.length);
const canAnnotateSelection = computed(
  () => doc.canAnnotate && annSelection.value !== null && annSelection.value.end > annSelection.value.start,
);

// ---------- 本地输入 ----------

function onInput() {
  if (composing.value) return; // IME 组合期间的事件在 compositionend 统一处理
  const el = ta.value;
  if (!el) return;
  doc.localEdit(el.value);
  schedulePresence();
}

function onCompositionEnd() {
  composing.value = false;
  const el = ta.value;
  if (!el) return;
  doc.localEdit(el.value);
}

// ---------- 远端变更 / 全量同步：非受控 textarea，手动写回并修正光标 ----------

watch(
  () => doc.content,
  (newVal) => {
    const el = ta.value;
    if (!el || el.value === newVal) return; // 本地输入已体现在 DOM 上
    const remote = doc.lastRemoteOp;
    const s = el.selectionStart;
    const e = el.selectionEnd;
    el.value = newVal;
    if (remote) {
      // 光标随远端操作移动，避免"打着打着光标跳走"
      el.selectionStart = transformPos(s, remote.op, 'right');
      el.selectionEnd = transformPos(e, remote.op, 'right');
    } else {
      const p = Math.min(s, newVal.length);
      el.selectionStart = el.selectionEnd = p;
    }
  },
);

watch(
  () => doc.syncSeq,
  async () => {
    // 全量重同步：直接重置编辑器内容
    const el = ta.value;
    if (!el) return;
    el.value = doc.content;
    await nextTick();
    el.selectionStart = el.selectionEnd = Math.min(el.selectionStart, el.value.length);
  },
);

// 批注面板"定位"：选中对应文本区间
watch(
  () => doc.revealRange,
  (r) => {
    const el = ta.value;
    if (!el || !r) return;
    el.focus();
    el.selectionStart = Math.min(r.start, el.value.length);
    el.selectionEnd = Math.min(r.end, el.value.length);
    schedulePresence();
  },
);

// ---------- 光标 presence（节流 120ms，仅在线时发送） ----------

let presenceTimer: number | null = null;
let lastPresenceAt = 0;

function currentSelection() {
  const el = ta.value;
  if (!el) return null;
  return { pos: el.selectionStart, start: el.selectionStart, end: el.selectionEnd };
}

function sendPresence() {
  lastPresenceAt = Date.now();
  const cursor = currentSelection();
  if (cursor) socket.send({ t: 'presence', cursor });
}

function schedulePresence() {
  const now = Date.now();
  const elapsed = now - lastPresenceAt;
  if (elapsed >= 120) {
    sendPresence();
  } else if (!presenceTimer) {
    presenceTimer = window.setTimeout(() => {
      presenceTimer = null;
      sendPresence();
    }, 120 - elapsed);
  }
}

function trackSelection() {
  const el = ta.value;
  if (!el) return;
  annSelection.value = { start: el.selectionStart, end: el.selectionEnd };
  schedulePresence();
}

// ---------- 添加批注 ----------

function openAnnDialog() {
  const el = ta.value;
  if (!el) return;
  annSelection.value = { start: el.selectionStart, end: el.selectionEnd };
  if (annSelection.value.end <= annSelection.value.start) {
    ElMessage.info('请先在文档中选中一段文字');
    return;
  }
  annContent.value = '';
  annDialogVisible.value = true;
}

function submitAnnotation() {
  const sel = annSelection.value;
  if (!sel || !annContent.value.trim()) return;
  const quote = doc.content.slice(sel.start, sel.end);
  const ok = annotations.add(sel.start, sel.end, quote, annContent.value.trim());
  if (ok) {
    annDialogVisible.value = false;
  } else {
    ElMessage.error('连接已断开，批注未发送');
  }
}

onMounted(() => {
  const el = ta.value;
  if (el) el.value = doc.content;
});

onUnmounted(() => {
  if (presenceTimer) clearTimeout(presenceTimer);
  socket.send({ t: 'presence', cursor: null });
});
</script>

<template>
  <section class="editor-pane">
    <div class="editor-toolbar">
      <el-button
        type="warning"
        size="small"
        plain
        :disabled="!canAnnotateSelection"
        @mousedown.prevent
        @click="openAnnDialog"
      >
        ✎ 添加批注
      </el-button>
      <span v-if="!doc.canAnnotate && session.role === 'viewer'">只读角色：可查看，不可编辑/批注</span>
      <span v-else-if="doc.canAnnotate">选中文字后可添加批注</span>
      <span class="spacer" style="flex: 1" />
      <span>{{ charCount }} 字符 · v{{ doc.version }}</span>
    </div>
    <textarea
      ref="ta"
      class="editor-textarea"
      :readonly="!doc.canEdit"
      :placeholder="doc.canEdit ? '开始输入，多人可实时协同编辑…' : '当前为只读状态'"
      @input="onInput"
      @compositionstart="composing = true"
      @compositionend="onCompositionEnd"
      @select="trackSelection"
      @keyup="trackSelection"
      @click="trackSelection"
    />

    <el-dialog v-model="annDialogVisible" title="添加批注" width="420px">
      <div style="margin-bottom: 8px; color: #909399; font-size: 13px">
        引用：{{ doc.content.slice(annSelection?.start ?? 0, annSelection?.end ?? 0).slice(0, 80)
        }}{{ (annSelection?.end ?? 0) - (annSelection?.start ?? 0) > 80 ? '…' : '' }}
      </div>
      <el-input
        v-model="annContent"
        type="textarea"
        :rows="3"
        maxlength="2000"
        placeholder="输入批注内容…"
        @keyup.enter.ctrl="submitAnnotation"
      />
      <template #footer>
        <el-button @click="annDialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!annContent.trim()" @click="submitAnnotation">提交</el-button>
      </template>
    </el-dialog>
  </section>
</template>
