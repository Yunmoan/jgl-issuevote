<template>
  <main class="content-wrap">
    <div class="page-title">
      <div><h1>议题预审</h1><p class="page-subtitle">待预审议题通过后才会进入正式议题列表。</p></div>
      <n-tooltip trigger="hover">
        <template #trigger><n-button quaternary circle :loading="loading" aria-label="刷新预审队列" @click="load"><template #icon><n-icon><RefreshOutline /></n-icon></template></n-button></template>
        刷新预审队列
      </n-tooltip>
    </div>

    <n-space vertical size="large">
      <n-alert type="info" :bordered="false">不能预审自己提交的议题。驳回时需要说明原因，作者修改后可重新提交。</n-alert>
      <n-input v-model:value="q" size="large" clearable placeholder="搜索待预审议题..." @keyup.enter="load">
        <template #prefix><n-icon color="#8da0bd"><SearchOutline /></n-icon></template>
      </n-input>
      <n-spin :show="loading">
        <n-empty v-if="items.length === 0" class="empty-state" description="没有待预审议题" />
        <section v-else class="review-list">
          <n-card v-for="item in items" :key="item.number" size="small" class="review-item">
            <template #header><n-space align="center" :size="8"><span class="review-title">{{ item.title }}</span><n-tag size="small" type="warning" :bordered="false">待预审</n-tag></n-space></template>
            <template #header-extra><n-space :size="6"><n-tag v-for="label in item.labels" :key="label.id" size="small" :bordered="false">{{ label.name }}</n-tag></n-space></template>
            <n-space vertical :size="12">
              <n-space class="review-meta" :size="12" :wrap="true"><span>#{{ item.number }}</span><span>{{ item.createdByName }}</span><span>{{ formatTime(item.createdAt) }}</span><span>{{ item.votingEnabled ? '启用投票' : '纯讨论' }}</span></n-space>
              <div class="review-body rendered-content" v-html="renderContent(item.bodyMd)" />
              <n-space justify="end" :wrap="true">
                <n-button secondary @click="router.push(`/issues/${item.number}`)">查看详情</n-button>
                <template v-if="item.canReview">
                  <n-button type="error" secondary @click="openReview(item, 'reject')">驳回</n-button>
                  <n-button type="primary" @click="openReview(item, 'approve')">通过预审</n-button>
                </template>
                <n-text v-else depth="3">不能预审自己提交的议题</n-text>
              </n-space>
            </n-space>
          </n-card>
        </section>
      </n-spin>
    </n-space>

    <n-modal v-model:show="showReviewDialog" preset="card" :title="reviewDecision === 'approve' ? '通过预审' : '驳回议题'" :style="{ width: 'min(520px, calc(100vw - 24px))' }" :bordered="false">
      <n-space vertical size="large">
        <n-text v-if="reviewDecision === 'approve'">通过后，议题将进入正式列表并按其设置开放讨论或投票。</n-text>
        <n-form-item v-else label="驳回原因" required>
          <n-input v-model:value="reviewNote" type="textarea" :autosize="{ minRows: 3, maxRows: 7 }" maxlength="1000" show-count placeholder="说明需要补充或调整的内容" />
        </n-form-item>
      </n-space>
      <template #footer><n-space justify="end"><n-button @click="showReviewDialog = false">取消</n-button><n-button :type="reviewDecision === 'approve' ? 'primary' : 'error'" :loading="submitting" @click="submitReview">{{ reviewDecision === 'approve' ? '确认通过' : '确认驳回' }}</n-button></n-space></template>
    </n-modal>
  </main>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { RefreshOutline, SearchOutline } from '@vicons/ionicons5';
import { NAlert, NButton, NCard, NEmpty, NFormItem, NIcon, NInput, NModal, NSpace, NSpin, NTag, NText, NTooltip, useMessage } from 'naive-ui';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { apiGet, apiPost } from '../api';
import { useSessionStore } from '../stores/session';

interface ReviewItem {
  number: number;
  title: string;
  bodyMd: string;
  votingEnabled: boolean;
  createdByName: string;
  createdAt: string;
  canReview: boolean;
  labels: Array<{ id: number; name: string; color: string }>;
}

const router = useRouter();
const message = useMessage();
const session = useSessionStore();
const items = ref<ReviewItem[]>([]);
const loading = ref(false);
const submitting = ref(false);
const q = ref('');
const selected = ref<ReviewItem | null>(null);
const reviewDecision = ref<'approve' | 'reject'>('approve');
const reviewNote = ref('');
const showReviewDialog = ref(false);

async function load() {
  if (!session.canReviewIssueSubmissions) {
    items.value = [];
    return;
  }
  loading.value = true;
  try {
    const params = new URLSearchParams();
    if (q.value.trim()) params.set('q', q.value.trim());
    items.value = await apiGet<ReviewItem[]>(`/issues/reviews?${params}`);
  } catch (error) {
    message.error(error instanceof Error ? `读取预审队列失败：${error.message}` : '读取预审队列失败');
  } finally {
    loading.value = false;
  }
}

function openReview(item: ReviewItem, decision: 'approve' | 'reject') {
  selected.value = item;
  reviewDecision.value = decision;
  reviewNote.value = '';
  showReviewDialog.value = true;
}

async function submitReview() {
  if (!selected.value) return;
  const note = reviewNote.value.trim();
  if (reviewDecision.value === 'reject' && !note) {
    message.error('请填写驳回原因');
    return;
  }
  submitting.value = true;
  try {
    await apiPost(`/issues/${selected.value.number}/review`, { decision: reviewDecision.value, note: note || undefined });
    message.success(reviewDecision.value === 'approve' ? '已通过预审' : '已驳回议题');
    showReviewDialog.value = false;
    await load();
  } catch (error) {
    message.error(error instanceof Error ? `预审操作失败：${error.message}` : '预审操作失败');
  } finally {
    submitting.value = false;
  }
}

function renderContent(value: string) {
  const html = /<\/?[a-z][\s\S]*>/i.test(value) ? value : marked.parse(value, { gfm: true, breaks: true }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

watch(() => session.viewer?.id, () => { void load(); }, { immediate: true });
</script>

<style scoped>
.review-list { display: grid; gap: 12px; }
.review-item { border-radius: 6px; }
.review-title { color: #101828; font-weight: 600; }
.review-meta { color: #667085; font-size: 13px; }
.review-body { max-height: 240px; overflow: auto; color: #344054; }
.empty-state { padding: 48px 0; }
</style>
