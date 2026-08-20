<template>
  <main class="content-wrap">
    <div class="page-title">
      <div>
        <h1>议题</h1>
        <p v-if="siteConfig.siteDescription" class="page-subtitle">{{ siteConfig.siteDescription }}</p>
      </div>
      <n-button v-if="session.canCreateIssue" type="primary" @click="router.push('/issues/new')">
        <template #icon>
          <n-icon><CreateOutline /></n-icon>
        </template>
        创建议题
      </n-button>
      <n-button v-else-if="!session.viewer" secondary @click="session.loginWithNatayarkId">登录以创建议题</n-button>
    </div>

    <n-space vertical size="large">
      <n-alert v-if="siteConfig.siteNotice" type="info" :bordered="false">{{ siteConfig.siteNotice }}</n-alert>
      <n-tabs v-model:value="statusKey" type="line" animated @update:value="handleStatusChange">
        <n-tab-pane v-for="tab in statusTabs" :key="tab.key" :name="tab.key">
          <template #tab>
            <n-space :size="6" align="center" :wrap="false">
              <n-icon :color="tab.color"><component :is="tab.icon" /></n-icon>
              <span>{{ tab.label }}</span>
            </n-space>
          </template>
        </n-tab-pane>
      </n-tabs>

      <n-input v-model:value="q" size="large" clearable placeholder="搜索议题..." @keyup.enter="load">
        <template #prefix>
          <n-icon color="#8da0bd"><SearchOutline /></n-icon>
        </template>
      </n-input>

      <n-card :bordered="true" content-style="padding: 0">
        <n-spin :show="loading">
          <n-empty v-if="issues.length === 0" class="empty-state" description="暂无可查看议题" />
          <n-list v-else hoverable clickable>
            <RouterLink v-for="issue in issues" :key="issue.number" class="issue-row" :to="`/issues/${issue.number}`">
              <n-list-item>
                <template #prefix>
                  <n-icon :size="24" :color="statusMeta(issue.status).color">
                    <component :is="statusMeta(issue.status).icon" />
                  </n-icon>
                </template>
                <n-thing>
                  <template #header>
                    <n-space align="center" :size="8">
                      <span class="issue-title">{{ issue.title }}</span>
                      <n-tag
                        v-for="label in issue.labels"
                        :key="label.id"
                        size="small"
                        round
                        :bordered="false"
                        :color="{ color: labelBg(label.color), textColor: label.color }"
                      >
                        {{ label.name }}
                      </n-tag>
                    </n-space>
                  </template>
                  <template #description>
                    <n-space :size="12" align="center" class="issue-meta">
                      <span>#{{ issue.number }}</span>
                      <span>{{ issue.createdByName || '系统' }}</span>
                      <span>{{ relativeTime(issue.updatedAt) }}</span>
                      <span v-if="issue.commentCount" class="meta-with-icon">
                        <n-icon><ChatbubbleOutline /></n-icon>
                        {{ issue.commentCount }}
                      </span>
                    </n-space>
                  </template>
                </n-thing>
                <template #suffix>
                  <n-tag size="small" :bordered="false">{{ visibilityText(issue.visibility) }}</n-tag>
                </template>
              </n-list-item>
            </RouterLink>
          </n-list>
        </n-spin>
      </n-card>
    </n-space>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  BanOutline,
  ChatbubbleOutline,
  CheckmarkCircleOutline,
  CreateOutline,
  ListOutline,
  RadioButtonOnOutline,
  SearchOutline,
  SyncOutline
} from '@vicons/ionicons5';
import { NAlert, NButton, NCard, NEmpty, NIcon, NInput, NList, NListItem, NSpace, NSpin, NTabPane, NTabs, NTag, NThing } from 'naive-ui';
import { apiGet } from '../api';
import { useSessionStore } from '../stores/session';

interface IssueRow {
  number: number;
  title: string;
  status: string;
  visibility: string;
  commentCount: number;
  voteCount: number;
  updatedAt: string;
  createdByName: string;
  labels: Array<{ id: number; name: string; color: string }>;
}

const router = useRouter();
const session = useSessionStore();
const issues = ref<IssueRow[]>([]);
const loading = ref(false);
const q = ref('');
const statusKey = ref('all');
const siteConfig = ref({ siteDescription: '', siteNotice: '' });

const statusTabs = [
  { key: 'all', label: '全部', value: null, icon: ListOutline, color: '#344054' },
  { key: 'open', label: '开放', value: 'open', icon: RadioButtonOnOutline, color: '#12b76a' },
  { key: 'voting', label: '投票中', value: 'voting', icon: SyncOutline, color: '#f79009' },
  { key: 'closed', label: '已关闭', value: 'closed', icon: CheckmarkCircleOutline, color: '#7a5af8' },
  { key: 'archived', label: '归档', value: 'archived', icon: BanOutline, color: '#667085' }
];

const activeStatus = computed(() => statusTabs.find((tab) => tab.key === statusKey.value)?.value || null);

function handleStatusChange() {
  load();
}

async function load() {
  loading.value = true;
  try {
    const params = new URLSearchParams();
    if (q.value) params.set('q', q.value);
    if (activeStatus.value) params.set('status', activeStatus.value);
    issues.value = await apiGet<IssueRow[]>(`/issues?${params}`);
  } finally {
    loading.value = false;
  }
}

async function loadSiteConfig() {
  try { siteConfig.value = await apiGet<{ siteDescription: string; siteNotice: string }>('/site-config'); } catch { /* Optional public site configuration. */ }
}

function statusMeta(value: string) {
  return statusTabs.find((tab) => tab.value === value) || statusTabs[1];
}

function visibilityText(value: string) {
  return { public: '公开', login: '登录可见', groups: '群组可见' }[value] || value;
}

function labelBg(color: string) {
  const normalized = color || '#1677ff';
  return `${normalized}1f`;
}

function relativeTime(value: string) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)}小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)}天前`;
  return '上个月';
}

watch(() => session.viewer?.id, () => load());
onMounted(() => { load(); loadSiteConfig(); });
</script>

<style scoped>
.issue-row {
  display: block;
}

.issue-title {
  color: #101828;
  font-weight: 600;
}

.issue-meta {
  color: #667085;
}

.meta-with-icon {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.empty-state {
  padding: 48px 0;
}

@media (max-width: 640px) {
  :deep(.n-tabs-tab) {
    padding-right: 10px;
    padding-left: 10px;
  }
}
</style>
