import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Annotation, Op } from '../types';
import { transformPos } from '../ot/operations';
import { socket } from '../net/socket';

export const useAnnotationStore = defineStore('annotations', () => {
  const list = ref<Annotation[]>([]);
  const filter = ref<'all' | 'open' | 'resolved'>('all');

  const sorted = computed(() =>
    [...list.value]
      .filter((a) => (filter.value === 'all' ? true : filter.value === 'open' ? !a.resolved : a.resolved))
      .sort((a, b) => a.start - b.start),
  );
  const openCount = computed(() => list.value.filter((a) => !a.resolved).length);

  function setAll(annotations: Annotation[]) {
    list.value = annotations ?? [];
  }

  function upsert(ann: Annotation) {
    const i = list.value.findIndex((a) => a.id === ann.id);
    if (i >= 0) list.value[i] = ann;
    else list.value.push(ann);
  }

  function remove(id: string) {
    list.value = list.value.filter((a) => a.id !== id);
  }

  /** 文档发生（本地或远端）操作时，同步移动所有批注锚点，与服务端保持同一变换规则 */
  function transformAnchors(op: Op) {
    for (const a of list.value) {
      a.start = transformPos(a.start, op, 'left');
      a.end = transformPos(a.end, op, 'right');
      if (a.end < a.start) a.end = a.start;
    }
  }

  // ---- 以下均为"请求-回显"模式：只发请求，UI 更新等服务端广播，保证各端一致 ----

  function add(start: number, end: number, quote: string, content: string) {
    return socket.send({ t: 'ann:add', start, end, quote, content });
  }

  function setResolved(ann: Annotation, resolved: boolean) {
    return socket.send({ t: 'ann:update', id: ann.id, patch: { resolved } });
  }

  function reply(ann: Annotation, content: string) {
    return socket.send({ t: 'ann:update', id: ann.id, patch: { reply: content } });
  }

  function del(ann: Annotation) {
    return socket.send({ t: 'ann:del', id: ann.id });
  }

  return { list, filter, sorted, openCount, setAll, upsert, remove, transformAnchors, add, setResolved, reply, del };
});
