<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useSessionStore } from '../stores/session';
import type { Role } from '../types';

const session = useSessionStore();

const form = reactive({
  name: '',
  docId: 'demo',
  role: 'editor' as Role,
});

const submitting = ref(false);

const ROLE_OPTIONS: { value: Role; label: string; desc: string }[] = [
  { value: 'editor', label: '编辑', desc: '可编辑文档、添加/回复批注' },
  { value: 'commenter', label: '批注', desc: '不可改文档，可添加/回复批注' },
  { value: 'viewer', label: '只读', desc: '仅查看文档、批注与他人光标' },
];

function submit() {
  if (!form.name.trim()) return;
  submitting.value = true;
  session.join({ name: form.name.trim(), docId: form.docId.trim() || 'demo', role: form.role });
}
</script>

<template>
  <div class="login-wrap">
    <el-card class="login-card">
      <h2>协同批注编辑器</h2>
      <p class="sub">多人实时协同 · OT 冲突解决 · 断线自动重连</p>
      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="昵称">
          <el-input v-model="form.name" maxlength="32" placeholder="输入你的昵称" autofocus />
        </el-form-item>
        <el-form-item label="文档 ID（相同 ID 的人编辑同一篇文档）">
          <el-input v-model="form.docId" maxlength="64" placeholder="demo" />
        </el-form-item>
        <el-form-item label="角色">
          <el-radio-group v-model="form.role" style="flex-direction: column; align-items: flex-start">
            <el-radio v-for="r in ROLE_OPTIONS" :key="r.value" :value="r.value" style="height: auto; margin-bottom: 4px">
              <b>{{ r.label }}</b>
              <span style="color: #909399; font-size: 12px; margin-left: 6px">{{ r.desc }}</span>
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <el-button type="primary" style="width: 100%" :disabled="!form.name.trim()" :loading="submitting" @click="submit">
          进入文档
        </el-button>
      </el-form>
    </el-card>
  </div>
</template>
