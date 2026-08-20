<template>
  <main class="content-wrap">
    <div class="page-title">
      <div>
        <h1>创建议题</h1>
        <div class="muted">设置可见范围、投票范围和意见统一公布时间。</div>
      </div>
    </div>

    <n-form class="panel form-grid" label-placement="top">
      <n-form-item label="标题">
        <n-input v-model:value="form.title" maxlength="200" show-count />
      </n-form-item>
      <n-form-item label="正文">
        <n-input v-model:value="form.bodyMd" type="textarea" :autosize="{ minRows: 8, maxRows: 16 }" />
      </n-form-item>
      <div class="two-col">
        <n-form-item label="可见性">
          <n-select v-model:value="form.visibility" :options="visibilityOptions" />
        </n-form-item>
        <n-form-item label="评论统一公布时间">
          <n-date-picker v-model:value="commentPublishAt" type="datetime" clearable />
        </n-form-item>
      </div>
      <div class="two-col">
        <n-form-item label="查看权限组">
          <n-select v-model:value="form.viewGroupKeys" multiple :options="groupOptions" />
        </n-form-item>
        <n-form-item label="投票权限组">
          <n-select v-model:value="form.voteGroupKeys" multiple :options="groupOptions" />
        </n-form-item>
      </div>
      <div class="two-col">
        <n-form-item label="投票开始">
          <n-date-picker v-model:value="voteStartsAt" type="datetime" clearable />
        </n-form-item>
        <n-form-item label="投票结束">
          <n-date-picker v-model:value="voteEndsAt" type="datetime" clearable />
        </n-form-item>
      </div>
      <n-space justify="end">
        <n-button @click="router.push('/')">取消</n-button>
        <n-button type="primary" :disabled="!form.title || !form.bodyMd" @click="submit">创建</n-button>
      </n-space>
    </n-form>
  </main>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NDatePicker, NForm, NFormItem, NInput, NSelect, NSpace, useMessage } from 'naive-ui';
import { apiGet, apiPost } from '../api';

const router = useRouter();
const message = useMessage();
const groupOptions = ref<Array<{ label: string; value: string }>>([]);
const commentPublishAt = ref<number | null>(null);
const voteStartsAt = ref<number | null>(null);
const voteEndsAt = ref<number | null>(null);
const form = reactive({
  title: '',
  bodyMd: '',
  visibility: 'login',
  viewGroupKeys: [] as string[],
  voteGroupKeys: ['council'] as string[],
  voteVisibility: 'counts_after_close',
  allowVoteChange: true,
  passRule: 'simple_majority'
});

const visibilityOptions = [
  { label: '公开可见', value: 'public' },
  { label: '登录可见', value: 'login' },
  { label: '权限组可见', value: 'groups' }
];

async function submit() {
  const detail = await apiPost<any>('/issues', {
    ...form,
    commentPublishAt: commentPublishAt.value ? new Date(commentPublishAt.value).toISOString() : null,
    voteStartsAt: voteStartsAt.value ? new Date(voteStartsAt.value).toISOString() : null,
    voteEndsAt: voteEndsAt.value ? new Date(voteEndsAt.value).toISOString() : null
  });
  message.success('议题已创建');
  router.push(`/issues/${detail.issue.number}`);
}

onMounted(async () => {
  const groups = await apiGet<Array<{ groupKey: string; name: string }>>('/admin/groups');
  groupOptions.value = groups.map((group) => ({ label: group.name, value: group.groupKey }));
});
</script>

<style scoped>
.form-grid {
  display: grid;
  gap: 4px;
}

.two-col {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

@media (max-width: 720px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}
</style>

