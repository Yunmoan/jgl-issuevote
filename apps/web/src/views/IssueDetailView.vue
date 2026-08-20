<template>
  <main class="content-wrap">
    <n-spin :show="loading">
      <template v-if="detail">
        <div class="page-title">
          <div>
            <h1>#{{ detail.issue.number }} {{ detail.issue.title }}</h1>
            <div class="tag-line">
              <n-tag :type="detail.issue.status === 'closed' ? 'default' : 'success'">{{ statusText(detail.issue.status) }}</n-tag>
              <n-tag :bordered="false">{{ visibilityText(detail.issue.visibility) }}</n-tag>
              <n-tag v-for="label in detail.issue.labels" :key="label.id" :color="{ color: label.color, textColor: '#fff' }">{{ label.name }}</n-tag>
            </div>
          </div>
          <n-button v-if="detail.viewer.canEdit && detail.issue.status !== 'closed'" secondary @click="closeIssue">关闭议题</n-button>
        </div>

        <div class="detail-grid">
          <section>
            <article class="panel markdown-body">{{ detail.issue.bodyMd }}</article>

            <section class="panel comments-panel">
              <h2>意见</h2>
              <div v-if="comments.length === 0" class="muted">暂无已公开意见。</div>
              <article v-for="comment in comments" :key="comment.id" class="comment">
                <div class="comment-head">
                  <strong>{{ comment.author.displayName }}</strong>
                  <n-tag v-if="!comment.published" size="small" type="warning">待统一公布</n-tag>
                </div>
                <div class="markdown-body">{{ comment.bodyMd }}</div>
              </article>
              <n-form v-if="detail.viewer.canComment" class="comment-form" @submit.prevent="submitComment">
                <n-input v-model:value="commentBody" type="textarea" placeholder="发表自己的意见" :autosize="{ minRows: 3, maxRows: 8 }" />
                <n-button type="primary" :disabled="!commentBody.trim()" @click="submitComment">提交意见</n-button>
              </n-form>
            </section>
          </section>

          <aside class="side-stack">
            <section class="panel">
              <h2>投票</h2>
              <div v-if="!detail.viewer.canVote" class="muted">当前账号没有投票权限，或不在投票时间内。</div>
              <template v-else>
                <n-radio-group v-model:value="choice" class="vote-options">
                  <n-radio-button value="agree">同意</n-radio-button>
                  <n-radio-button value="disagree">不同意</n-radio-button>
                  <n-radio-button value="abstain">弃权</n-radio-button>
                </n-radio-group>
                <n-button type="primary" block :disabled="!choice" @click="submitVote">
                  {{ detail.myVote ? '更新投票' : '提交投票' }}
                </n-button>
              </template>
              <div v-if="detail.myVote" class="muted vote-note">我的投票：{{ voteText(detail.myVote.choice) }}</div>
              <n-divider />
              <template v-if="detail.voteSummary.visible">
                <n-statistic label="同意" :value="detail.voteSummary.agree" />
                <n-statistic label="不同意" :value="detail.voteSummary.disagree" />
                <n-statistic label="弃权" :value="detail.voteSummary.abstain" />
              </template>
              <div v-else class="muted">投票统计将在设定时间或关闭后公布。</div>
            </section>

            <section class="panel meta">
              <h2>议题信息</h2>
              <p><span>创建人</span><strong>{{ detail.issue.createdByName }}</strong></p>
              <p><span>评论公布</span><strong>{{ detail.issue.commentPublishAt ? formatTime(detail.issue.commentPublishAt) : '即时' }}</strong></p>
              <p><span>查看组</span><strong>{{ groupNames(detail.issue.viewGroups) || '按可见性' }}</strong></p>
              <p><span>投票组</span><strong>{{ groupNames(detail.issue.voteGroups) || '可见用户' }}</strong></p>
            </section>
          </aside>
        </div>
      </template>
    </n-spin>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { NButton, NDivider, NForm, NInput, NRadioButton, NRadioGroup, NSpin, NStatistic, NTag, useMessage } from 'naive-ui';
import { apiGet, apiPost, apiPut } from '../api';

const route = useRoute();
const message = useMessage();
const loading = ref(false);
const detail = ref<any>(null);
const comments = ref<any[]>([]);
const choice = ref<string | null>(null);
const commentBody = ref('');

async function load() {
  loading.value = true;
  try {
    detail.value = await apiGet(`/issues/${route.params.number}`);
    comments.value = await apiGet(`/issues/${route.params.number}/comments`);
    choice.value = detail.value.myVote?.choice || null;
  } finally {
    loading.value = false;
  }
}

async function submitVote() {
  if (!choice.value) return;
  detail.value = await apiPut(`/issues/${route.params.number}/vote`, { choice: choice.value });
  choice.value = detail.value.myVote?.choice || choice.value;
  message.success('投票已提交');
}

async function submitComment() {
  await apiPost(`/issues/${route.params.number}/comments`, { bodyMd: commentBody.value });
  commentBody.value = '';
  comments.value = await apiGet(`/issues/${route.params.number}/comments`);
  message.success('意见已提交');
}

async function closeIssue() {
  detail.value = await apiPost(`/issues/${route.params.number}/close`);
  message.success('议题已关闭');
}

function statusText(value: string) {
  return { open: '开放', voting: '投票中', closed: '已关闭', archived: '已归档', draft: '草稿' }[value] || value;
}

function visibilityText(value: string) {
  return { public: '公开', login: '登录可见', groups: '群组可见' }[value] || value;
}

function voteText(value: string) {
  return { agree: '同意', disagree: '不同意', abstain: '弃权' }[value] || value;
}

function groupNames(groups: Array<{ name: string }>) {
  return groups.map((group) => group.name).join('、');
}

function formatTime(value: string) {
  return new Date(value).toLocaleString();
}

onMounted(load);
</script>

<style scoped>
h2 {
  margin: 0 0 14px;
  font-size: 16px;
}

.comments-panel {
  margin-top: 18px;
}

.comment-form {
  display: grid;
  gap: 10px;
  margin-top: 16px;
}

.side-stack {
  display: grid;
  align-content: start;
  gap: 14px;
}

.vote-options {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin-bottom: 12px;
}

.vote-note {
  margin-top: 10px;
}

.meta p {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin: 10px 0;
}
</style>

