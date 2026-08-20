<template>
  <main class="content-wrap">
    <n-spin :show="loading">
      <n-result v-if="errorMessage" status="403" title="暂时无法查看此议题" :description="`发生系统错误，请向管理员反馈： ${errorMessage}`">
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
              <n-tag :type="issueStatusTagType(detail.issue.status)">{{ statusText(detail.issue.status)
                }}</n-tag>
              <n-tag v-if="detail.issue.outcome !== 'pending'" :type="outcomeTagType(detail.issue.outcome)" :bordered="false">{{ outcomeText(detail.issue.outcome) }}</n-tag>
              <n-tag :bordered="false">{{ visibilityText(detail.issue.visibility) }}</n-tag>
              <n-tag v-if="detail.issue.commentAnonymous" type="warning" :bordered="false">意见匿名</n-tag>
              <n-tag v-for="label in detail.issue.labels" :key="label.id"
                :color="{ color: `${label.color}1a`, textColor: label.color }">{{ label.name }}</n-tag>
            </n-space>
            <n-text v-if="detail.issue.contentEditedAt" depth="3" class="edited-note">已编辑 {{
              formatTime(detail.issue.contentEditedAt) }}</n-text>
          </div>
          <n-space :size="8"><n-button v-if="detail.viewer.canEdit && detail.issue.status !== 'archived'" key="edit" tertiary
              @click="openEditor"><template #icon><n-icon>
                  <CreateOutline />
                </n-icon></template>编辑</n-button><n-button v-if="detail.viewer.canStartVoting" key="start-voting" type="primary" secondary @click="openStartVoting"><template #icon><n-icon><PlayCircleOutline /></n-icon></template>开始投票</n-button><n-button
              key="close"
              v-if="detail.viewer.canEdit && ['open', 'voting'].includes(detail.issue.status)"
              :type="detail.issue.status === 'closed' ? 'primary' : 'default'" secondary
              @click="confirmIssueStatus"><template #icon><n-icon>
                  <component :is="detail.issue.status === 'closed' ? RefreshOutline : LockClosedOutline" />
                </n-icon></template>{{
                  detail.issue.status === 'closed' ? '重新开启' : detail.issue.status === 'voting' ? '结束投票' : '关闭议题' }}</n-button><n-button key="reopen"
              v-if="detail.viewer.canEdit && detail.issue.status === 'closed'" type="primary" secondary @click="confirmIssueStatus"><template #icon><n-icon><RefreshOutline /></n-icon></template>重新开启</n-button><n-button
              key="confirm-outcome"
              v-if="detail.viewer.canConfirmOutcome" type="warning" secondary @click="confirmOutcome"><template #icon><n-icon><CheckmarkCircleOutline /></n-icon></template>确认结果</n-button><n-button
              key="archive"
              v-if="detail.viewer.canModerate && detail.issue.status === 'closed'" type="warning" secondary
              @click="confirmArchive"><template #icon><n-icon>
                  <ArchiveOutline />
                </n-icon></template>归档</n-button></n-space>
        </div>
        <n-alert v-if="detail.issue.status === 'pending_review'" type="warning" :bordered="false">该议题正在等待预审，暂不会出现在正式议题列表。</n-alert>
        <n-alert v-else-if="detail.issue.status === 'review_rejected'" type="error" :bordered="false">预审未通过：{{ detail.issue.reviewNote || '未填写原因' }}。修改后保存即可重新提交预审。</n-alert>

        <div class="detail-grid">
          <section class="detail-main">
            <n-card title="议题说明" size="large">
              <div class="markdown-body rendered-content" v-html="renderContent(detail.issue.bodyMd)" />
            </n-card>

            <n-card :title="detail.issue.votingEnabled ? '表决/投票' : '讨论设置'" size="small" class="vote-card">
              <template v-if="detail.issue.votingEnabled" #header-extra><n-space align="center" :size="8"><n-text>{{ detail.myVote ? '您已表决' : '尚未表决' }}</n-text><n-tag v-if="detail.myVote" size="small" :type="voteTagType(detail.myVote.choice)"
                  :bordered="false">{{ voteText(detail.myVote.choice) }}</n-tag><n-icon v-else color="#1677ff"><BarChartOutline /></n-icon></n-space></template>
              <template v-if="!detail.issue.votingEnabled"><n-alert type="info" :bordered="false">本议题未启用投票器，仅开放讨论。</n-alert></template>
              <template v-else>
              <n-alert v-if="detail.issue.passRule === 'custom'" type="info" :bordered="false" class="custom-rule">自定义通过规则：{{ detail.issue.customPassRule }}</n-alert>
              <n-alert v-if="!detail.viewer.canVote" type="info" :bordered="false">{{ voteDisabledText }}</n-alert>
              <template v-else>
                <n-radio-group v-model:value="choice" :disabled="voteChangeBlocked" class="vote-choice-group">
                  <n-radio-button value="agree"><n-space align="center" :size="6"><n-icon color="#12b76a">
                        <CheckmarkCircleOutline />
                      </n-icon><span>同意</span></n-space></n-radio-button>
                  <n-radio-button value="disagree"><n-space align="center" :size="6"><n-icon color="#f04438">
                        <CloseCircleOutline />
                      </n-icon><span>不同意</span></n-space></n-radio-button>
                  <n-radio-button value="abstain"><n-space align="center" :size="6"><n-icon color="#667085">
                        <RemoveCircleOutline />
                      </n-icon><span>弃权</span></n-space></n-radio-button>
                </n-radio-group>
                <n-space class="vote-submit" align="center" :size="12"><n-button type="primary" :disabled="!canSubmitVote"
                    @click="submitVote">{{ detail.myVote ? '重新投票' : '提交投票' }}</n-button><n-text v-if="voteHint"
                    depth="3">{{ voteHint }}</n-text></n-space>
              </template>
              <n-divider />
              <n-grid v-if="detail.voteSummary.visible" :cols="3" :x-gap="8">
                <n-gi><n-statistic label="同意" :value="detail.voteSummary.agree" /></n-gi>
                <n-gi><n-statistic label="反对" :value="detail.voteSummary.disagree" /></n-gi>
                <n-gi><n-statistic label="弃权" :value="detail.voteSummary.abstain" /></n-gi>
              </n-grid>
              <n-text v-else depth="3">投票统计将在设定时间或关闭后公布。</n-text>
              </template>
            </n-card>

            <n-card class="comments-card" title="意见" size="large">
              <template #header-extra><n-badge :value="comments.length" :max="99" :show-zero="true" /></template>
              <n-empty v-if="comments.length === 0" description="暂无已公开意见" size="small" class="empty-comments" />
              <n-list v-else :show-divider="true" class="comment-list">
                <n-list-item v-for="comment in comments" :key="comment.id" class="comment-item">
                  <template #prefix><n-avatar round :size="32" :src="comment.author.avatarUrl || undefined">{{
                    comment.author.displayName.slice(0, 1) }}</n-avatar></template>
                  <n-thing>
                    <template #header><n-space align="center" :size="8"><n-text strong>{{ comment.author.displayName }}</n-text><n-tag v-if="!comment.published" size="small" type="warning" :bordered="false">待统一公布</n-tag></n-space></template>
                    <template #header-extra><n-tooltip v-if="comment.viewerCanEdit"><template #trigger><n-button text circle size="small" aria-label="编辑意见" @click="startCommentEdit(comment)"><template #icon><n-icon><CreateOutline /></n-icon></template></n-button></template>编辑意见</n-tooltip></template>
                    <template v-if="editingCommentId === comment.id">
                      <ContentEditor v-model="editingCommentBody" :min-rows="4" />
                      <n-space justify="end" class="comment-edit-actions"><n-button size="small" @click="cancelCommentEdit">取消</n-button><n-button size="small" type="primary" :loading="savingComment" :disabled="!hasContent(editingCommentBody)" @click="saveCommentEdit(comment.id)">保存</n-button></n-space>
                    </template>
                    <template v-else>
                      <div class="comment-content rendered-content" v-html="renderContent(comment.bodyMd)" />
                      <n-list v-if="comment.replies.length" class="reply-list" :show-divider="false">
                        <n-list-item v-for="reply in comment.replies" :key="reply.id" class="reply-item">
                          <template #prefix><n-avatar round :size="24" :src="reply.author.avatarUrl || undefined">{{ reply.author.displayName.slice(0, 1) }}</n-avatar></template>
                          <n-thing>
                            <template #header><n-text strong>{{ reply.author.displayName }}</n-text></template>
                            <template #header-extra><n-space :size="2"><n-tooltip v-if="reply.viewerCanDelete"><template #trigger><n-button text circle size="small" aria-label="删除回复" @click="confirmDeleteReply(comment, reply)"><template #icon><n-icon><TrashOutline /></n-icon></template></n-button></template>删除回复</n-tooltip><n-tooltip v-if="reply.viewerCanModerate"><template #trigger><n-button text circle size="small" type="warning" aria-label="屏蔽回复" @click="confirmHideReply(comment, reply)"><template #icon><n-icon><EyeOffOutline /></n-icon></template></n-button></template>屏蔽回复</n-tooltip></n-space></template>
                            <div class="reply-content rendered-content" v-html="renderContent(reply.bodyMd)" />
                            <n-space justify="end" class="reply-time"><n-text depth="3" class="comment-time">{{ formatTime(reply.createdAt) }}</n-text></n-space>
                          </n-thing>
                        </n-list-item>
                      </n-list>
                      <div v-if="replyingCommentId === comment.id" class="reply-form"><n-input v-model:value="replyBody" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" placeholder="回复这条意见" /><n-space justify="end" :size="8"><n-button size="small" @click="cancelReply">取消</n-button><n-button size="small" type="primary" :loading="submittingReply" :disabled="!hasContent(replyBody)" @click="submitReply(comment.id)">发送回复</n-button></n-space></div>
                      <div class="comment-footer">
                      <n-space v-if="comment.published" class="reaction-bar" :size="6">
                        <n-tooltip><template #trigger><n-button size="small" secondary :type="reactionActive(comment, 'like') ? 'primary' : 'default'" :disabled="!comment.viewerCanReact" aria-label="点赞" @click="toggleReaction(comment, 'like')"><template #icon><n-icon><ThumbsUpOutline /></n-icon></template>{{ comment.reactionCounts.like || '' }}</n-button></template>点赞</n-tooltip>
                        <n-tooltip><template #trigger><n-button size="small" secondary :type="reactionActive(comment, 'yes') ? 'success' : 'default'" :disabled="!comment.viewerCanReact" aria-label="赞同" @click="toggleReaction(comment, 'yes')"><template #icon><n-icon><CheckmarkOutline /></n-icon></template>{{ comment.reactionCounts.yes || '' }}</n-button></template>赞同</n-tooltip>
                        <n-tooltip><template #trigger><n-button size="small" secondary :type="reactionActive(comment, 'no') ? 'error' : 'default'" :disabled="!comment.viewerCanReact" aria-label="反对" @click="toggleReaction(comment, 'no')"><template #icon><n-icon><CloseOutline /></n-icon></template>{{ comment.reactionCounts.no || '' }}</n-button></template>反对</n-tooltip>
                        <n-button v-if="comment.viewerCanReply" text size="small" @click="startReply(comment)"><template #icon><n-icon><ChatbubbleOutline /></n-icon></template>回复{{ comment.replies.length ? ` ${comment.replies.length}` : '' }}</n-button>
                      </n-space>
                      <n-space :size="8" class="comment-meta"><n-text depth="3" class="comment-time">{{ formatTime(comment.createdAt) }}</n-text><n-text v-if="comment.editedAt" depth="3" class="comment-time">已编辑 {{ formatTime(comment.editedAt) }}</n-text></n-space>
                      </div>
                    </template>
                  </n-thing>
                </n-list-item>
              </n-list>
              <n-divider v-if="detail.viewer.canComment" />
              <n-form v-if="detail.viewer.canComment" class="comment-form" @submit.prevent="submitComment">
                <n-space justify="space-between" align="center" class="comment-composer-heading"><n-text strong>发表意见</n-text><n-text depth="3">还可发表 {{ detail.viewer.commentRemaining }} 次</n-text></n-space>
                <n-form-item :show-feedback="false">
                  <ContentEditor v-model="commentBody" :min-rows="4" placeholder="写下你对该议题的意见，支持 Markdown、图片与基本富文本。" />
                </n-form-item>
                <n-space justify="end"><n-button type="primary" :disabled="!hasContent(commentBody)"
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
                <n-descriptions-item label="议题状态">{{ statusText(detail.issue.status) }}</n-descriptions-item>
                <n-descriptions-item v-if="detail.issue.reviewedAt" label="预审结果">{{ detail.issue.reviewedByName || '成员' }} · {{ formatTime(detail.issue.reviewedAt) }}</n-descriptions-item>
                <n-descriptions-item v-if="detail.issue.reviewNote" label="预审说明">{{ detail.issue.reviewNote }}</n-descriptions-item>
                <n-descriptions-item label="议题结果"><n-tag size="small" :type="outcomeTagType(detail.issue.outcome)" :bordered="false">{{ outcomeText(detail.issue.outcome) }}</n-tag></n-descriptions-item>
                <n-descriptions-item v-if="detail.issue.outcomeConfirmedAt" label="结果确认">{{ detail.issue.outcomeConfirmedByName || '管理员' }} · {{ formatTime(detail.issue.outcomeConfirmedAt) }}</n-descriptions-item>
                <n-descriptions-item label="投票器">{{ detail.issue.votingEnabled ? '已启用' : '未启用（纯讨论）' }}</n-descriptions-item>
                <template v-if="detail.issue.votingEnabled">
                  <n-descriptions-item label="投票开始">{{ detail.issue.voteStartsAt ? formatTime(detail.issue.voteStartsAt) : '由创建者手动开始' }}</n-descriptions-item>
                  <n-descriptions-item label="投票结束">{{ detail.issue.voteEndsAt ? formatTime(detail.issue.voteEndsAt) : '由创建者手动结束' }}</n-descriptions-item>
                  <n-descriptions-item label="结果可见">{{ voteVisibilityText(detail.issue.voteVisibility) }}</n-descriptions-item>
                  <n-descriptions-item label="通过规则">{{ passRuleText(detail.issue.passRule) }}</n-descriptions-item>
                  <n-descriptions-item v-if="detail.issue.passRule === 'custom'" label="规则说明">{{ detail.issue.customPassRule }}</n-descriptions-item>
                  <n-descriptions-item label="投票权限">{{ groupNames(detail.issue.voteGroups) || '所有可见用户' }}</n-descriptions-item>
                  <n-descriptions-item label="重投规则">{{ revotePolicy }}</n-descriptions-item>
                </template>
                <n-descriptions-item label="意见公布">{{ detail.issue.commentPublishAt ?
                  formatTime(detail.issue.commentPublishAt) :
                  '即时公布' }}</n-descriptions-item>
                <n-descriptions-item label="发布时间">{{ formatTime(detail.issue.createdAt) }}</n-descriptions-item>
                <n-descriptions-item label="意见截止">{{ detail.issue.commentEndsAt ? formatTime(detail.issue.commentEndsAt)
                  : '未设置'
                  }}</n-descriptions-item>
                <n-descriptions-item label="意见展示">{{ detail.issue.commentAnonymous ? '匿名展示意见与回复' : '显示成员身份' }}</n-descriptions-item>
                <n-descriptions-item label="意见上限">每人 {{ detail.issue.maxCommentsPerUser }} 次</n-descriptions-item>
                <n-descriptions-item label="最后更新">{{ formatTime(detail.issue.updatedAt) }}</n-descriptions-item>
                <n-descriptions-item label="查看权限">{{ groupNames(detail.issue.viewGroups) || '按可见性'
                  }}</n-descriptions-item>
              </n-descriptions>
            </n-card>
          </aside>
        </div>
      </template>
    </n-spin>
    <n-modal v-model:show="showEditor" preset="card" title="编辑议题" :style="{ width: 'min(900px, calc(100vw - 24px))' }" :bordered="false">
      <n-form label-placement="top">
        <n-form-item label="议题标题"><n-input v-model:value="editTitle" /></n-form-item>
        <n-form-item label="议题说明"><ContentEditor v-model="editBody" :min-rows="8" /></n-form-item>
        <n-grid :cols="2" :x-gap="16" responsive="screen" item-responsive>
          <n-gi span="2 720:1"><n-form-item label="可见范围"><n-select v-model:value="editVisibility" :options="visibilityOptions" /></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="查看权限组"><n-select v-model:value="editViewGroupKeys" multiple :options="groupOptions" :disabled="editVisibility !== 'groups'" /></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="分类"><n-select v-model:value="editLabelIds" multiple :options="labelOptions" /></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="意见统一公布时间"><n-date-picker v-model:value="editCommentPublishAt" type="datetime" clearable style="width: 100%" /></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="意见截止时间"><n-date-picker v-model:value="editCommentEndsAt" type="datetime" clearable style="width: 100%" :is-date-disabled="disableEditCommentEndDate" /></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="每人最多发表意见次数"><n-input-number v-model:value="editMaxCommentsPerUser" :min="1" :max="100" style="width: 100%" /></n-form-item></n-gi>
        </n-grid>
        <n-checkbox v-model:checked="editCommentAnonymous">意见与回复匿名展示</n-checkbox>
        <n-checkbox v-model:checked="editVotingEnabled">启用投票器</n-checkbox>
        <n-grid v-if="editVotingEnabled" :cols="2" :x-gap="16" responsive="screen" item-responsive class="edit-vote-grid">
          <n-gi span="2 720:1"><n-form-item label="投票权限组"><n-select v-model:value="editVoteGroupKeys" multiple :options="groupOptions" /></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="自动投票开始"><n-date-picker v-model:value="editVoteStartsAt" type="datetime" clearable style="width: 100%" /></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="自动投票结束"><n-date-picker v-model:value="editVoteEndsAt" type="datetime" clearable style="width: 100%" :is-date-disabled="disableEditVoteEndDate" /></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="结果可见性"><n-select v-model:value="editVoteVisibility" :options="voteVisibilityOptions" /></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="通过规则"><n-select v-model:value="editPassRule" :options="passRuleOptions" /></n-form-item></n-gi>
          <n-gi v-if="editPassRule === 'custom'" span="2"><n-form-item label="自定义通过规则"><n-input v-model:value="editCustomPassRule" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" maxlength="500" show-count /></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="每人最多重投次数"><n-input-number v-model:value="editMaxVoteChanges" :min="0" :max="100" :disabled="!editAllowVoteChange" style="width: 100%" /></n-form-item></n-gi>
        </n-grid>
        <n-checkbox v-if="editVotingEnabled" v-model:checked="editAllowVoteChange" class="edit-revote">投票结束前允许重新投票</n-checkbox>
      </n-form>
      <template #footer><n-space justify="end"><n-button @click="showEditor = false">取消</n-button><n-button type="primary" :loading="savingEdit" @click="saveEdit">保存修改</n-button></n-space></template>
    </n-modal>
    <n-modal v-model:show="showStartVotingDialog" preset="dialog" title="开始投票" positive-text="确认开始" negative-text="取消" @positive-click="startVoting" @negative-click="showStartVotingDialog = false">
      <n-form-item label="投票时长"><n-input-number v-model:value="manualVoteDurationMinutes" :min="1" :max="43200" style="width: 100%"><template #suffix>分钟</template></n-input-number></n-form-item>
    </n-modal>
    <n-modal v-model:show="showCloseDialog" preset="dialog" title="关闭议题" positive-text="确认关闭" negative-text="取消" @positive-click="closeIssue" @negative-click="showCloseDialog = false">
      <n-space vertical :size="12"><n-text>关闭后将停止讨论和投票。请选择关闭后的可见范围。</n-text><n-radio-group v-model:value="closeVisibility"><n-space vertical><n-radio value="retain">保持现有可见范围</n-radio><n-radio value="public">公开给所有访客</n-radio></n-space></n-radio-group></n-space>
    </n-modal>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArchiveOutline, BarChartOutline, ChatbubbleOutline, CheckmarkCircleOutline, CheckmarkOutline, CloseCircleOutline, CloseOutline, CreateOutline, EyeOffOutline, LockClosedOutline, PlayCircleOutline, RefreshOutline, RemoveCircleOutline, SendOutline, ThumbsUpOutline, TrashOutline } from '@vicons/ionicons5';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { NAlert, NAvatar, NBadge, NButton, NCard, NCheckbox, NDatePicker, NDescriptions, NDescriptionsItem, NDivider, NEmpty, NForm, NFormItem, NGi, NGrid, NIcon, NInput, NInputNumber, NList, NListItem, NModal, NRadio, NRadioButton, NRadioGroup, NResult, NSelect, NSpace, NSpin, NStatistic, NTag, NText, NThing, NTooltip, useDialog, useMessage } from 'naive-ui';
import { apiDelete, apiGet, apiPost, apiPut } from '../api';
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
const editVisibility = ref('login'); const editViewGroupKeys = ref<string[]>([]); const editVoteGroupKeys = ref<string[]>([]); const editLabelIds = ref<number[]>([]);
const editCommentPublishAt = ref<number | null>(null); const editCommentEndsAt = ref<number | null>(null); const editCommentAnonymous = ref(false); const editMaxCommentsPerUser = ref(3);
const editVotingEnabled = ref(true); const editVoteStartsAt = ref<number | null>(null); const editVoteEndsAt = ref<number | null>(null); const editVoteVisibility = ref('counts_after_close');
const editAllowVoteChange = ref(true); const editMaxVoteChanges = ref(1); const editPassRule = ref('simple_majority'); const editCustomPassRule = ref('');
const groupOptions = ref<Array<{ label: string; value: string }>>([]); const labelOptions = ref<Array<{ label: string; value: number }>>([]);
const showCloseDialog = ref(false); const closeVisibility = ref<'retain' | 'public'>('retain'); const closingIssue = ref(false);
const showStartVotingDialog = ref(false); const manualVoteDurationMinutes = ref(60);
const editingCommentId = ref<string | null>(null); const editingCommentBody = ref(''); const savingComment = ref(false);
const replyingCommentId = ref<string | null>(null); const replyBody = ref(''); const submittingReply = ref(false);
const voteChangeBlocked = computed(() => Boolean(detail.value?.myVote) && (!detail.value.issue.allowVoteChange || detail.value.issue.maxVoteChanges === 0 || detail.value.myVote.changeCount >= detail.value.issue.maxVoteChanges));
const canSubmitVote = computed(() => Boolean(choice.value) && Boolean(detail.value?.viewer.canVote) && !voteChangeBlocked.value);
const revotePolicy = computed(() => {
  if (!detail.value?.issue || !detail.value.issue.allowVoteChange || detail.value.issue.maxVoteChanges === 0) return '禁止修改投票';
  return `每人最多重投 ${detail.value.issue.maxVoteChanges} 次`;
});
const voteHint = computed(() => {
  if (!detail.value?.viewer.canVote) return '';
  if (voteChangeBlocked.value) return detail.value.issue.maxVoteChanges === 0 || !detail.value.issue.allowVoteChange ? '本议题禁止修改投票。' : '已达到重投次数上限。';
  if (!choice.value) return '请选择一个投票选项。';
  if (!detail.value.myVote) return detail.value.issue.maxVoteChanges === 0 ? '本议题禁止修改投票。' : `提交后还可重投 ${detail.value.issue.maxVoteChanges} 次。`;
  const remaining = Math.max(detail.value.issue.maxVoteChanges - detail.value.myVote.changeCount, 0);
  return remaining ? `本次重投后还可重投 ${remaining - 1} 次。` : '已达到重投次数上限。';
});
const commentDisabledText = computed(() => {
  if (!detail.value) return '';
  if (detail.value.viewer.commentCount >= detail.value.issue.maxCommentsPerUser) return `每位成员最多可发表 ${detail.value.issue.maxCommentsPerUser} 条意见。`;
  return '登录并具备权限后可发表意见。';
});
const voteDisabledText = computed(() => {
  if (!detail.value?.issue) return '';
  if (detail.value.issue.status === 'open') return detail.value.issue.voteStartsAt ? '投票尚未开始，将按设定时间自动开始。' : '等待议题创建者开始投票。';
  if (detail.value.issue.status === 'closed') return '投票已经结束。';
  if (detail.value.issue.status === 'archived') return '议题已归档。';
  return '当前账号没有投票权限。';
});
const visibilityOptions = [{ label: '公开可见', value: 'public' }, { label: '登录可见', value: 'login' }, { label: '指定权限组可见', value: 'groups' }];
const voteVisibilityOptions = [{ label: '投票结束后公布统计', value: 'counts_after_close' }, { label: '投票后即时公布统计', value: 'counts_after_vote' }, { label: '投票结束后公布姓名与统计', value: 'names_after_close' }, { label: '仅管理员可见', value: 'admin_only' }];
const passRuleOptions = [{ label: '简单多数通过', value: 'simple_majority' }, { label: '三分之二多数通过', value: 'two_thirds' }, { label: '自定义规则', value: 'custom' }];

async function load() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const [issueDetail, issueComments, config] = await Promise.all([
      apiGet<any>(`/issues/${route.params.number}`),
      apiGet<any[]>(`/issues/${route.params.number}/comments`),
      apiGet<{ timePresets?: { voteShortMinutes?: number } }>('/site-config')
    ]);
    detail.value = issueDetail;
    comments.value = issueComments;
    manualVoteDurationMinutes.value = Math.max(1, Number(config.timePresets?.voteShortMinutes) || 60);
    choice.value = null;
    syncEditFields();
  } catch (error) {
    detail.value = null;
    errorMessage.value = error instanceof Error ? error.message : '议题不存在或当前账号没有查看权限。';
  } finally {
    loading.value = false;
  }
}
async function submitVote() { if (!choice.value) return; detail.value = await apiPost(`/issues/${route.params.number}/vote`, { choice: choice.value }); choice.value = null; message.success('投票已提交'); }
async function submitComment() { await apiPost(`/issues/${route.params.number}/comments`, { bodyMd: commentBody.value }); commentBody.value = ''; comments.value = await apiGet(`/issues/${route.params.number}/comments`); message.success('意见已提交'); }
async function toggleReaction(comment: any, reaction: 'like' | 'yes' | 'no') { if (!comment.viewerCanReact) return; const result = await apiPost<{ reactionCounts: Record<string, number>; myReactions: string[] }>(`/issues/${route.params.number}/comments/${comment.id}/reactions`, { reaction }); comment.reactionCounts = result.reactionCounts; comment.myReactions = result.myReactions; }
function startReply(comment: any) { replyingCommentId.value = comment.id; replyBody.value = ''; }
function cancelReply() { replyingCommentId.value = null; replyBody.value = ''; }
async function submitReply(commentId: string) { if (!hasContent(replyBody.value)) return; submittingReply.value = true; try { await apiPost(`/issues/${route.params.number}/comments/${commentId}/replies`, { bodyMd: replyBody.value }); comments.value = await apiGet(`/issues/${route.params.number}/comments`); cancelReply(); message.success('回复已发送'); } finally { submittingReply.value = false; } }
function confirmDeleteReply(comment: any, reply: any) { dialog.warning({ title: '删除回复', content: '确认删除这条回复吗？删除后将不再对其他成员展示。', positiveText: '确认删除', negativeText: '取消', onPositiveClick: async () => { try { await apiDelete(`/issues/${route.params.number}/comments/${comment.id}/replies/${reply.id}`); comments.value = await apiGet(`/issues/${route.params.number}/comments`); message.success('回复已删除'); } catch (error) { message.error(error instanceof Error ? error.message : '删除回复失败'); return false; } } }); }
function confirmHideReply(comment: any, reply: any) { dialog.warning({ title: '屏蔽回复', content: '确认屏蔽这条回复吗？屏蔽后将不再对成员展示，并保留操作记录。', positiveText: '确认屏蔽', negativeText: '取消', onPositiveClick: async () => { try { await apiPost(`/issues/${route.params.number}/comments/${comment.id}/replies/${reply.id}/hide`); comments.value = await apiGet(`/issues/${route.params.number}/comments`); message.success('回复已屏蔽'); } catch (error) { message.error(error instanceof Error ? error.message : '屏蔽回复失败'); return false; } } }); }
function startCommentEdit(comment: any) { editingCommentId.value = comment.id; editingCommentBody.value = comment.bodyMd; }
function cancelCommentEdit() { editingCommentId.value = null; editingCommentBody.value = ''; }
async function saveCommentEdit(commentId: string) { if (!hasContent(editingCommentBody.value)) return; savingComment.value = true; try { await apiPut(`/issues/${route.params.number}/comments/${commentId}`, { bodyMd: editingCommentBody.value }); await load(); cancelCommentEdit(); message.success('意见已保存'); } finally { savingComment.value = false; } }
function confirmIssueStatus() {
  const reopening = detail.value.issue.status === 'closed';
  if (!reopening) {
    closeVisibility.value = 'retain';
    showCloseDialog.value = true;
    return;
  }
  dialog.warning({
    title: '重新开启议题',
    content: '重新开启后，议题会回到开放讨论状态；未设置自动时间的投票需由创建者再次开始。',
    positiveText: '确认重新开启',
    negativeText: '取消',
    onPositiveClick: () => updateIssueStatus(true)
  });
}
async function closeIssue() {
  closingIssue.value = true;
  try {
    detail.value = await apiPost(`/issues/${route.params.number}/close`, { visibility: closeVisibility.value });
    showCloseDialog.value = false;
    message.success(detail.value.issue.votingEnabled ? '投票已结束，议题已关闭' : '议题已关闭');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '操作失败');
  } finally {
    closingIssue.value = false;
  }
}
async function updateIssueStatus(reopening: boolean) { try { detail.value = await apiPost(`/issues/${route.params.number}/${reopening ? 'reopen' : 'close'}`, reopening ? undefined : { visibility: 'retain' }); message.success(reopening ? '议题已重新开启' : '议题已关闭'); } catch (error) { message.error(error instanceof Error ? error.message : '操作失败'); return false; } }
function openStartVoting() { showStartVotingDialog.value = true; }
async function startVoting() { try { detail.value = await apiPost(`/issues/${route.params.number}/start-voting`, { durationMinutes: manualVoteDurationMinutes.value }); showStartVotingDialog.value = false; message.success('投票已开始'); } catch (error) { message.error(error instanceof Error ? error.message : '操作失败'); return false; } }
function confirmOutcome() { dialog.warning({ title: '确认议题结果', content: '自定义规则需要由审计员或管理员确认最终结果。', positiveText: '确认通过', negativeText: '确认未通过', onPositiveClick: () => submitOutcome('passed'), onNegativeClick: () => submitOutcome('rejected') }); }
async function submitOutcome(outcome: 'passed' | 'rejected') { try { detail.value = await apiPost(`/issues/${route.params.number}/outcome`, { outcome }); message.success(outcome === 'passed' ? '已确认议题通过' : '已确认议题未通过'); } catch (error) { message.error(error instanceof Error ? error.message : '操作失败'); return false; } }
function confirmArchive() { dialog.warning({ title: '归档议题', content: '归档后议题将停止讨论和投票，且不可重新开启。', positiveText: '确认归档', negativeText: '取消', onPositiveClick: async () => { try { detail.value = await apiPost(`/issues/${route.params.number}/archive`); message.success('议题已归档'); } catch (error) { message.error(error instanceof Error ? error.message : '归档失败'); return false; } } }); }
async function openEditor() {
  syncEditFields();
  try {
    const [groups, labels] = await Promise.all([apiGet<Array<{ groupKey: string; name: string }>>('/permission-groups'), apiGet<Array<{ id: number; name: string }>>('/labels')]);
    groupOptions.value = groups.map((group) => ({ label: group.name, value: group.groupKey }));
    labelOptions.value = labels.map((label) => ({ label: label.name, value: Number(label.id) }));
    showEditor.value = true;
  } catch (error) {
    message.error(error instanceof Error ? error.message : '无法读取编辑选项');
  }
}
async function saveEdit() {
  if (!editTitle.value.trim() || !hasContent(editBody.value)) return;
  if (!validateEditTimePlan()) return;
  savingEdit.value = true;
  try {
    detail.value = await apiPut(`/issues/${route.params.number}`, {
      title: editTitle.value.trim(), bodyMd: editBody.value, visibility: editVisibility.value, viewGroupKeys: editViewGroupKeys.value,
      voteGroupKeys: editVoteGroupKeys.value, labelIds: editLabelIds.value, commentPublishAt: toIso(editCommentPublishAt.value),
      commentEndsAt: toIso(editCommentEndsAt.value), commentAnonymous: editCommentAnonymous.value, maxCommentsPerUser: editMaxCommentsPerUser.value, votingEnabled: editVotingEnabled.value,
      voteStartsAt: editVotingEnabled.value ? toIso(editVoteStartsAt.value) : null, voteEndsAt: editVotingEnabled.value ? toIso(editVoteEndsAt.value) : null,
      voteVisibility: editVoteVisibility.value, allowVoteChange: editAllowVoteChange.value, maxVoteChanges: editMaxVoteChanges.value,
      quorumCount: detail.value.issue.quorumCount, passRule: editPassRule.value, customPassRule: editPassRule.value === 'custom' ? editCustomPassRule.value.trim() : null
    });
    showEditor.value = false;
    message.success('议题已保存');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存失败');
  } finally {
    savingEdit.value = false;
  }
}
function syncEditFields() {
  if (!detail.value?.issue) return;
  const issue = detail.value.issue;
  editTitle.value = issue.title; editBody.value = issue.bodyMd; editVisibility.value = issue.visibility;
  editViewGroupKeys.value = issue.viewGroups.map((group: any) => group.groupKey); editVoteGroupKeys.value = issue.voteGroups.map((group: any) => group.groupKey);
  editLabelIds.value = issue.labels.map((label: any) => Number(label.id)); editCommentPublishAt.value = toPickerValue(issue.commentPublishAt); editCommentEndsAt.value = toPickerValue(issue.commentEndsAt); editCommentAnonymous.value = Boolean(issue.commentAnonymous);
  editMaxCommentsPerUser.value = issue.maxCommentsPerUser; editVotingEnabled.value = issue.votingEnabled; editVoteStartsAt.value = toPickerValue(issue.voteStartsAt); editVoteEndsAt.value = toPickerValue(issue.voteEndsAt);
  editVoteVisibility.value = issue.voteVisibility; editAllowVoteChange.value = issue.allowVoteChange; editMaxVoteChanges.value = issue.maxVoteChanges; editPassRule.value = issue.passRule; editCustomPassRule.value = issue.customPassRule || '';
}
function toPickerValue(value: string | null) { return value ? new Date(value).getTime() : null; }
function toIso(value: number | null) { return value ? new Date(value).toISOString() : null; }
function validateEditTimePlan() {
  if (editCommentEndsAt.value && editCommentPublishAt.value && editCommentEndsAt.value <= editCommentPublishAt.value) { message.error('意见截止时间必须晚于意见开始时间'); return false; }
  if (editVotingEnabled.value && Boolean(editVoteStartsAt.value) !== Boolean(editVoteEndsAt.value)) { message.error('自动投票的开始和结束时间必须同时设置'); return false; }
  if (editVoteStartsAt.value && editVoteEndsAt.value && editVoteEndsAt.value <= editVoteStartsAt.value) { message.error('投票结束时间必须晚于开始时间'); return false; }
  return true;
}
function disableEditCommentEndDate(timestamp: number) { return Boolean(editCommentPublishAt.value && timestamp < startOfDay(editCommentPublishAt.value)); }
function disableEditVoteEndDate(timestamp: number) { return Boolean(editVoteStartsAt.value && timestamp < startOfDay(editVoteStartsAt.value)); }
function startOfDay(timestamp: number) { const date = new Date(timestamp); date.setHours(0, 0, 0, 0); return date.getTime(); }
function hasContent(value: string) { return value.replace(/<[^>]+>/g, '').trim().length > 0; }
function renderContent(value: string) { const html = /<\/?[a-z][\s\S]*>/i.test(value) ? value : marked.parse(value, { gfm: true, breaks: true }) as string; return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] }); }
function statusText(value: string) { return { pending_review: '待预审', review_rejected: '预审驳回', open: '开放', voting: '投票中', closed: '已关闭', archived: '已归档', draft: '草稿' }[value] || value; }
function issueStatusTagType(value: string): 'success' | 'warning' | 'error' | 'default' { return { pending_review: 'warning', review_rejected: 'error', open: 'success', voting: 'warning', closed: 'default', archived: 'default', draft: 'default' }[value] as 'success' | 'warning' | 'error' | 'default' || 'default'; }
function outcomeText(value: string) { return { pending: '结果待定', passed: '已通过', rejected: '未通过', manual_required: '等待人工确认', not_applicable: '不适用投票' }[value] || value; }
function outcomeTagType(value: string): 'success' | 'error' | 'warning' | 'default' { return { passed: 'success', rejected: 'error', manual_required: 'warning', not_applicable: 'default', pending: 'default' }[value] as 'success' | 'error' | 'warning' | 'default' || 'default'; }
function visibilityText(value: string) { return { public: '公开可见', login: '登录可见', groups: '群组可见' }[value] || value; }
function voteVisibilityText(value: string) { return { counts_after_vote: '投票后即时公布统计', counts_after_close: '结束后公布统计', names_after_close: '结束后公布姓名与统计', admin_only: '仅管理员可见' }[value] || value; }
function passRuleText(value: string) { return { simple_majority: '简单多数通过', two_thirds: '三分之二多数通过', custom: '自定义规则' }[value] || value; }
function voteText(value: string) { return { agree: '同意', disagree: '不同意', abstain: '弃权' }[value] || value; }
function voteTagType(value: string): 'success' | 'error' | 'warning' | 'default' { return { agree: 'success', disagree: 'error', abstain: 'warning' }[value] as 'success' | 'error' | 'warning' | undefined || 'default'; }
function reactionActive(comment: any, reaction: string) { return comment.myReactions?.includes(reaction); }
function hasReactions(comment: any) { return Object.values(comment.reactionCounts || {}).some((count) => Number(count) > 0); }
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
  margin-top: 10px;
  color: inherit;
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
  margin-left: auto;
}

.comment-edit-actions {
  margin-top: 10px;
}

.comment-list {
  margin: 0 -4px;
}

.comment-item :deep(.n-list-item__prefix) {
  align-self: flex-start;
  margin-right: 12px;
  margin-top: 3px;
}

.comment-composer-heading {
  margin-bottom: 10px;
}

.reaction-bar {
  margin: 0;
}

.comment-footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
}

.reply-list {
  margin: 14px 0 0;
  padding-left: 14px;
  border-left: 2px solid var(--n-divider-color, #e5e7eb);
}

.reply-item :deep(.n-list-item) {
  padding: 8px 0;
}

.reply-item :deep(.n-list-item__prefix) {
  align-self: flex-start;
  margin-top: 2px;
  margin-right: 8px;
}

.reply-content {
  margin-top: 5px;
  color: inherit;
  line-height: 1.7;
}

.reply-time {
  margin-top: 6px;
}

.reply-form {
  display: grid;
  gap: 8px;
  margin-top: 14px;
  padding: 12px;
  background: var(--n-color-modal, #fafcff);
  border: 1px solid var(--n-border-color, #e5e7eb);
  border-radius: 6px;
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
  background: var(--n-color-modal);
  border-radius: 4px;
}

.rendered-content :deep(blockquote) {
  margin: 12px 0;
  padding-left: 12px;
  color: inherit;
  opacity: .72;
  border-left: 3px solid #91caff;
}

@media (max-width: 820px) {
  .issue-heading h1 {
    font-size: 24px;
  }

  .comment-footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .comment-meta {
    margin-left: 0;
  }
}
</style>
