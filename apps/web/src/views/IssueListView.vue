<template>
  <main class="content-wrap">
    <div class="page-title">
      <div>
        <h1>议题</h1>
        <p v-if="siteConfig.siteDescription" class="page-subtitle">{{ siteConfig.siteDescription }}</p>
      </div>
      <div class="page-title-actions">
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button quaternary circle :loading="loading" aria-label="刷新议题列表" @click="load">
              <template #icon><n-icon><RefreshOutline /></n-icon></template>
            </n-button>
          </template>
          刷新议题列表
        </n-tooltip>
        <n-button v-if="session.canCreateIssue" type="primary" @click="router.push('/issues/new')">
          <template #icon>
            <n-icon><CreateOutline /></n-icon>
          </template>
          创建议题
        </n-button>
        <n-tooltip v-else-if="!session.viewer" :disabled="Boolean(session.providers?.natayarkid.enabled)">
          <template #trigger>
            <span class="login-to-create-trigger">
              <n-button secondary :disabled="!session.providers?.natayarkid.enabled" :loading="session.providers === null" @click="session.loginWithNatayarkId">登录以创建议题</n-button>
            </span>
          </template>
          {{ session.providers ? 'NatayarkID 登录未启用' : '正在读取登录配置' }}
        </n-tooltip>
      </div>
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
          <n-icon><SearchOutline /></n-icon>
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
                      <n-tag size="small" :type="statusTagType(issue.status)" :bordered="false">{{ statusText(issue.status) }}</n-tag>
                      <n-tag v-if="issue.outcome !== 'pending'" size="small" :type="outcomeTagType(issue.outcome)" :bordered="false">{{ outcomeText(issue.outcome) }}</n-tag>
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
  RefreshOutline,
  SearchOutline,
  SyncOutline
} from '@vicons/ionicons5';
import { NAlert, NButton, NCard, NEmpty, NIcon, NInput, NList, NListItem, NSpace, NSpin, NTabPane, NTabs, NTag, NThing, NTooltip } from 'naive-ui';
import { apiGet } from '../api';
import { useSessionStore } from '../stores/session';

interface IssueRow {
  number: number;
  title: string;
  status: string;
  visibility: string;
  votingEnabled: boolean;
  outcome: string;
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
  { key: 'open', label: '已开启', value: 'open', icon: RadioButtonOnOutline, color: '#12b76a' },
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

function statusText(value: string) {
  return { open: '开放讨论', voting: '投票中', closed: '已关闭', archived: '已归档' }[value] || value;
}

function statusTagType(value: string): 'success' | 'warning' | 'default' {
  return value === 'voting' ? 'warning' : value === 'open' ? 'success' : 'default';
}

function outcomeText(value: string) {
  return { passed: '已通过', rejected: '未通过', manual_required: '等待确认', not_applicable: '纯讨论' }[value] || value;
}

function outcomeTagType(value: string): 'success' | 'error' | 'warning' | 'default' {
  return { passed: 'success', rejected: 'error', manual_required: 'warning', not_applicable: 'default' }[value] as 'success' | 'error' | 'warning' | 'default' || 'default';
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
.login-to-create-trigger { display: inline-flex; }
</style>

<style scoped>
.issue-row {
  display: block;
}

.page-title-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.issue-title { color: inherit; font-weight: 600; }

.issue-meta { color: inherit; opacity: .72; }

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

@media (max-width: 480px) {
  .page-title-actions {
    align-self: flex-start;
  }
}
</style>
