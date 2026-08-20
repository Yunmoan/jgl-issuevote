<template>
  <main class="content-wrap form-page">
    <div class="page-title">
      <div><h1>{{ manualReviewRequired ? '提交议题' : '创建议题' }}</h1><p class="page-subtitle">清晰说明议题，并设置讨论与表决的参与范围。</p></div>
    </div>
    <n-steps :current="currentStep" size="small" class="issue-steps">
      <n-step title="基本信息" />
      <n-step title="参与范围" />
      <n-step title="投票规则" />
    </n-steps>
    <n-alert v-if="manualReviewRequired" type="info" :bordered="false" style="margin-bottom: 8px;">提交后将进入预审，普通成员或更高权限的其他成员通过后才会公开。</n-alert>
    <n-alert v-else-if="issueReviewMode === 'ai'" type="info" :bordered="false" style="margin-bottom: 8px;">点击第一步“下一步”后将自动进行 AI 预审，包括相似议题、法律法规风险和站点自定义条件检查。</n-alert>
    <n-form ref="formRef" :model="form" :rules="rules" label-placement="top" size="large">
      <n-card v-show="currentStep === 1" title="基本信息" size="large">
        <n-form-item label="议题标题" path="title"><n-input v-model:value="form.title" maxlength="200" show-count placeholder="用一句话概括需要表决的事项" /></n-form-item>
        <n-form-item label="议题说明" path="bodyMd"><ContentEditor v-model="form.bodyMd" :min-rows="9" placeholder="说明背景、可选方案、执行影响或需要讨论的重点。支持 Markdown、图片与基本富文本。" /></n-form-item>
        <n-form-item label="分类"><n-select v-model:value="form.labelIds" multiple :options="labelOptions" :loading="loadingOptions" :disabled="!formOptionsReady" placeholder="选择议题分类" /></n-form-item>
        <n-alert v-if="aiReview" :type="aiReview.approved ? 'success' : 'error'" :bordered="false" :title="aiReview.approved ? 'AI 预审通过' : 'AI 预审未通过'">
          <n-space vertical :size="8"><span>{{ aiReview.summary }}</span><n-text>法律法规检查：{{ aiReview.legal.passed ? '通过' : '未通过' }}，{{ aiReview.legal.reason }}</n-text><n-text>自定义条件检查：{{ aiReview.policy.passed ? '通过' : '未通过' }}，{{ aiReview.policy.reason }}</n-text><n-text v-for="risk in aiReview.risks" :key="risk" depth="3">{{ risk }}</n-text><n-space v-if="aiReview.similarIssues.length" vertical :size="4"><n-text strong>可能相似的已存在议题</n-text><n-button v-for="issue in aiReview.similarIssues" :key="issue.number" text type="primary" @click="router.push(`/issues/${issue.number}`)">#{{ issue.number }} {{ issue.title }}</n-button></n-space></n-space>
        </n-alert>
      </n-card>

      <n-alert v-if="optionsError" type="error" :bordered="false" title="无法读取创建议题所需的配置">
        <n-space align="center" :size="8"><span>{{ optionsError }}</span><n-button text type="primary" :loading="loadingOptions" @click="loadFormOptions">重试</n-button></n-space>
      </n-alert>

      <n-card v-show="currentStep === 2" title="参与范围" size="large" class="form-card">
        <n-grid :cols="2" :x-gap="20" :y-gap="4" responsive="screen" item-responsive>
          <n-gi span="2 720:1"><n-form-item label="可见范围"><n-select v-model:value="form.visibility" :options="visibilityOptions" /></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="查看权限组"><n-select v-model:value="form.viewGroupKeys" multiple :options="groupOptions" :loading="loadingOptions" :disabled="form.visibility !== 'groups' || !formOptionsReady" placeholder="仅在“权限组可见”时生效" /></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="投票权限组"><n-select v-model:value="form.voteGroupKeys" multiple :options="groupOptions" :loading="loadingOptions" :disabled="!formOptionsReady" placeholder="留空则所有可见用户可投票" /></n-form-item></n-gi>
          <n-gi span="2"><n-form-item label="议题时间"><n-radio-group v-model:value="commentTimeMode"><n-space :size="12" :wrap="true"><n-radio value="short">短周期（{{ timePresets.discussionShortDays }} 天）</n-radio><n-radio value="long">长周期（{{ timePresets.discussionLongDays }} 天）</n-radio><n-radio value="days">手动输入天数</n-radio><n-radio value="specific">手动设定时间</n-radio></n-space></n-radio-group></n-form-item></n-gi>
          <n-gi v-if="commentTimeMode === 'days'" span="2 720:1"><n-form-item label="征集天数"><n-input-number v-model:value="commentDurationDays" :min="1" :max="365" style="width: 100%"><template #suffix>天</template></n-input-number></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="意见统一公布时间"><n-date-picker v-model:value="commentPublishAt" type="datetime" clearable style="width: 100%" /></n-form-item></n-gi>
          <n-gi v-if="commentTimeMode === 'specific'" span="2 720:1"><n-form-item label="意见截止时间"><n-date-picker v-model:value="commentEndsAt" type="datetime" clearable style="width: 100%" :is-date-disabled="disableCommentEndDate" /></n-form-item></n-gi>
          <n-gi v-else span="2 720:1"><n-form-item label="意见截止时间"><n-text>{{ commentEndsAt ? formatTime(commentEndsAt) : '未设置' }}</n-text></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="每人最多发表意见次数"><n-input-number v-model:value="form.maxCommentsPerUser" :min="1" :max="100" style="width: 100%"><template #suffix>次</template></n-input-number></n-form-item></n-gi>
        </n-grid>
        <n-space vertical :size="8"><n-checkbox v-model:checked="form.commentAnonymous">意见与回复匿名展示</n-checkbox><n-text depth="3">不设置意见公布时间时，符合查看权限的用户会立即看到新意见。</n-text></n-space>
      </n-card>

      <n-card v-show="currentStep === 3" title="投票规则" size="large" class="form-card">
        <n-space vertical :size="16">
          <n-checkbox v-model:checked="form.votingEnabled">启用投票器</n-checkbox>
          <n-text depth="3">关闭后，该议题仅用于讨论，不会显示投票器或产生投票结果。</n-text>
        </n-space>
        <template v-if="form.votingEnabled">
          <n-grid :cols="2" :x-gap="20" :y-gap="4" responsive="screen" item-responsive>
            <n-gi span="2"><n-form-item label="投票时间"><n-radio-group v-model:value="voteTimeMode"><n-space :size="12" :wrap="true"><n-radio value="manual">手动开启</n-radio><n-radio value="instant">即时投票（{{ timePresets.voteInstantMinutes }} 分钟）</n-radio><n-radio value="short">短周期投票（{{ timePresets.voteShortMinutes }} 分钟）</n-radio><n-radio value="long">长周期投票（{{ timePresets.voteLongMinutes }} 分钟）</n-radio><n-radio value="minutes">手动输入分钟</n-radio><n-radio value="specific">手动设定时间</n-radio></n-space></n-radio-group></n-form-item></n-gi>
            <template v-if="voteTimeMode !== 'manual' && voteTimeMode !== 'specific'">
              <n-gi span="2 720:1"><n-form-item label="多久后开始投票"><n-input-number v-model:value="voteStartDelayMinutes" :min="0" :max="43200" style="width: 100%"><template #suffix>分钟后</template></n-input-number></n-form-item></n-gi>
              <n-gi v-if="voteTimeMode === 'minutes'" span="2 720:1"><n-form-item label="投票持续时间"><n-input-number v-model:value="voteDurationMinutes" :min="1" :max="43200" style="width: 100%"><template #suffix>分钟</template></n-input-number></n-form-item></n-gi>
              <n-gi span="2"><n-form-item label="计划"><n-text>{{ voteStartsAt ? `${formatTime(voteStartsAt)} 至 ${formatTime(voteEndsAt)}` : '未设置' }}</n-text></n-form-item></n-gi>
            </template>
            <template v-else-if="voteTimeMode === 'specific'">
              <n-gi span="2 720:1"><n-form-item label="自动投票开始"><n-date-picker v-model:value="voteStartsAt" type="datetime" clearable style="width: 100%" /></n-form-item></n-gi>
              <n-gi span="2 720:1"><n-form-item label="自动投票结束"><n-date-picker v-model:value="voteEndsAt" type="datetime" clearable style="width: 100%" :is-date-disabled="disableVoteEndDate" /></n-form-item></n-gi>
            </template>
            <n-gi v-else span="2"><n-form-item label="投票计划"><n-text>由创建者在议题页手动开始，并在确认时设置投票时长。</n-text></n-form-item></n-gi>
            <n-gi span="2 720:1"><n-form-item label="结果可见性"><n-select v-model:value="form.voteVisibility" :options="voteVisibilityOptions" /></n-form-item></n-gi>
            <n-gi span="2 720:1"><n-form-item label="通过规则"><n-select v-model:value="form.passRule" :options="passRuleOptions" /></n-form-item></n-gi>
            <n-gi v-if="form.passRule === 'custom'" span="2"><n-form-item label="自定义通过规则"><n-input v-model:value="form.customPassRule" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" maxlength="500" show-count placeholder="例如：需到会成员三分之二同意，且预算不超过既定额度。" /></n-form-item></n-gi>
            <n-gi span="2 720:1"><n-form-item label="每人最多重投次数"><n-input-number v-model:value="form.maxVoteChanges" :min="0" :max="100" :disabled="!form.allowVoteChange" style="width: 100%"><template #suffix>次</template></n-input-number></n-form-item></n-gi>
          </n-grid>
          <n-space vertical :size="10"><n-checkbox v-model:checked="form.allowVoteChange">投票结束前允许重新投票</n-checkbox><n-text depth="3">不设置自动时间时，由创建者在详情页开始或结束投票；设置时间时将自动开始和结束，仍可提前手动结束。</n-text></n-space>
        </template>
      </n-card>

      <n-card size="small" class="form-footer">
        <n-space justify="end">
          <n-button v-if="currentStep === 1" @click="router.push('/')">取消</n-button>
          <n-button v-else @click="currentStep -= 1"><template #icon><n-icon><ArrowBackOutline /></n-icon></template>上一步</n-button>
          <n-button v-if="currentStep < 3" type="primary" :loading="currentStep === 1 && aiReviewing" @click="nextStep">下一步<template #icon><n-icon><ArrowForwardOutline /></n-icon></template></n-button>
          <n-button v-else type="primary" :loading="submitting" @click="submit"><template #icon><n-icon><AddCircleOutline /></n-icon></template>{{ manualReviewRequired ? '提交预审' : '发布议题' }}</n-button>
        </n-space>
      </n-card>
    </n-form>
    <n-modal v-model:show="showSimilarIssueDialog" preset="card" title="发现相似议题" :style="{ width: 'min(620px, calc(100vw - 24px))' }" :bordered="false">
      <n-space vertical size="large"><n-text>系统找到以下最多 5 个相似议题。确认后仍可继续创建当前议题。</n-text><n-space vertical :size="8"><n-button v-for="issue in aiReview?.similarIssues || []" :key="issue.number" secondary @click="router.push(`/issues/${issue.number}`)">#{{ issue.number }} {{ issue.title }}</n-button></n-space></n-space>
      <template #footer><n-space justify="end"><n-button @click="showSimilarIssueDialog = false">返回修改</n-button><n-button type="primary" @click="continueAfterSimilarIssues">继续创建</n-button></n-space></template>
    </n-modal>
  </main>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { AddCircleOutline, ArrowBackOutline, ArrowForwardOutline } from '@vicons/ionicons5';
import { NAlert, NButton, NCard, NCheckbox, NDatePicker, NForm, NFormItem, NGi, NGrid, NIcon, NInput, NInputNumber, NModal, NRadio, NRadioGroup, NSelect, NSpace, NStep, NSteps, NText, useMessage } from 'naive-ui';
import type { FormInst, FormRules } from 'naive-ui';
import { apiGet, apiPost } from '../api';
import ContentEditor from '../components/ContentEditor.vue';
import { useSessionStore } from '../stores/session';

const router = useRouter();
const message = useMessage();
const session = useSessionStore();
const formRef = ref<FormInst | null>(null);
const submitting = ref(false);
const currentStep = ref(1);
const groupOptions = ref<Array<{ label: string; value: string }>>([]);
const labelOptions = ref<Array<{ label: string; value: number }>>([]);
const loadingOptions = ref(false);
const formOptionsReady = ref(false);
const optionsError = ref('');
const issueReviewMode = ref<'disabled' | 'manual' | 'ai'>('manual');
const aiReviewing = ref(false);
const aiReviewToken = ref<string | null>(null);
const showSimilarIssueDialog = ref(false);
const aiReview = ref<null | { approved: boolean; summary: string; legal: { passed: boolean; reason: string }; policy: { passed: boolean; reason: string }; risks: string[]; similarIssues: Array<{ number: number; title: string; status: string; updatedAt: string }>; reviewToken: string | null }>(null);
const commentPublishAt = ref<number | null>(null);
const commentEndsAt = ref<number | null>(null);
const voteStartsAt = ref<number | null>(null);
const voteEndsAt = ref<number | null>(null);
const commentTimeMode = ref<'short' | 'long' | 'days' | 'specific'>('short');
const commentDurationDays = ref(3);
const voteTimeMode = ref<'manual' | 'instant' | 'short' | 'long' | 'minutes' | 'specific'>('manual');
const voteStartDelayMinutes = ref(0);
const voteDurationMinutes = ref(10);
const timePresets = ref({ discussionShortDays: 3, discussionLongDays: 5, voteInstantMinutes: 10, voteShortMinutes: 60, voteLongMinutes: 1440 });
const form = reactive({ title: '', bodyMd: '', visibility: 'login', viewGroupKeys: [] as string[], voteGroupKeys: ['council'] as string[], labelIds: [] as number[], commentAnonymous: false, votingEnabled: true, voteVisibility: 'counts_after_close', allowVoteChange: true, maxVoteChanges: 1, maxCommentsPerUser: 3, passRule: 'simple_majority', customPassRule: '' });
const rules: FormRules = { title: [{ required: true, min: 3, message: '议题标题至少需要 3 个字符', trigger: ['input', 'blur'] }], bodyMd: [{ required: true, message: '请填写议题说明', trigger: ['input', 'blur'] }] };
const visibilityOptions = [{ label: '公开可见', value: 'public' }, { label: '登录可见', value: 'login' }, { label: '指定权限组可见', value: 'groups' }];
const voteVisibilityOptions = [{ label: '投票结束后公布统计', value: 'counts_after_close' }, { label: '投票后即时公布统计', value: 'counts_after_vote' }, { label: '投票结束后公布姓名与统计', value: 'names_after_close' }, { label: '仅管理员可见', value: 'admin_only' }];
const passRuleOptions = [{ label: '简单多数通过', value: 'simple_majority' }, { label: '三分之二多数通过', value: 'two_thirds' }, { label: '自定义规则', value: 'custom' }];
const manualReviewRequired = computed(() => issueReviewMode.value === 'manual' && !session.canPublishIssue);

async function nextStep() {
  if (currentStep.value === 1) {
    await formRef.value?.validate();
    if (issueReviewMode.value === 'ai' && !await runAiReview()) return;
  }
  if (currentStep.value === 2 && !validateTimePlan()) return;
  currentStep.value += 1;
}

async function runAiReview() {
  aiReviewing.value = true;
  try {
    const result = await apiPost<typeof aiReview.value>('/issues/ai-review', { title: form.title.trim(), bodyMd: form.bodyMd.trim() });
    aiReview.value = result;
    aiReviewToken.value = result?.reviewToken || null;
    if (!result?.approved) { message.error('AI 预审未通过，请根据提示修改议题'); return false; }
    if (result.similarIssues.length) { showSimilarIssueDialog.value = true; return false; }
    return true;
  } catch (error) {
    message.error(error instanceof Error ? `AI 预审失败：${error.message}` : 'AI 预审失败，请稍后重试');
    return false;
  } finally { aiReviewing.value = false; }
}

function continueAfterSimilarIssues() {
  if (!aiReviewToken.value) return;
  showSimilarIssueDialog.value = false;
  currentStep.value += 1;
}

async function submit() {
  await formRef.value?.validate();
  if (!validateTimePlan()) return;
  if (!formOptionsReady.value) {
    message.error('创建配置尚未准备完成，请稍后重试');
    return;
  }
  if (issueReviewMode.value === 'ai' && !aiReviewToken.value) {
    message.error('请返回第一步完成 AI 预审');
    currentStep.value = 1;
    return;
  }
  submitting.value = true;
  try {
    const detail = await apiPost<any>('/issues', {
      ...form,
      title: form.title.trim(),
      labelIds: normalizeNumericIds(form.labelIds),
      customPassRule: form.passRule === 'custom' ? form.customPassRule.trim() : null,
      commentPublishAt: commentPublishAt.value ? new Date(commentPublishAt.value).toISOString() : null,
      commentEndsAt: commentEndsAt.value ? new Date(commentEndsAt.value).toISOString() : null,
      voteStartsAt: form.votingEnabled && voteStartsAt.value ? new Date(voteStartsAt.value).toISOString() : null,
      voteEndsAt: form.votingEnabled && voteEndsAt.value ? new Date(voteEndsAt.value).toISOString() : null,
      aiReviewToken: aiReviewToken.value || undefined
    });
    message.success(manualReviewRequired.value ? '议题已提交，等待预审' : '议题已发布'); router.push(`/issues/${detail.issue.number}`);
  } catch (error) {
    message.error(error instanceof Error ? `发布失败：${error.message}` : '发布失败，请稍后重试');
  } finally { submitting.value = false; }
}
async function loadFormOptions() {
  if (!session.viewer || loadingOptions.value) return;
  loadingOptions.value = true;
  optionsError.value = '';
  try {
    const [groups, labels, config] = await Promise.all([apiGet<Array<{ groupKey: string; name: string }>>('/permission-groups'), apiGet<Array<{ id: number; name: string }>>('/labels'), apiGet<{ defaultIssueVisibility: 'public' | 'login' | 'groups'; issueReviewMode?: 'disabled' | 'manual' | 'ai'; timePresets?: typeof timePresets.value }>('/site-config')]);
    groupOptions.value = groups.map((group) => ({ label: group.name, value: group.groupKey }));
    labelOptions.value = labels.map((label) => ({ label: label.name, value: Number(label.id) }));
    form.visibility = config.defaultIssueVisibility;
    issueReviewMode.value = config.issueReviewMode || 'manual';
    if (config.timePresets) {
      timePresets.value = config.timePresets;
      commentDurationDays.value = config.timePresets.discussionShortDays;
      voteDurationMinutes.value = config.timePresets.voteInstantMinutes;
      applyCommentPreset();
      applyVotePreset();
    }
    formOptionsReady.value = true;
  } catch (error) {
    formOptionsReady.value = false;
    optionsError.value = error instanceof Error ? error.message : '请确认登录状态和网络连接。';
  } finally {
    loadingOptions.value = false;
  }
}

function normalizeNumericIds(ids: Array<number | string>) {
  return [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isSafeInteger(id) && id > 0))];
}

function applyCommentPreset() {
  if (commentTimeMode.value === 'specific') return;
  const days = commentTimeMode.value === 'short'
    ? timePresets.value.discussionShortDays
    : commentTimeMode.value === 'long'
      ? timePresets.value.discussionLongDays
      : commentDurationDays.value;
  commentEndsAt.value = Date.now() + Math.max(1, days) * 24 * 60 * 60 * 1000;
}

function applyVotePreset() {
  if (voteTimeMode.value === 'manual') {
    voteStartsAt.value = null;
    voteEndsAt.value = null;
    return;
  }
  if (voteTimeMode.value === 'specific') return;
  const duration = voteTimeMode.value === 'instant'
    ? timePresets.value.voteInstantMinutes
    : voteTimeMode.value === 'short'
      ? timePresets.value.voteShortMinutes
      : voteTimeMode.value === 'long'
        ? timePresets.value.voteLongMinutes
        : voteDurationMinutes.value;
  voteStartsAt.value = Date.now() + Math.max(0, voteStartDelayMinutes.value) * 60 * 1000;
  voteEndsAt.value = voteStartsAt.value + Math.max(1, duration) * 60 * 1000;
}

function validateTimePlan() {
  if (commentEndsAt.value) {
    const start = commentPublishAt.value || Date.now();
    if (commentEndsAt.value <= start) {
      message.error('意见截止时间必须晚于意见开始时间');
      return false;
    }
  }
  if (!form.votingEnabled) return true;
  if (Boolean(voteStartsAt.value) !== Boolean(voteEndsAt.value)) {
    message.error('自动投票的开始和结束时间必须同时设置');
    return false;
  }
  if (voteStartsAt.value && voteEndsAt.value && voteEndsAt.value <= voteStartsAt.value) {
    message.error('投票结束时间必须晚于开始时间');
    return false;
  }
  return true;
}

function disableCommentEndDate(timestamp: number) {
  return timestamp < startOfDay(commentPublishAt.value || Date.now());
}

function disableVoteEndDate(timestamp: number) {
  return Boolean(voteStartsAt.value && timestamp < startOfDay(voteStartsAt.value));
}

function startOfDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatTime(value: number | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

watch(() => session.viewer?.id, (viewerId) => {
  if (viewerId) void loadFormOptions();
  else formOptionsReady.value = false;
}, { immediate: true });

watch(() => form.votingEnabled, (enabled) => {
  if (!enabled) {
    voteStartsAt.value = null;
    voteEndsAt.value = null;
  }
});

watch([commentTimeMode, commentDurationDays, () => timePresets.value.discussionShortDays, () => timePresets.value.discussionLongDays], applyCommentPreset, { immediate: true });
watch([voteTimeMode, voteStartDelayMinutes, voteDurationMinutes, () => timePresets.value.voteInstantMinutes, () => timePresets.value.voteShortMinutes, () => timePresets.value.voteLongMinutes], applyVotePreset, { immediate: true });

watch(() => [form.title, form.bodyMd], () => {
  aiReviewToken.value = null;
  aiReview.value = null;
  showSimilarIssueDialog.value = false;
});
</script>

<style scoped>
.form-page :deep(.n-form) { display: grid; gap: 20px; }
.issue-steps { max-width: 680px; margin: 0 0 24px; }
.form-card { margin: 0; }
.form-footer { margin-bottom: 24px; }
@media (max-width: 480px) { .form-footer :deep(.n-space) { width: 100%; } .form-footer :deep(.n-button) { flex: 1; } }
</style>
