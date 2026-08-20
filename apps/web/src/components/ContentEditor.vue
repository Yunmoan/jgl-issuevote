<template>
  <div class="content-editor">
    <n-space class="editor-toolbar" :size="4" :wrap="true" align="center">
      <n-radio-group v-model:value="mode" size="small" @update:value="changeMode">
        <n-radio-button value="markdown">Markdown</n-radio-button>
        <n-radio-button value="rich">富文本</n-radio-button>
      </n-radio-group>
      <n-divider vertical />
      <template v-if="mode === 'rich'">
        <n-tooltip v-for="tool in richTools" :key="tool.label" trigger="hover"><template #trigger><n-button quaternary circle size="small" :aria-label="tool.label" @click="runCommand(tool.command)"><template #icon><n-icon><component :is="tool.icon" /></n-icon></template></n-button></template>{{ tool.label }}</n-tooltip>
        <n-popover trigger="click" placement="bottom-start">
          <template #trigger><n-tooltip trigger="hover"><template #trigger><n-button quaternary circle size="small" aria-label="插入链接"><template #icon><n-icon><LinkOutline /></n-icon></template></n-button></template>插入链接</n-tooltip></template>
          <n-space vertical :size="8" style="width: 280px"><n-input v-model:value="linkUrl" placeholder="链接 URL，例如 https://..." /><n-button type="primary" size="small" :disabled="!linkUrl.trim()" @click="insertLink">插入链接</n-button></n-space>
        </n-popover>
        <n-popover trigger="click" placement="bottom-start">
          <template #trigger><n-tooltip trigger="hover"><template #trigger><n-button quaternary circle size="small" aria-label="插入图片"><template #icon><n-icon><ImageOutline /></n-icon></template></n-button></template>插入图片</n-tooltip></template>
          <n-space vertical :size="8" style="width: 280px"><n-input v-model:value="imageUrl" placeholder="图片 URL，例如 https://..." /><n-button type="primary" size="small" :disabled="!imageUrl.trim()" @click="insertImage">插入图片</n-button></n-space>
        </n-popover>
      </template>
      <n-button quaternary size="small" @click="preview = !preview"><template #icon><n-icon><EyeOutline /></n-icon></template>{{ preview ? '编辑' : '预览' }}</n-button>
    </n-space>

    <n-collapse-transition :show="!preview">
      <n-input v-if="mode === 'markdown'" v-model:value="markdown" type="textarea" :placeholder="placeholder" :autosize="{ minRows, maxRows: 24 }" @update:value="emitMarkdown" />
      <div v-else ref="editorRef" class="rich-editor" contenteditable="true" role="textbox" :aria-label="placeholder" @input="emitRich" @paste="handlePaste" />
    </n-collapse-transition>
    <n-collapse-transition :show="preview"><div v-if="preview" class="content-preview" v-html="renderedContent" /></n-collapse-transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { CodeSlashOutline, EyeOutline, ImageOutline, LinkOutline, ListOutline, TextOutline } from '@vicons/ionicons5';
import { NButton, NCollapseTransition, NDivider, NIcon, NInput, NPopover, NRadioButton, NRadioGroup, NSpace, NTooltip } from 'naive-ui';

const props = withDefaults(defineProps<{ modelValue: string; placeholder?: string; minRows?: number }>(), { placeholder: '输入内容', minRows: 6 });
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const mode = ref<'markdown' | 'rich'>('rich');
const markdown = ref(htmlToMarkdown(props.modelValue));
const editorRef = ref<HTMLDivElement | null>(null);
const preview = ref(false);
const imageUrl = ref('');
const linkUrl = ref('');
const richTools = [
  { label: '加粗', command: 'bold', icon: TextOutline }, { label: '斜体', command: 'italic', icon: TextOutline },
  { label: '无序列表', command: 'insertUnorderedList', icon: ListOutline },
  { label: '代码', command: 'formatBlock', icon: CodeSlashOutline }
];
const renderedContent = computed(() => renderContent(mode.value === 'markdown' ? markdown.value : props.modelValue));

watch(() => props.modelValue, (value) => {
  if (mode.value === 'markdown' && value !== markdown.value) markdown.value = value;
  if (mode.value === 'rich' && editorRef.value && value !== editorRef.value.innerHTML) editorRef.value.innerHTML = sanitizeHtml(value);
});
onMounted(() => { if (editorRef.value) editorRef.value.innerHTML = sanitizeHtml(mode.value === 'rich' ? props.modelValue : markdownToHtml(markdown.value)); });

function changeMode(next: 'markdown' | 'rich') {
  if (next === 'rich') {
    const html = markdownToHtml(markdown.value);
    emit('update:modelValue', html);
    nextTick(() => { if (editorRef.value) editorRef.value.innerHTML = html; });
  } else {
    markdown.value = htmlToMarkdown(props.modelValue);
    emit('update:modelValue', markdown.value);
  }
}
function emitMarkdown(value: string) { markdown.value = value; emit('update:modelValue', value); }
function emitRich() { if (editorRef.value) emit('update:modelValue', sanitizeHtml(editorRef.value.innerHTML)); }
function runCommand(command: string) {
  editorRef.value?.focus();
  if (command === 'formatBlock') document.execCommand(command, false, 'pre');
  else document.execCommand(command, false);
  emitRich();
}
function insertLink() { const url = linkUrl.value.trim(); if (!url) return; editorRef.value?.focus(); document.execCommand('createLink', false, url); linkUrl.value = ''; emitRich(); }
function insertImage() { const url = imageUrl.value.trim(); if (!url) return; editorRef.value?.focus(); document.execCommand('insertImage', false, url); imageUrl.value = ''; emitRich(); }
function handlePaste(event: ClipboardEvent) { event.preventDefault(); const text = event.clipboardData?.getData('text/plain') || ''; document.execCommand('insertText', false, text); emitRich(); }

function looksLikeHtml(value: string) { return /<\/?[a-z][\s\S]*>/i.test(value); }
function markdownToHtml(value: string) { return sanitizeHtml(marked.parse(value, { gfm: true, breaks: true }) as string); }
function renderContent(value: string) { return sanitizeHtml(looksLikeHtml(value) ? value : marked.parse(value, { gfm: true, breaks: true }) as string); }
function sanitizeHtml(value: string) { return DOMPurify.sanitize(value, { ADD_ATTR: ['target'], ALLOW_UNKNOWN_PROTOCOLS: false }); }
function htmlToMarkdown(value: string) {
  const text = value.replace(/<br\s*\/?>/gi, '\n').replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**').replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**').replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*').replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*').replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)').replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, '![]($1)').replace(/<\/?p[^>]*>/gi, '\n').replace(/<\/?div[^>]*>/gi, '\n').replace(/<[^>]+>/g, '');
  const holder = document.createElement('textarea'); holder.innerHTML = text; return holder.value.replace(/\n{3,}/g, '\n\n').trim();
}
</script>

<style scoped>
.content-editor { display: grid; width: 100%; min-width: 0; gap: 10px; }
.editor-toolbar { min-height: 32px; }
.content-editor :deep(.n-input) { width: 100%; }
.rich-editor { width: 100%; min-height: 190px; padding: 12px; color: #344054; line-height: 1.75; border: 1px solid rgb(224, 224, 230); border-radius: 6px; outline: none; transition: border-color .2s ease, box-shadow .2s ease; }
.rich-editor:focus { border-color: #1677ff; box-shadow: 0 0 0 2px rgba(22, 119, 255, .12); }
.rich-editor :deep(img), .content-preview :deep(img) { display: block; max-width: 100%; height: auto; margin: 12px 0; border-radius: 4px; }
.content-preview { min-height: 120px; padding: 14px; color: #344054; line-height: 1.8; background: #fafcff; border: 1px dashed #d0d5dd; border-radius: 6px; }
.content-preview :deep(pre) { overflow: auto; padding: 12px; background: #f2f4f7; border-radius: 4px; }
.content-preview :deep(blockquote) { margin: 12px 0; padding-left: 12px; color: #667085; border-left: 3px solid #91caff; }
</style>
