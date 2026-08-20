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
              <n-tag :type="detail.issue.status === 'closed' ? 'default' : 'success'">{{ statusText(detail.issue.status)
                }}</n-tag>
              <n-tag :bordered="false">{{ visibilityText(detail.issue.visibility) }}</n-tag>
              <n-tag v-for="label in detail.issue.labels" :key="label.id"
                :color="{ color: `${label.color}1a`, textColor: label.color }">{{ label.name }}</n-tag>
            </n-space>
            <n-text v-if="detail.issue.contentEditedAt" depth="3" class="edited-note">已编辑 {{
              formatTime(detail.issue.contentEditedAt) }}</n-text>
          </div>
          <n-space :size="8"><n-button v-if="detail.viewer.canEdit && detail.issue.status !== 'archived'" tertiary
              @click="showEditor = true"><template #icon><n-icon>
                  <CreateOutline />
                </n-icon></template>编辑</n-button><n-button
              v-if="detail.viewer.canEdit && detail.issue.status !== 'archived'"
              :type="detail.issue.status === 'closed' ? 'primary' : 'default'" secondary
              @click="confirmIssueStatus"><template #icon><n-icon>
                  <component :is="detail.issue.status === 'closed' ? RefreshOutline : LockClosedOutline" />
                </n-icon></template>{{
                  detail.issue.status === 'closed' ? '重新开启' : '关闭议题' }}</n-button><n-button
              v-if="detail.viewer.canModerate && detail.issue.status === 'closed'" type="warning" secondary
              @click="confirmArchive"><template #icon><n-icon>
                  <ArchiveOutline />
                </n-icon></template>归档</n-button></n-space>
        </div>

        <div class="detail-grid">
          <section class="detail-main">
            <n-card title="议题说明" size="large">
              <div class="markdown-body rendered-content" v-html="renderContent(detail.issue.bodyMd)" />
            </n-card>

            <n-card title="表决/投票" size="small" class="vote-card">
              <template #header-extra><n-space><n-text>{{ detail.myVote ? '您已表决' : '尚未表决' }}</n-text><n-tag v-if="detail.myVote" size="small" type="info"
                  :bordered="false">{{ voteText(detail.myVote.choice) }}</n-tag><n-icon v-else color="#1677ff">
                  <BarChartOutline />
                </n-icon></n-space></template>
              <n-alert v-if="!detail.viewer.canVote" type="info" :bordered="false">当前账号没有投票权限，或不在投票时间内。</n-alert>
              <template v-else>
                <n-radio-group v-model:value="choice" class="vote-choice-group">
                  <n-radio-button value="agree"><n-space align="center" :size="6"><n-icon color="#12b76a">
                        <CheckmarkCircleOutline />
                      </n-icon><span>同意</span></n-space></n-radio-button>
                  <n-radio-button value="disagree"><n-space align="center" :size="6"><n-icon color="#f04438">
                        <CloseCircleOutline />
                      </n-icon><span>不同意</span></n-space></n-radio-button>
                  <n-radio-button value="abstain"><n-space align="center" :size="6"><n-icon color="#667085">
                        <RemoveCircleOutline />
                      </n-icon><span>弃权/不参与</span></n-space></n-radio-button>
                </n-radio-group>
                <n-space class="vote-submit" align="center" :size="12"><n-button type="primary" :disabled="!canSubmitVote"
                    @click="submitVote">{{ detail.myVote ? '更新投票' : '提交投票' }}</n-button><n-text v-if="voteHint"
                    depth="3">{{ voteHint }}</n-text></n-space>
              </template>
              <n-divider />
              <n-grid v-if="detail.voteSummary.visible" :cols="3" :x-gap="8">
                <n-gi><n-statistic label="同意" :value="detail.voteSummary.agree" /></n-gi>
                <n-gi><n-statistic label="反对" :value="detail.voteSummary.disagree" /></n-gi>
                <n-gi><n-statistic label="弃权/不参与" :value="detail.voteSummary.abstain" /></n-gi>
              </n-grid>
              <n-text v-else depth="3">投票统计将在设定时间或关闭后公布。</n-text>
            </n-card>

            <n-card class="comments-card" title="意见" size="large">
              <template #header-extra><n-badge :value="comments.length" :max="99" /></template>
              <n-empty v-if="comments.length === 0" description="暂无已公开意见" size="small" class="empty-comments" />
              <n-list v-else :show-divider="true">
                <n-list-item v-for="comment in comments" :key="comment.id">
                  <template #prefix><n-avatar round :size="32" :src="comment.author.avatarUrl || undefined">{{
                    comment.author.displayName.slice(0, 1) }}</n-avatar></template>
                  <n-thing>
                    <template #header><n-text strong>{{ comment.author.displayName }}</n-text></template>
                    <template #header-extra><n-space :size="6" align="center" class="comment-meta"><n-text depth="3" class="comment-time">{{
                      formatTime(comment.createdAt) }}</n-text><n-text v-if="comment.editedAt" depth="3" class="comment-time">已编辑 {{ formatTime(comment.editedAt) }}</n-text><n-tag v-if="!comment.published" size="small"
                          type="warning">待统一公布</n-tag><n-tooltip v-if="comment.viewerCanEdit"><template #trigger><n-button text circle size="small" aria-label="编辑意见" @click="startCommentEdit(comment)"><template #icon><n-icon><CreateOutline /></n-icon></template></n-button></template>编辑意见</n-tooltip></n-space></template>
                    <template v-if="editingCommentId === comment.id">
                      <ContentEditor v-model="editingCommentBody" :min-rows="4" />
                      <n-space justify="end" class="comment-edit-actions"><n-button size="small" @click="cancelCommentEdit">取消</n-button><n-button size="small" type="primary" :loading="savingComment" :disabled="!hasContent(editingCommentBody)" @click="saveCommentEdit(comment.id)">保存</n-button></n-space>
                    </template>
                    <div v-else class="comment-content rendered-content" v-html="renderContent(comment.bodyMd)" />
                  </n-thing>
                </n-list-item>
              </n-list>
              <n-divider v-if="detail.viewer.canComment" />
              <n-form v-if="detail.viewer.canComment" class="comment-form" @submit.prevent="submitComment">
                <n-form-item label="发表意见" :show-feedback="false">
                  <ContentEditor v-model="commentBody" :min-rows="4" placeholder="写下你对该议题的意见，支持 Markdown、图片与基本富文本。" />
                </n-form-item>
                <n-space justify="space-between" align="center"><n-text depth="3">还可发表 {{ detail.viewer.commentRemaining }} 次意见</n-text><n-button type="primary" :disabled="!hasContent(commentBody)"
                    @click="submitComment"><template #icon><n-icon>
                        <SendOutline />
                      </n-icon></template>提交意见</n-button></n-space>
              </n-form>
              <n-alert v-else type="info" :bordered="false">{{ commentDisabledText }}</n-alert>
            </n-card>
          </section>

          <aside class="side-stack">
            <n-card title="议题信息" size="small">
              <n-descriptions label-placement="left" :column="1" size="small" bordered>
                <n-descriptions-item label="创建人">{{ detail.issue.createdByName }}</n-descriptions-item>
                <n-descriptions-item label="意见公布">{{ detail.issue.commentPublishAt ?
                  formatTime(detail.issue.commentPublishAt) :
                  '即时公布' }}</n-descriptions-item>
                <n-descriptions-item label="发布时间">{{ formatTime(detail.issue.createdAt) }}</n-descriptions-item>
                <n-descriptions-item label="意见截止">{{ detail.issue.commentEndsAt ? formatTime(detail.issue.commentEndsAt)
                  : '未设置'
                  }}</n-descriptions-item>
                <n-descriptions-item label="意见上限">每人 {{ detail.issue.maxCommentsPerUser }} 次</n-descriptions-item>
                <n-descriptions-item label="最后更新">{{ formatTime(detail.issue.updatedAt) }}</n-descriptions-item>
                <n-descriptions-item label="查看权限">{{ groupNames(detail.issue.viewGroups) || '按可见性'
                  }}</n-descriptions-item>
                <n-descriptions-item label="投票权限">{{ groupNames(detail.issue.voteGroups) || '可见用户'
                  }}</n-descriptions-item>
                <n-descriptions-item label="改票上限">{{ detail.issue.allowVoteChange ? `每人 ${detail.issue.maxVoteChanges} 次` : '不允许' }}</n-descriptions-item>
              </n-descriptions>
            </n-card>
          </aside>
        </div>
      </template>
    </n-spin>
    <n-modal v-model:show="showEditor" preset="card" title="编辑议题" :style="{ width: 'min(900px, calc(100vw - 24px))' }"
      :bordered="false"><n-form label-placement="top"><n-form-item label="议题标题"><n-input
            v-model:value="editTitle" /></n-form-item><n-form-item label="议题说明">
          <ContentEditor v-model="editBody" :min-rows="8" />
        </n-form-item></n-form><template #footer><n-space justify="end"><n-button
            @click="showEditor = false">取消</n-button><n-button type="primary" :loading="savingEdit"
            @click="saveEdit">保存修改</n-button></n-space></template></n-modal>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArchiveOutline, BarChartOutline, CheckmarkCircleOutline, CloseCircleOutline, CreateOutline, LockClosedOutline, RefreshOutline, RemoveCircleOutline, SendOutline } from '@vicons/ionicons5';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { NAlert, NAvatar, NBadge, NButton, NCard, NDescriptions, NDescriptionsItem, NDivider, NEmpty, NForm, NFormItem, NGi, NGrid, NIcon, NInput, NList, NListItem, NModal, NRadioButton, NRadioGroup, NResult, NSpace, NSpin, NStatistic, NTag, NText, NThing, NTooltip, useDialog, useMessage } from 'naive-ui';
import { apiGet, apiPost, apiPut } from '../api';
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
const showEditor = ref(false); const savingEdit = ref(false); const editTitle = ref(''); const editBody = ref('');
const editingCommentId = ref<string | null>(null); const editingCommentBody = ref(''); const savingComment = ref(false);
const canSubmitVote = computed(() => Boolean(choice.value) && Boolean(detail.value?.viewer.canVote) && (!detail.value?.myVote || (detail.value.issue.allowVoteChange && detail.value.myVote.changeCount < detail.value.issue.maxVoteChanges)));
const voteHint = computed(() => {
  if (!detail.value?.viewer.canVote) return '';
  if (!choice.value) return '请选择一个投票选项。';
  if (!detail.value.myVote) return `提交后还可修改 ${detail.value.issue.maxVoteChanges} 次。`;
  const remaining = Math.max(detail.value.issue.maxVoteChanges - detail.value.myVote.changeCount, 0);
  return detail.value.issue.allowVoteChange ? (remaining ? `本次修改后还可修改 ${remaining - 1} 次。` : '已达到修改投票上限。') : '该议题不允许修改投票。';
});
const commentDisabledText = computed(() => {
  if (!detail.value) return '';
  if (detail.value.viewer.commentCount >= detail.value.issue.maxCommentsPerUser) return `每位成员最多可发表 ${detail.value.issue.maxCommentsPerUser} 条意见。`;
  return '登录并具备权限后可发表意见。';
});

async function load() { loading.value = true; errorMessage.value = ''; try { detail.value = await apiGet(`/issues/${route.params.number}`); comments.value = await apiGet(`/issues/${route.params.number}/comments`); choice.value = null; editTitle.value = detail.value.issue.title; editBody.value = detail.value.issue.bodyMd; } catch (error) { detail.value = null; errorMessage.value = error instanceof Error ? error.message : '议题不存在或当前账号没有查看权限。'; } finally { loading.value = false; } }
async function submitVote() { if (!choice.value) return; detail.value = await apiPost(`/issues/${route.params.number}/vote`, { choice: choice.value }); choice.value = null; message.success('投票已提交'); }
async function submitComment() { await apiPost(`/issues/${route.params.number}/comments`, { bodyMd: commentBody.value }); commentBody.value = ''; comments.value = await apiGet(`/issues/${route.params.number}/comments`); message.success('意见已提交'); }
function startCommentEdit(comment: any) { editingCommentId.value = comment.id; editingCommentBody.value = comment.bodyMd; }
function cancelCommentEdit() { editingCommentId.value = null; editingCommentBody.value = ''; }
async function saveCommentEdit(commentId: string) { if (!hasContent(editingCommentBody.value)) return; savingComment.value = true; try { await apiPut(`/issues/${route.params.number}/comments/${commentId}`, { bodyMd: editingCommentBody.value }); await load(); cancelCommentEdit(); message.success('意见已保存'); } finally { savingComment.value = false; } }
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
function confirmArchive() { dialog.warning({ title: '归档议题', content: '归档后议题将停止讨论和投票，且不可重新开启。', positiveText: '确认归档', negativeText: '取消', onPositiveClick: async () => { try { detail.value = await apiPost(`/issues/${route.params.number}/archive`); message.success('议题已归档'); } catch (error) { message.error(error instanceof Error ? error.message : '归档失败'); return false; } } }); }
async function saveEdit() { if (!editTitle.value.trim() || !hasContent(editBody.value)) return; savingEdit.value = true; try { const issue = detail.value.issue; detail.value = await apiPut(`/issues/${route.params.number}`, { title: editTitle.value, bodyMd: editBody.value, visibility: issue.visibility, viewGroupKeys: issue.viewGroups.map((group: any) => group.groupKey), voteGroupKeys: issue.voteGroups.map((group: any) => group.groupKey), labelIds: issue.labels.map((label: any) => label.id), commentPublishAt: issue.commentPublishAt ? new Date(issue.commentPublishAt).toISOString() : null, commentEndsAt: issue.commentEndsAt ? new Date(issue.commentEndsAt).toISOString() : null, voteStartsAt: issue.voteStartsAt ? new Date(issue.voteStartsAt).toISOString() : null, voteEndsAt: issue.voteEndsAt ? new Date(issue.voteEndsAt).toISOString() : null, voteVisibility: issue.voteVisibility, allowVoteChange: issue.allowVoteChange, maxVoteChanges: issue.maxVoteChanges, maxCommentsPerUser: issue.maxCommentsPerUser, quorumCount: issue.quorumCount, passRule: issue.passRule }); showEditor.value = false; message.success('议题已保存'); } finally { savingEdit.value = false; } }
function hasContent(value: string) { return value.replace(/<[^>]+>/g, '').trim().length > 0; }
function renderContent(value: string) { const html = /<\/?[a-z][\s\S]*>/i.test(value) ? value : marked.parse(value, { gfm: true, breaks: true }) as string; return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] }); }
function statusText(value: string) { return { open: '开放', voting: '投票中', closed: '已关闭', archived: '已归档', draft: '草稿' }[value] || value; }
function visibilityText(value: string) { return { public: '公开可见', login: '登录可见', groups: '群组可见' }[value] || value; }
function voteText(value: string) { return { agree: '同意', disagree: '不同意', abstain: '弃权/不参与' }[value] || value; }
function groupNames(groups: Array<{ name: string }> = []) { return groups.map((group) => group.name).join('、'); }
function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }); }
onMounted(load);
</script>

<style scoped>
.issue-heading h1 {
  font-size: 28px;
}

.issue-tags {
  margin-top: 12px;
}

.edited-note {
  display: inline-block;
  margin-top: 8px;
  font-size: 13px;
}

.detail-main {
  display: grid;
  gap: 20px;
}

.comments-card {
  margin-top: 0;
}

.comment-content {
  margin-top: 6px;
  color: #344054;
  line-height: 1.75;
  white-space: pre-wrap;
}

.comment-time {
  white-space: nowrap;
  font-size: 13px;
}

.comment-form {
  display: grid;
  gap: 4px;
}

.comment-meta {
  justify-content: flex-end;
}

.comment-edit-actions {
  margin-top: 10px;
}

.empty-comments {
  padding: 28px 0;
}

.vote-choice-group {
  display: flex;
  width: 100%;
  margin-bottom: 12px;
}

.vote-choice-group :deep(.n-radio-button) {
  flex: 1;
  text-align: center;
}

.vote-submit {
  min-height: 34px;
}

.vote-card {
  margin: 0;
}

.rendered-content :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 12px 0;
  border-radius: 4px;
}

.rendered-content :deep(pre) {
  overflow: auto;
  padding: 12px;
  background: #f2f4f7;
  border-radius: 4px;
}

.rendered-content :deep(blockquote) {
  margin: 12px 0;
  padding-left: 12px;
  color: #667085;
  border-left: 3px solid #91caff;
}

@media (max-width: 820px) {
  .issue-heading h1 {
    font-size: 24px;
  }
}
</style>
