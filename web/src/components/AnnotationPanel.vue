<script setup lang="ts">
import { ref } from 'vue';
import { useAnnotationStore } from '../stores/annotations';
import { useDocumentStore } from '../stores/document';
import { useSessionStore } from '../stores/session';
import type { Annotation } from '../types';

const annotations = useAnnotationStore();
const doc = useDocumentStore();
const session = useSessionStore();

const replyDraft = ref<Record<string, string>>({});
const replyOpen = ref<Record<string, boolean>>({});

function fmtTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function locate(ann: Annotation) {
  doc.revealRange = { start: ann.start, end: ann.end, n: Date.now() };
}

function canManage(ann: Annotation) {
  return ann.authorId === session.userId || session.role === 'editor';
}

function submitReply(ann: Annotation) {
  const text = (replyDraft.value[ann.id] || '').trim();
  if (!text) return;
  if (annotations.reply(ann, text)) {
    replyDraft.value[ann.id] = '';
  }
}
</script>

<template>
  <aside class="annotation-panel">
    <div class="panel-header">
      <span>
        批注
        <el-badge v-if="annotations.openCount" :value="annotations.openCount" type="warning" />
      </span>
      <el-radio-group v-model="annotations.filter" size="small">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="open">未解决</el-radio-button>
        <el-radio-button value="resolved">已解决</el-radio-button>
      </el-radio-group>
    </div>
    <div class="panel-body">
      <el-empty v-if="!annotations.sorted.length" description="暂无批注" :image-size="60" />
      <div v-for="ann in annotations.sorted" :key="ann.id" class="ann-card" :class="{ resolved: ann.resolved }">
        <div class="quote" title="点击定位到原文" @click="locate(ann)">
          「{{ ann.quote.length > 60 ? ann.quote.slice(0, 60) + '…' : ann.quote }}」
        </div>
        <div class="ann-content">{{ ann.content }}</div>
        <div class="ann-meta">
          <span>{{ ann.authorName }}</span>
          <span>{{ fmtTime(ann.createdAt) }}</span>
          <el-tag v-if="ann.resolved" type="success" size="small">已解决</el-tag>
        </div>
        <div v-if="ann.replies.length" class="ann-replies">
          <div v-for="r in ann.replies" :key="r.id" class="ann-reply">
            <span class="who">{{ r.authorName }}</span>{{ r.content }}
          </div>
        </div>
        <div class="ann-actions">
          <el-button size="small" text @click="locate(ann)">定位</el-button>
          <el-button v-if="doc.canAnnotate" size="small" text @click="replyOpen[ann.id] = !replyOpen[ann.id]">
            回复
          </el-button>
          <el-button
            v-if="canManage(ann)"
            size="small"
            text
            :type="ann.resolved ? 'warning' : 'success'"
            @click="annotations.setResolved(ann, !ann.resolved)"
          >
            {{ ann.resolved ? '重开' : '解决' }}
          </el-button>
          <el-popconfirm title="确定删除这条批注？" @confirm="annotations.del(ann)">
            <template #reference>
              <el-button v-if="canManage(ann)" size="small" text type="danger">删除</el-button>
            </template>
          </el-popconfirm>
        </div>
        <div v-if="replyOpen[ann.id]" style="margin-top: 6px; display: flex; gap: 4px">
          <el-input
            v-model="replyDraft[ann.id]"
            size="small"
            placeholder="回复…"
            @keyup.enter="submitReply(ann)"
          />
          <el-button size="small" type="primary" @click="submitReply(ann)">发送</el-button>
        </div>
      </div>
    </div>
  </aside>
</template>
