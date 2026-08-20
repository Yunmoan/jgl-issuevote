<template>
  <main class="content-wrap">
    <div class="page-title">
      <div>
        <h1>管理后台</h1>
        <div class="muted">用户、权限组、设置和审计记录。</div>
      </div>
    </div>

    <div class="admin-grid">
      <n-menu v-model:value="active" :options="menuOptions" />
      <section class="panel">
        <template v-if="active === 'users'">
          <n-space class="toolbar">
            <n-input v-model:value="q" placeholder="搜索用户" clearable style="width: 260px" @keyup.enter="loadUsers" />
            <n-button secondary @click="loadUsers">搜索</n-button>
          </n-space>
          <n-data-table :columns="userColumns" :data="users" :pagination="{ pageSize: 10 }" />
        </template>

        <template v-else-if="active === 'groups'">
          <n-data-table :columns="groupColumns" :data="groups" :pagination="{ pageSize: 10 }" />
        </template>

        <template v-else-if="active === 'settings'">
          <n-alert type="info" :bordered="false">
            Secret 只应在环境变量中配置，后台只展示业务开关和非敏感状态。
          </n-alert>
          <n-data-table :columns="settingColumns" :data="settings" />
        </template>

        <template v-else>
          <n-data-table :columns="auditColumns" :data="auditLogs" :pagination="{ pageSize: 10 }" />
        </template>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { h, onMounted, ref, watch } from 'vue';
import { NAlert, NButton, NDataTable, NInput, NMenu, NSpace, NTag, useMessage } from 'naive-ui';
import type { DataTableColumns, MenuOption } from 'naive-ui';
import { apiGet, apiPatch, apiPost } from '../api';

const message = useMessage();
const active = ref('users');
const q = ref('');
const users = ref<any[]>([]);
const groups = ref<any[]>([]);
const settings = ref<any[]>([]);
const auditLogs = ref<any[]>([]);

const menuOptions: MenuOption[] = [
  { label: '用户', key: 'users' },
  { label: '权限组', key: 'groups' },
  { label: '系统设置', key: 'settings' },
  { label: '审计日志', key: 'audit' }
];

const userColumns: DataTableColumns<any> = [
  { title: '用户', key: 'displayName' },
  { title: '邮箱', key: 'email' },
  {
    title: '权限组',
    key: 'groups',
    render(row) {
      return h('div', { class: 'tag-line' }, row.groups.map((group: string) => h(NTag, { size: 'small', type: 'info' }, { default: () => group })));
    }
  },
  {
    title: '身份源',
    key: 'boundProviders',
    render(row) {
      return h('div', { class: 'tag-line' }, row.boundProviders.map((provider: string) => h(NTag, { size: 'small' }, { default: () => provider })));
    }
  },
  {
    title: '状态',
    key: 'status',
    render(row) {
      return h(NTag, { type: row.status === 'active' ? 'success' : 'warning' }, { default: () => row.status });
    }
  },
  {
    title: '操作',
    key: 'actions',
    render(row) {
      return h(
        NSpace,
        {},
        {
          default: () => [
            h(NButton, { size: 'small', secondary: true, onClick: () => addCouncil(row.id) }, { default: () => '设为理事' }),
            h(
              NButton,
              { size: 'small', secondary: true, type: row.status === 'active' ? 'warning' : 'success', onClick: () => toggleStatus(row) },
              { default: () => (row.status === 'active' ? '禁用' : '启用') }
            )
          ]
        }
      );
    }
  }
];

const groupColumns: DataTableColumns<any> = [
  { title: 'Key', key: 'groupKey' },
  { title: '名称', key: 'name' },
  { title: '类型', key: 'kind' },
  { title: '说明', key: 'description' }
];

const settingColumns: DataTableColumns<any> = [
  { title: '配置项', key: 'key' },
  { title: '值', key: 'value', render: (row) => JSON.stringify(row.value) },
  { title: '更新时间', key: 'updatedAt' }
];

const auditColumns: DataTableColumns<any> = [
  { title: '时间', key: 'createdAt' },
  { title: '操作者', key: 'actorName' },
  { title: '动作', key: 'action' },
  { title: '对象', key: 'targetId' }
];

async function loadUsers() {
  const params = new URLSearchParams();
  if (q.value) params.set('q', q.value);
  users.value = await apiGet(`/admin/users?${params}`);
}

async function loadGroups() {
  groups.value = await apiGet('/admin/groups');
}

async function loadSettings() {
  settings.value = await apiGet('/admin/settings');
}

async function loadAudit() {
  auditLogs.value = await apiGet('/admin/audit-logs');
}

async function addCouncil(userId: string) {
  await apiPost(`/admin/users/${userId}/groups`, { groupKey: 'council' });
  message.success('已加入理事会成员组');
  loadUsers();
}

async function toggleStatus(row: any) {
  await apiPatch(`/admin/users/${row.id}`, { status: row.status === 'active' ? 'disabled' : 'active' });
  message.success('状态已更新');
  loadUsers();
}

async function loadActive() {
  if (active.value === 'users') await loadUsers();
  if (active.value === 'groups') await loadGroups();
  if (active.value === 'settings') await loadSettings();
  if (active.value === 'audit') await loadAudit();
}

watch(active, loadActive);
onMounted(loadActive);
</script>

<style scoped>
.toolbar {
  margin-bottom: 12px;
}
</style>

