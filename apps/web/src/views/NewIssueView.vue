<template>
  <main class="content-wrap form-page">
    <div class="page-title">
      <div><h1>创建议题</h1><p class="page-subtitle">清晰说明议题，并设置讨论与表决的参与范围。</p></div>
    </div>
    <n-steps :current="currentStep" size="small" class="issue-steps">
      <n-step title="基本信息" />
      <n-step title="参与范围" />
      <n-step title="投票规则" />
    </n-steps>
    <n-form ref="formRef" :model="form" :rules="rules" label-placement="top" size="large">
      <n-card v-show="currentStep === 1" title="基本信息" size="large">
        <n-form-item label="议题标题" path="title"><n-input v-model:value="form.title" maxlength="200" show-count placeholder="用一句话概括需要表决的事项" /></n-form-item>
        <n-form-item label="议题说明" path="bodyMd"><ContentEditor v-model="form.bodyMd" :min-rows="9" placeholder="说明背景、可选方案、执行影响或需要讨论的重点。支持 Markdown、图片与基本富文本。" /></n-form-item>
        <n-form-item label="标签"><n-select v-model:value="form.labelIds" multiple :options="labelOptions" placeholder="选择议题分类" /></n-form-item>
      </n-card>

      <n-card v-show="currentStep === 2" title="参与范围" size="large" class="form-card">
        <n-grid :cols="2" :x-gap="20" :y-gap="4" responsive="screen" item-responsive>
          <n-gi span="2 720:1"><n-form-item label="可见范围"><n-select v-model:value="form.visibility" :options="visibilityOptions" /></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="查看权限组"><n-select v-model:value="form.viewGroupKeys" multiple :options="groupOptions" :disabled="form.visibility !== 'groups'" placeholder="仅在“权限组可见”时生效" /></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="投票权限组"><n-select v-model:value="form.voteGroupKeys" multiple :options="groupOptions" placeholder="留空则所有可见用户可投票" /></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="意见统一公布时间"><n-date-picker v-model:value="commentPublishAt" type="datetime" clearable style="width: 100%" /></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="意见截止时间"><n-date-picker v-model:value="commentEndsAt" type="datetime" clearable style="width: 100%" /></n-form-item></n-gi>
        </n-grid>
        <n-alert type="info" :bordered="false">不设置意见公布时间时，符合查看权限的用户会立即看到新意见。</n-alert>
      </n-card>

      <n-card v-show="currentStep === 3" title="投票规则" size="large" class="form-card">
        <n-grid :cols="2" :x-gap="20" :y-gap="4" responsive="screen" item-responsive>
          <n-gi span="2 720:1"><n-form-item label="投票开始"><n-date-picker v-model:value="voteStartsAt" type="datetime" clearable style="width: 100%" /></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="投票结束"><n-date-picker v-model:value="voteEndsAt" type="datetime" clearable style="width: 100%" /></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="结果可见性"><n-select v-model:value="form.voteVisibility" :options="voteVisibilityOptions" /></n-form-item></n-gi>
          <n-gi span="2 720:1"><n-form-item label="通过规则"><n-select v-model:value="form.passRule" :options="passRuleOptions" /></n-form-item></n-gi>
        </n-grid>
        <n-space vertical :size="10"><n-checkbox v-model:checked="form.allowVoteChange">投票结束前允许修改自己的选择</n-checkbox></n-space>
      </n-card>

      <n-card size="small" class="form-footer">
        <n-space justify="end">
          <n-button v-if="currentStep === 1" @click="router.push('/')">取消</n-button>
          <n-button v-else @click="currentStep -= 1"><template #icon><n-icon><ArrowBackOutline /></n-icon></template>上一步</n-button>
          <n-button v-if="currentStep < 3" type="primary" @click="nextStep">下一步<template #icon><n-icon><ArrowForwardOutline /></n-icon></template></n-button>
          <n-button v-else type="primary" :loading="submitting" @click="submit"><template #icon><n-icon><AddCircleOutline /></n-icon></template>发布议题</n-button>
        </n-space>
      </n-card>
    </n-form>
  </main>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { AddCircleOutline, ArrowBackOutline, ArrowForwardOutline } from '@vicons/ionicons5';
import { NAlert, NButton, NCard, NCheckbox, NDatePicker, NForm, NFormItem, NGi, NGrid, NIcon, NInput, NSelect, NSpace, NStep, NSteps, useMessage } from 'naive-ui';
import type { FormInst, FormRules } from 'naive-ui';
import { apiGet, apiPost } from '../api';
import ContentEditor from '../components/ContentEditor.vue';

const router = useRouter();
const message = useMessage();
const formRef = ref<FormInst | null>(null);
const submitting = ref(false);
const currentStep = ref(1);
const groupOptions = ref<Array<{ label: string; value: string }>>([]);
const labelOptions = ref<Array<{ label: string; value: number }>>([]);
const commentPublishAt = ref<number | null>(null);
const commentEndsAt = ref<number | null>(null);
const voteStartsAt = ref<number | null>(null);
const voteEndsAt = ref<number | null>(null);
const form = reactive({ title: '', bodyMd: '', visibility: 'login', viewGroupKeys: [] as string[], voteGroupKeys: ['council'] as string[], labelIds: [] as number[], voteVisibility: 'counts_after_close', allowVoteChange: true, passRule: 'simple_majority' });
const rules: FormRules = { title: [{ required: true, message: '请填写议题标题', trigger: ['input', 'blur'] }], bodyMd: [{ required: true, message: '请填写议题说明', trigger: ['input', 'blur'] }] };
const visibilityOptions = [{ label: '公开可见', value: 'public' }, { label: '登录可见', value: 'login' }, { label: '指定权限组可见', value: 'groups' }];
const voteVisibilityOptions = [{ label: '投票结束后公布统计', value: 'counts_after_close' }, { label: '投票后即时公布统计', value: 'counts_after_vote' }, { label: '投票结束后公布姓名与统计', value: 'names_after_close' }, { label: '仅管理员可见', value: 'admin_only' }];
const passRuleOptions = [{ label: '简单多数通过', value: 'simple_majority' }, { label: '三分之二多数通过', value: 'two_thirds' }, { label: '自定义规则', value: 'custom' }];

async function nextStep() {
  if (currentStep.value === 1) await formRef.value?.validate();
  currentStep.value += 1;
}

async function submit() {
  await formRef.value?.validate();
  submitting.value = true;
  try {
    const detail = await apiPost<any>('/issues', { ...form, commentPublishAt: commentPublishAt.value ? new Date(commentPublishAt.value).toISOString() : null, commentEndsAt: commentEndsAt.value ? new Date(commentEndsAt.value).toISOString() : null, voteStartsAt: voteStartsAt.value ? new Date(voteStartsAt.value).toISOString() : null, voteEndsAt: voteEndsAt.value ? new Date(voteEndsAt.value).toISOString() : null });
    message.success('议题已发布'); router.push(`/issues/${detail.issue.number}`);
  } finally { submitting.value = false; }
}
onMounted(async () => {
  try {
    const [groups, labels, config] = await Promise.all([apiGet<Array<{ groupKey: string; name: string }>>('/permission-groups'), apiGet<Array<{ id: number; name: string }>>('/labels'), apiGet<{ defaultIssueVisibility: 'public' | 'login' | 'groups' }>('/site-config')]);
    groupOptions.value = groups.map((group) => ({ label: group.name, value: group.groupKey }));
    labelOptions.value = labels.map((label) => ({ label: label.name, value: label.id }));
    form.visibility = config.defaultIssueVisibility;
  } catch {
    message.error('无法读取创建议题所需的权限配置，请确认已登录。');
  }
});
</script>

<style scoped>
.form-page :deep(.n-form) { display: grid; gap: 20px; }
.issue-steps { max-width: 680px; margin: 0 0 24px; }
.form-card { margin: 0; }
.form-footer { margin-bottom: 24px; }
@media (max-width: 480px) { .form-footer :deep(.n-space) { width: 100%; } .form-footer :deep(.n-button) { flex: 1; } }
</style>
