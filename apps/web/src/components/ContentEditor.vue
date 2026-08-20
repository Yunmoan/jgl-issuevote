<template>
  <div class="content-editor">
    <n-space class="editor-toolbar" :size="4" :wrap="true" align="center">
      <n-radio-group key="editor-mode" v-model:value="mode" size="small" @update:value="changeMode">
        <n-radio-button value="markdown">Markdown</n-radio-button>
        <n-radio-button value="rich">富文本</n-radio-button>
      </n-radio-group>
      <n-space v-if="mode === 'rich'" key="rich-tools" :size="4" align="center" :wrap="true">
        <n-divider vertical />
        <n-tooltip v-for="tool in richTools" :key="tool.command" trigger="hover"><template #trigger><n-button quaternary circle size="small" :aria-label="tool.label" @mousedown.prevent @click="runCommand(tool.command)"><template #icon><n-icon><component :is="tool.icon" /></n-icon></template></n-button></template>{{ tool.label }}</n-tooltip>
        <n-dropdown trigger="click" :options="blockOptions" @select="applyBlock">
          <n-tooltip trigger="hover"><template #trigger><n-button quaternary circle size="small" aria-label="段落样式" @mousedown.prevent><template #icon><n-icon><TextOutline /></n-icon></template></n-button></template>段落样式</n-tooltip>
        </n-dropdown>
        <n-popover trigger="click" placement="bottom-start">
          <template #trigger><n-tooltip trigger="hover"><template #trigger><n-button quaternary circle size="small" aria-label="文字颜色" @mousedown.prevent><template #icon><n-icon><ColorPaletteOutline /></n-icon></template></n-button></template>文字颜色</n-tooltip></template>
          <n-color-picker v-model:value="textColor" :show-alpha="false" class="editor-color-picker" @update:value="applyTextColor" />
        </n-popover>
        <n-popover trigger="click" placement="bottom-start">
          <template #trigger><n-tooltip trigger="hover"><template #trigger><n-button quaternary circle size="small" aria-label="插入链接"><template #icon><n-icon><LinkOutline /></n-icon></template></n-button></template>插入链接</n-tooltip></template>
          <n-space vertical :size="8" style="width: 280px"><n-input v-model:value="linkUrl" placeholder="链接 URL，例如 https://..." /><n-button type="primary" size="small" :disabled="!linkUrl.trim()" @click="insertLink">插入链接</n-button></n-space>
        </n-popover>
        <n-popover trigger="click" placement="bottom-start">
          <template #trigger><n-tooltip trigger="hover"><template #trigger><n-button quaternary circle size="small" aria-label="插入图片"><template #icon><n-icon><ImageOutline /></n-icon></template></n-button></template>插入图片</n-tooltip></template>
          <n-space vertical :size="8" style="width: 280px"><n-button type="primary" :loading="imageUploading" @mousedown.prevent @click="openImageUpload"><template #icon><n-icon><CloudUploadOutline /></n-icon></template>上传图片</n-button><n-text depth="3">支持 JPEG、PNG、GIF、WebP，最大 5MB。</n-text><n-divider>或使用图片链接</n-divider><n-input v-model:value="imageUrl" placeholder="图片 URL，例如 https://..." /><n-button size="small" :disabled="!imageUrl.trim()" @click="insertImage">插入链接图片</n-button><input ref="imageInputRef" class="image-file-input" type="file" accept="image/jpeg,image/png,image/gif,image/webp" @change="uploadImage" /></n-space>
        </n-popover>
      </n-space>
      <n-button key="editor-preview" quaternary size="small" @click="togglePreview"><template #icon><n-icon><EyeOutline /></n-icon></template>{{ preview ? '编辑' : '预览' }}</n-button>
    </n-space>

    <n-collapse-transition :show="!preview">
      <n-input v-if="mode === 'markdown'" v-model:value="markdown" type="textarea" :placeholder="placeholder" :autosize="{ minRows, maxRows: 24 }" @update:value="emitMarkdown" />
      <div v-else ref="editorRef" class="rich-editor" contenteditable="true" role="textbox" :aria-label="placeholder" @input="emitRich" @keyup="rememberSelection" @mouseup="rememberSelection" @paste="handlePaste" />
    </n-collapse-transition>
    <n-collapse-transition :show="preview"><div v-if="preview" class="content-preview" v-html="renderedContent" /></n-collapse-transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { CloudUploadOutline, ColorPaletteOutline, EyeOutline, ImageOutline, LinkOutline, ListOutline, TextOutline } from '@vicons/ionicons5';
import { NButton, NCollapseTransition, NColorPicker, NDivider, NDropdown, NIcon, NInput, NPopover, NRadioButton, NRadioGroup, NSpace, NText, NTooltip, useMessage } from 'naive-ui';
import { apiUploadImage, assetUrl } from '../api';

const props = withDefaults(defineProps<{ modelValue: string; placeholder?: string; minRows?: number }>(), { placeholder: '输入内容', minRows: 6 });
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const mode = ref<'markdown' | 'rich'>('rich');
const message = useMessage();
const markdown = ref(htmlToMarkdown(props.modelValue));
const editorRef = ref<HTMLDivElement | null>(null);
const imageInputRef = ref<HTMLInputElement | null>(null);
const preview = ref(false);
const imageUrl = ref('');
const imageUploading = ref(false);
const linkUrl = ref('');
const textColor = ref('#1677ff');
let selectedRange: Range | null = null;
const richTools = [
  { label: '加粗', command: 'bold', icon: TextOutline }, { label: '斜体', command: 'italic', icon: TextOutline },
  { label: '无序列表', command: 'insertUnorderedList', icon: ListOutline }
];
const blockOptions = [{ label: '子标题', key: 'h2' }, { label: '小标题', key: 'h3' }, { label: '正文', key: 'p' }, { label: '代码块', key: 'pre' }];
const renderedContent = computed(() => renderContent(mode.value === 'markdown' ? markdown.value : props.modelValue));

watch(() => props.modelValue, (value) => {
  if (mode.value === 'markdown' && value !== markdown.value) markdown.value = value;
  if (mode.value === 'rich' && editorRef.value && value !== editorRef.value.innerHTML) syncRichEditor(value);
});
watch(preview, async (isPreview) => { if (!isPreview && mode.value === 'rich') { await nextTick(); syncRichEditor(props.modelValue); } });
onMounted(() => syncRichEditor(mode.value === 'rich' ? props.modelValue : markdownToHtml(markdown.value)));

function changeMode(next: 'markdown' | 'rich') {
  if (next === 'rich') {
    const html = markdownToHtml(markdown.value);
    emit('update:modelValue', html);
    nextTick(() => syncRichEditor(html));
  } else {
    markdown.value = htmlToMarkdown(props.modelValue);
    emit('update:modelValue', markdown.value);
  }
}
function emitMarkdown(value: string) { markdown.value = value; emit('update:modelValue', value); }
function emitRich() { if (editorRef.value) emit('update:modelValue', sanitizeHtml(editorRef.value.innerHTML)); }
function togglePreview() { if (!preview.value && mode.value === 'rich') emitRich(); preview.value = !preview.value; }
function syncRichEditor(value: string) { if (editorRef.value) editorRef.value.innerHTML = sanitizeHtml(value); }
function restoreSelection() {
  const editor = editorRef.value;
  if (!editor) return false;
  editor.focus();
  if (!selectedRange) return true;
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(selectedRange);
  return true;
}
function rememberSelection() {
  const editor = editorRef.value;
  const selection = window.getSelection();
  if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) return;
  selectedRange = selection.getRangeAt(0).cloneRange();
}
function runCommand(command: string, value?: string) {
  if (!restoreSelection()) return;
  if (command === 'formatBlock') document.execCommand(command, false, value || 'p');
  else document.execCommand(command, false);
  emitRich();
}
function applyBlock(value: string) { runCommand('formatBlock', value); }
function applyTextColor(value: string) { if (!restoreSelection()) return; document.execCommand('foreColor', false, value); emitRich(); }
function insertLink() { const url = linkUrl.value.trim(); if (!url || !restoreSelection()) return; document.execCommand('createLink', false, url); linkUrl.value = ''; emitRich(); }
function insertImage() { const url = imageUrl.value.trim(); if (!url) return; insertImageUrl(url); imageUrl.value = ''; }
function insertImageUrl(url: string) { if (!restoreSelection()) return; document.execCommand('insertImage', false, url); emitRich(); }
function openImageUpload() { rememberSelection(); imageInputRef.value?.click(); }
async function uploadImage(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    message.error('仅支持 5MB 以内的 JPEG、PNG、GIF 或 WebP 图片');
    return;
  }
  imageUploading.value = true;
  try {
    const result = await apiUploadImage(file);
    insertImageUrl(assetUrl(result.path));
    message.success('图片已插入');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '图片上传失败');
  } finally {
    imageUploading.value = false;
  }
}
function handlePaste(event: ClipboardEvent) { event.preventDefault(); const text = event.clipboardData?.getData('text/plain') || ''; document.execCommand('insertText', false, text); emitRich(); }

function looksLikeHtml(value: string) { return /<\/?[a-z][\s\S]*>/i.test(value); }
function markdownToHtml(value: string) { return sanitizeHtml(marked.parse(value, { gfm: true, breaks: true }) as string); }
function renderContent(value: string) { return sanitizeHtml(looksLikeHtml(value) ? value : marked.parse(value, { gfm: true, breaks: true }) as string); }
function sanitizeHtml(value: string) { return DOMPurify.sanitize(value, { ADD_ATTR: ['target', 'style', 'color'], ALLOW_UNKNOWN_PROTOCOLS: false }); }
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
.editor-color-picker { width: 240px; }
.image-file-input { display: none; }
.rich-editor :deep(h2), .content-preview :deep(h2) { margin: 18px 0 10px; font-size: 20px; line-height: 1.4; }
.rich-editor :deep(h3), .content-preview :deep(h3) { margin: 16px 0 8px; font-size: 17px; line-height: 1.45; }
.content-preview :deep(pre) { overflow: auto; padding: 12px; background: #f2f4f7; border-radius: 4px; }
.content-preview :deep(blockquote) { margin: 12px 0; padding-left: 12px; color: #667085; border-left: 3px solid #91caff; }
</style>
