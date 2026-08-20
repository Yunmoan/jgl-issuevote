<template>
  <main class="content-wrap">
    <div class="page-title">
      <div>
        <h1>议题</h1>
        <div class="muted">按权限展示可查看议题，群组议题不会对无权限用户泄露标题。</div>
      </div>
      <n-button v-if="session.canCreateIssue" type="primary" @click="router.push('/issues/new')">创建议题</n-button>
    </div>

    <n-space align="center" class="filters">
      <n-input v-model:value="q" clearable placeholder="搜索标题或正文" style="width: 260px" @keyup.enter="load" />
      <n-select v-model:value="status" clearable placeholder="状态" :options="statusOptions" style="width: 150px" />
      <n-button secondary @click="load">筛选</n-button>
    </n-space>

    <section class="panel">
      <n-spin :show="loading">
        <n-empty v-if="issues.length === 0" description="暂无可查看议题" />
        <RouterLink v-for="issue in issues" :key="issue.number" class="issue-row" :to="`/issues/${issue.number}`">
          <div>
            <h3>#{{ issue.number }} {{ issue.title }}</h3>
            <div class="tag-line">
              <n-tag size="small" :type="statusType(issue.status)">{{ statusText(issue.status) }}</n-tag>
              <n-tag size="small" :bordered="false">{{ visibilityText(issue.visibility) }}</n-tag>
              <n-tag v-for="label in issue.labels" :key="label.id" size="small" :color="{ color: label.color, textColor: '#fff' }">{{ label.name }}</n-tag>
            </div>
          </div>
          <div class="muted">评论 {{ issue.commentCount }} · 投票 {{ issue.voteCount }}</div>
        </RouterLink>
      </n-spin>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NEmpty, NInput, NSelect, NSpace, NSpin, NTag } from 'naive-ui';
import { apiGet } from '../api';
import { useSessionStore } from '../stores/session';

interface IssueRow {
  number: number;
  title: string;
  status: string;
  visibility: string;
  commentCount: number;
  voteCount: number;
  labels: Array<{ id: number; name: string; color: string }>;
}

const router = useRouter();
const session = useSessionStore();
const issues = ref<IssueRow[]>([]);
const loading = ref(false);
const q = ref('');
const status = ref<string | null>(null);

const statusOptions = [
  { label: '开放', value: 'open' },
  { label: '投票中', value: 'voting' },
  { label: '已关闭', value: 'closed' },
  { label: '已归档', value: 'archived' }
];

async function load() {
  loading.value = true;
  try {
    const params = new URLSearchParams();
    if (q.value) params.set('q', q.value);
    if (status.value) params.set('status', status.value);
    issues.value = await apiGet<IssueRow[]>(`/issues?${params}`);
  } finally {
    loading.value = false;
  }
}

function statusText(value: string) {
  return { open: '开放', voting: '投票中', closed: '已关闭', archived: '已归档', draft: '草稿' }[value] || value;
}

function statusType(value: string) {
  return value === 'closed' ? 'default' : value === 'voting' ? 'info' : 'success';
}

function visibilityText(value: string) {
  return { public: '公开', login: '登录可见', groups: '群组可见' }[value] || value;
}

watch(() => session.viewer?.id, () => load());
onMounted(load);
</script>

<style scoped>
.filters {
  margin-bottom: 14px;
}
</style>

