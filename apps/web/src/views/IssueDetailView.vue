<template>
  <main class="content-wrap">
    <n-spin :show="loading">
      <n-result v-if="errorMessage" status="403" title="暂时无法查看此议题" :description="errorMessage">
        <template #footer><n-button @click="router.push('/')">返回议题列表</n-button></template>
      </n-result>
      <template v-if="detail">
        <div class="page-title">
          <div>
            <n-space align="center" :size="8" class="issue-heading">
              <n-tag :bordered="false" type="info">#{{ detail.issue.number }}</n-tag>
              <h1>{{ detail.issue.title }}</h1>
            </n-space>
            <n-space class="issue-tags" :size="6">
              <n-tag :type="detail.issue.status === 'closed' ? 'default' : 'success'">{{ statusText(detail.issue.status) }}</n-tag>
              <n-tag :bordered="false">{{ visibilityText(detail.issue.visibility) }}</n-tag>
              <n-tag v-for="label in detail.issue.labels" :key="label.id" :color="{ color: `${label.color}1a`, textColor: label.color }">{{ label.name }}</n-tag>
            </n-space>
          </div>
          <n-button v-if="detail.viewer.canEdit && detail.issue.status !== 'archived'" :type="detail.issue.status === 'closed' ? 'primary' : 'default'" secondary @click="confirmIssueStatus">
            <template #icon><n-icon><component :is="detail.issue.status === 'closed' ? RefreshOutline : LockClosedOutline" /></n-icon></template>{{ detail.issue.status === 'closed' ? '重新开启' : '关闭议题' }}
          </n-button>
        </div>

        <div class="detail-grid">
          <section class="detail-main">
            <n-card title="议题说明" size="large">
              <div class="markdown-body rendered-content" v-html="renderContent(detail.issue.bodyMd)" />
            </n-card>

            <n-card title="投票" size="small" class="vote-card">
              <template #header-extra><n-icon color="#1677ff"><BarChartOutline /></n-icon></template>
              <n-alert v-if="!detail.viewer.canVote" type="info" :bordered="false">当前账号没有投票权限，或不在投票时间内。</n-alert>
              <template v-else>
                <n-radio-group v-model:value="choice" class="vote-options" size="medium">
                  <n-radio-button value="agree">同意</n-radio-button><n-radio-button value="disagree">不同意</n-radio-button><n-radio-button value="abstain">弃权</n-radio-button>
                </n-radio-group>
                <n-button type="primary" :disabled="!choice" @click="submitVote">{{ detail.myVote ? '更新投票' : '提交投票' }}</n-button>
              </template>
              <span v-if="detail.myVote" class="vote-note">我的选择：{{ voteText(detail.myVote.choice) }}</span>
              <n-divider />
              <n-grid v-if="detail.voteSummary.visible" :cols="3" :x-gap="8">
                <n-gi><n-statistic label="同意" :value="detail.voteSummary.agree" /></n-gi>
                <n-gi><n-statistic label="反对" :value="detail.voteSummary.disagree" /></n-gi>
                <n-gi><n-statistic label="弃权" :value="detail.voteSummary.abstain" /></n-gi>
              </n-grid>
              <n-text v-else depth="3">投票统计将在设定时间或关闭后公布。</n-text>
            </n-card>

            <n-card class="comments-card" title="意见" size="large">
              <template #header-extra><n-badge :value="comments.length" :max="99" /></template>
              <n-empty v-if="comments.length === 0" description="暂无已公开意见" size="small" class="empty-comments" />
              <n-list v-else :show-divider="true">
                <n-list-item v-for="comment in comments" :key="comment.id">
                  <template #prefix><n-avatar round :size="32">{{ comment.author.displayName.slice(0, 1) }}</n-avatar></template>
                  <n-thing>
                    <template #header><n-text strong>{{ comment.author.displayName }}</n-text></template>
                    <template #header-extra><n-space :size="8" align="center"><n-text depth="3" class="comment-time">{{ formatTime(comment.createdAt) }}</n-text><n-tag v-if="!comment.published" size="small" type="warning">待统一公布</n-tag></n-space></template>
                    <div class="comment-content rendered-content" v-html="renderContent(comment.bodyMd)" />
                  </n-thing>
                </n-list-item>
              </n-list>
              <n-divider v-if="detail.viewer.canComment" />
              <n-form v-if="detail.viewer.canComment" class="comment-form" @submit.prevent="submitComment">
                <n-form-item label="发表意见" :show-feedback="false"><ContentEditor v-model="commentBody" :min-rows="4" placeholder="写下你对该议题的意见，支持 Markdown、图片与基本富文本。" /></n-form-item>
                <n-space justify="end"><n-button type="primary" :disabled="!hasContent(commentBody)" @click="submitComment"><template #icon><n-icon><SendOutline /></n-icon></template>提交意见</n-button></n-space>
              </n-form>
              <n-alert v-else type="info" :bordered="false">登录并具备权限后可发表意见。</n-alert>
            </n-card>
          </section>

          <aside class="side-stack">
            <n-card title="议题信息" size="small">
              <n-descriptions label-placement="left" :column="2" size="small" bordered>
                <n-descriptions-item label="创建人">{{ detail.issue.createdByName }}</n-descriptions-item>
                <n-descriptions-item label="意见公布">{{ detail.issue.commentPublishAt ? formatTime(detail.issue.commentPublishAt) : '即时公布' }}</n-descriptions-item>
                <n-descriptions-item label="查看权限">{{ groupNames(detail.issue.viewGroups) || '按可见性' }}</n-descriptions-item>
                <n-descriptions-item label="投票权限">{{ groupNames(detail.issue.voteGroups) || '可见用户' }}</n-descriptions-item>
              </n-descriptions>
            </n-card>
          </aside>
        </div>
      </template>
    </n-spin>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { BarChartOutline, LockClosedOutline, RefreshOutline, SendOutline } from '@vicons/ionicons5';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { NAlert, NAvatar, NBadge, NButton, NCard, NDescriptions, NDescriptionsItem, NDivider, NEmpty, NForm, NFormItem, NGi, NGrid, NIcon, NList, NListItem, NRadioButton, NRadioGroup, NResult, NSpace, NSpin, NStatistic, NTag, NText, NThing, useDialog, useMessage } from 'naive-ui';
import { apiGet, apiPost } from '../api';
import ContentEditor from '../components/ContentEditor.vue';

const route = useRoute();
const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const detail = ref<any>(null);
const comments = ref<any[]>([]);
const choice = ref<string | null>(null);
const commentBody = ref('');
const errorMessage = ref('');

async function load() { loading.value = true; errorMessage.value = ''; try { detail.value = await apiGet(`/issues/${route.params.number}`); comments.value = await apiGet(`/issues/${route.params.number}/comments`); choice.value = detail.value.myVote?.choice || null; } catch (error) { detail.value = null; errorMessage.value = error instanceof Error ? error.message : '议题不存在或当前账号没有查看权限。'; } finally { loading.value = false; } }
async function submitVote() { if (!choice.value) return; detail.value = await apiPost(`/issues/${route.params.number}/vote`, { choice: choice.value }); choice.value = detail.value.myVote?.choice || choice.value; message.success('投票已提交'); }
async function submitComment() { await apiPost(`/issues/${route.params.number}/comments`, { bodyMd: commentBody.value }); commentBody.value = ''; comments.value = await apiGet(`/issues/${route.params.number}/comments`); message.success('意见已提交'); }
function confirmIssueStatus() {
  const reopening = detail.value.issue.status === 'closed';
  dialog.warning({
    title: reopening ? '重新开启议题' : '关闭议题',
    content: reopening ? '重新开启后，符合权限的成员可继续讨论和投票。' : '关闭后将停止投票，结果会按议题规则公布。',
    positiveText: reopening ? '确认重新开启' : '确认关闭',
    negativeText: '取消',
    onPositiveClick: () => updateIssueStatus(reopening)
  });
}
async function updateIssueStatus(reopening: boolean) { try { detail.value = await apiPost(`/issues/${route.params.number}/${reopening ? 'reopen' : 'close'}`); message.success(reopening ? '议题已重新开启' : '议题已关闭'); } catch (error) { message.error(error instanceof Error ? error.message : '操作失败'); return false; } }
function hasContent(value: string) { return value.replace(/<[^>]+>/g, '').trim().length > 0; }
function renderContent(value: string) { const html = /<\/?[a-z][\s\S]*>/i.test(value) ? value : marked.parse(value, { gfm: true, breaks: true }) as string; return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] }); }
function statusText(value: string) { return { open: '开放', voting: '投票中', closed: '已关闭', archived: '已归档', draft: '草稿' }[value] || value; }
function visibilityText(value: string) { return { public: '公开可见', login: '登录可见', groups: '群组可见' }[value] || value; }
function voteText(value: string) { return { agree: '同意', disagree: '不同意', abstain: '弃权' }[value] || value; }
function groupNames(groups: Array<{ name: string }> = []) { return groups.map((group) => group.name).join('、'); }
function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }); }
onMounted(load);
</script>

<style scoped>
.issue-heading h1 { font-size: 28px; }
.issue-tags { margin-top: 12px; }
.detail-main { display: grid; gap: 20px; }
.comments-card { margin-top: 0; }
.comment-content { margin-top: 6px; color: #344054; line-height: 1.75; white-space: pre-wrap; }
.comment-time { white-space: nowrap; font-size: 13px; }
.comment-form { display: grid; gap: 4px; }
.empty-comments { padding: 28px 0; }
.vote-options { display: grid; grid-template-columns: repeat(3, 1fr); margin-bottom: 12px; }
.vote-card { margin: 0; }
.vote-note { display: inline-block; margin: 12px 0 0; color: #667085; font-size: 13px; }
.rendered-content :deep(img) { display: block; max-width: 100%; height: auto; margin: 12px 0; border-radius: 4px; }
.rendered-content :deep(pre) { overflow: auto; padding: 12px; background: #f2f4f7; border-radius: 4px; }
.rendered-content :deep(blockquote) { margin: 12px 0; padding-left: 12px; color: #667085; border-left: 3px solid #91caff; }
@media (max-width: 820px) { .issue-heading h1 { font-size: 24px; } }
</style>
