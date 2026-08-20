<template>
  <main class="content-wrap">
    <n-spin :show="loading">
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
          <n-button v-if="detail.viewer.canEdit && detail.issue.status !== 'closed'" secondary @click="closeIssue">
            <template #icon><n-icon><LockClosedOutline /></n-icon></template>关闭议题
          </n-button>
        </div>

        <div class="detail-grid">
          <section class="detail-main">
            <n-card title="议题说明" size="large">
              <div class="markdown-body">{{ detail.issue.bodyMd }}</div>
            </n-card>

            <n-card class="comments-card" title="意见" size="large">
              <template #header-extra><n-badge :value="comments.length" :max="99" /></template>
              <n-empty v-if="comments.length === 0" description="暂无已公开意见" size="small" class="empty-comments" />
              <n-list v-else :show-divider="true">
                <n-list-item v-for="comment in comments" :key="comment.id">
                  <n-thing :title="comment.author.displayName">
                    <template #description>
                      <n-space :size="8"><span>{{ formatTime(comment.createdAt) }}</span><n-tag v-if="!comment.published" size="small" type="warning">待统一公布</n-tag></n-space>
                    </template>
                    <div class="comment-content">{{ comment.bodyMd }}</div>
                  </n-thing>
                </n-list-item>
              </n-list>
              <n-divider v-if="detail.viewer.canComment" />
              <n-form v-if="detail.viewer.canComment" class="comment-form" @submit.prevent="submitComment">
                <n-form-item label="发表意见" :show-feedback="false">
                  <n-input v-model:value="commentBody" type="textarea" placeholder="写下你对该议题的意见" :autosize="{ minRows: 3, maxRows: 8 }" />
                </n-form-item>
                <n-space justify="end"><n-button type="primary" :disabled="!commentBody.trim()" @click="submitComment"><template #icon><n-icon><SendOutline /></n-icon></template>提交意见</n-button></n-space>
              </n-form>
              <n-alert v-else type="info" :bordered="false">登录并具备权限后可发表意见。</n-alert>
            </n-card>
          </section>

          <aside class="side-stack">
            <n-card title="投票" size="small">
              <template #header-extra><n-icon color="#1677ff"><BarChartOutline /></n-icon></template>
              <n-alert v-if="!detail.viewer.canVote" type="info" :bordered="false">当前账号没有投票权限，或不在投票时间内。</n-alert>
              <template v-else>
                <n-radio-group v-model:value="choice" class="vote-options" size="medium">
                  <n-radio-button value="agree">同意</n-radio-button><n-radio-button value="disagree">不同意</n-radio-button><n-radio-button value="abstain">弃权</n-radio-button>
                </n-radio-group>
                <n-button type="primary" block :disabled="!choice" @click="submitVote">{{ detail.myVote ? '更新投票' : '提交投票' }}</n-button>
              </template>
              <p v-if="detail.myVote" class="vote-note">我的选择：{{ voteText(detail.myVote.choice) }}</p>
              <n-divider />
              <n-grid v-if="detail.voteSummary.visible" :cols="3" :x-gap="8">
                <n-gi><n-statistic label="同意" :value="detail.voteSummary.agree" /></n-gi>
                <n-gi><n-statistic label="反对" :value="detail.voteSummary.disagree" /></n-gi>
                <n-gi><n-statistic label="弃权" :value="detail.voteSummary.abstain" /></n-gi>
              </n-grid>
              <n-text v-else depth="3">投票统计将在设定时间或关闭后公布。</n-text>
            </n-card>

            <n-card title="议题信息" size="small">
              <n-descriptions label-placement="top" :column="1" size="small" bordered>
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
import { useRoute } from 'vue-router';
import { BarChartOutline, LockClosedOutline, SendOutline } from '@vicons/ionicons5';
import { NAlert, NBadge, NButton, NCard, NDescriptions, NDescriptionsItem, NDivider, NEmpty, NForm, NFormItem, NGi, NGrid, NIcon, NInput, NList, NListItem, NRadioButton, NRadioGroup, NSpace, NSpin, NStatistic, NTag, NText, NThing, useMessage } from 'naive-ui';
import { apiGet, apiPost } from '../api';

const route = useRoute();
const message = useMessage();
const loading = ref(false);
const detail = ref<any>(null);
const comments = ref<any[]>([]);
const choice = ref<string | null>(null);
const commentBody = ref('');

async function load() { loading.value = true; try { detail.value = await apiGet(`/issues/${route.params.number}`); comments.value = await apiGet(`/issues/${route.params.number}/comments`); choice.value = detail.value.myVote?.choice || null; } finally { loading.value = false; } }
async function submitVote() { if (!choice.value) return; detail.value = await apiPost(`/issues/${route.params.number}/vote`, { choice: choice.value }); choice.value = detail.value.myVote?.choice || choice.value; message.success('投票已提交'); }
async function submitComment() { await apiPost(`/issues/${route.params.number}/comments`, { bodyMd: commentBody.value }); commentBody.value = ''; comments.value = await apiGet(`/issues/${route.params.number}/comments`); message.success('意见已提交'); }
async function closeIssue() { detail.value = await apiPost(`/issues/${route.params.number}/close`); message.success('议题已关闭'); }
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
.comment-content { margin-top: 10px; color: #344054; line-height: 1.75; white-space: pre-wrap; }
.comment-form { display: grid; gap: 4px; }
.empty-comments { padding: 28px 0; }
.vote-options { display: grid; grid-template-columns: repeat(3, 1fr); margin-bottom: 12px; }
.vote-note { margin: 12px 0 0; color: #667085; font-size: 13px; }
@media (max-width: 820px) { .issue-heading h1 { font-size: 24px; } }
</style>
