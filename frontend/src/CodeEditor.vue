<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as monaco from 'monaco-editor';

const props = defineProps({
  modelValue: { type: String, default: '' },
  language: { type: String, default: 'plaintext' },
  theme: { type: String, default: 'vs-dark' },
});
const emit = defineEmits(['update:modelValue']);

const el = ref(null);
let editor = null;

onMounted(() => {
  editor = monaco.editor.create(el.value, {
    value: props.modelValue,
    language: props.language,
    theme: props.theme,
    automaticLayout: true,
    fontSize: 12.5,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    tabSize: 2,
  });
  editor.onDidChangeModelContent(() => emit('update:modelValue', editor.getValue()));
});

watch(
  () => props.modelValue,
  (v) => { if (editor && v !== editor.getValue()) editor.setValue(v); },
);
watch(
  () => props.language,
  (lang) => { if (editor) monaco.editor.setModelLanguage(editor.getModel(), lang); },
);
watch(
  () => props.theme,
  (t) => { if (editor) monaco.editor.setTheme(t); },
);

onBeforeUnmount(() => { editor?.dispose(); });
</script>

<template>
  <div ref="el" class="code-editor"></div>
</template>

<style scoped>
.code-editor {
  width: 100%;
  height: 100%;
  min-height: 140px;
  border: 1px solid var(--ant-color-border-secondary, #d9d9d9);
  border-radius: 6px;
  overflow: hidden;
}
</style>
