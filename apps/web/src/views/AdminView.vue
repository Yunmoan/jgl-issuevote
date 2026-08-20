<template>
  <main class="content-wrap">
    <div class="page-title"><div><h1>管理后台</h1><p class="page-subtitle">管理成员身份、权限边界、站点配置和操作记录。</p></div></div>
    <div class="admin-grid">
      <n-card class="admin-menu" content-style="padding: 8px" size="small"><n-menu v-model:value="active" :options="menuOptions" /></n-card>
      <section>
        <n-card v-if="active === 'users'" title="用户管理" size="large">
          <template #header-extra><n-button tertiary @click="loadUsers"><template #icon><n-icon><RefreshOutline /></n-icon></template>刷新</n-button></template>
          <n-space class="toolbar" :wrap="true"><n-input v-model:value="q" clearable placeholder="姓名、邮箱或身份标识" @keyup.enter="loadUsers"><template #prefix><n-icon><SearchOutline /></n-icon></template></n-input><n-button type="primary" @click="loadUsers">搜索</n-button></n-space>
          <n-data-table :columns="userColumns" :data="users" :loading="loading" :pagination="{ pageSize: 10 }" :scroll-x="960" />
        </n-card>

        <n-card v-else-if="active === 'groups'" title="权限组" size="large">
          <template #header-extra><n-button tertiary @click="loadGroups"><template #icon><n-icon><RefreshOutline /></n-icon></template>刷新</n-button></template>
          <n-alert type="info" :bordered="false" class="card-note">权限组决定议题可见范围和投票资格。成员归属可在“用户管理”中调整。</n-alert>
          <n-data-table :columns="groupColumns" :data="groups" :loading="loading" :scroll-x="700" />
        </n-card>

        <n-card v-else-if="active === 'settings'" title="站点设置" size="large">
          <template #header-extra><n-button tertiary @click="loadSettings"><template #icon><n-icon><RefreshOutline /></n-icon></template>刷新</n-button></template>
          <n-form label-placement="top" class="settings-form">
            <n-form-item label="站点名称" :feedback="'显示在浏览器标题和全站导航栏中。'">
              <n-input v-model:value="siteName" maxlength="40" show-count placeholder="例如：冀高联议事" />
            </n-form-item>
            <n-space><n-button type="primary" :loading="savingSite" @click="saveSiteName"><template #icon><n-icon><SaveOutline /></n-icon></template>保存设置</n-button></n-space>
          </n-form>
          <n-divider />
          <n-alert type="info" :bordered="false">身份认证密钥只从部署环境变量读取，不会出现在后台页面。</n-alert>
        </n-card>

        <n-card v-else title="审计日志" size="large">
          <template #header-extra><n-button tertiary @click="loadAudit"><template #icon><n-icon><RefreshOutline /></n-icon></template>刷新</n-button></template>
          <n-data-table :columns="auditColumns" :data="auditLogs" :loading="loading" :pagination="{ pageSize: 12 }" :scroll-x="720" />
        </n-card>
      </section>
    </div>

    <n-modal v-model:show="showGroups" preset="card" title="调整用户权限组" :style="{ width: 'min(480px, calc(100vw - 24px))' }" :bordered="false">
      <p v-if="selectedUser" class="selected-user">{{ selectedUser.displayName }} <span>{{ selectedUser.email || '未提供邮箱' }}</span></p>
      <n-checkbox-group v-model:value="selectedGroups" class="group-checks"><n-space vertical><n-checkbox v-for="group in groups" :key="group.groupKey" :value="group.groupKey" :label="group.name" /></n-space></n-checkbox-group>
      <template #footer><n-space justify="end"><n-button @click="showGroups = false">取消</n-button><n-button type="primary" :loading="savingGroups" @click="saveGroups">保存权限组</n-button></n-space></template>
    </n-modal>
  </main>
</template>

<script setup lang="ts">
import { h, onMounted, ref, watch } from 'vue';
import { BookOutline, PeopleOutline, RefreshOutline, SaveOutline, SearchOutline, SettingsOutline, ShieldCheckmarkOutline } from '@vicons/ionicons5';
import { NAlert, NButton, NCard, NCheckbox, NCheckboxGroup, NDataTable, NDivider, NForm, NFormItem, NIcon, NInput, NMenu, NModal, NSpace, NTag, useMessage } from 'naive-ui';
import type { DataTableColumns, MenuOption } from 'naive-ui';
import { apiDelete, apiGet, apiPatch, apiPost } from '../api';

const message = useMessage();
const active = ref('users'); const q = ref(''); const loading = ref(false); const users = ref<any[]>([]); const groups = ref<any[]>([]); const auditLogs = ref<any[]>([]);
const siteName = ref('冀高联议事'); const savingSite = ref(false); const showGroups = ref(false); const selectedUser = ref<any>(null); const selectedGroups = ref<string[]>([]); const savingGroups = ref(false);
const menuOptions: MenuOption[] = [
  { label: '用户管理', key: 'users', icon: () => h(NIcon, null, { default: () => h(PeopleOutline) }) },
  { label: '权限组', key: 'groups', icon: () => h(NIcon, null, { default: () => h(ShieldCheckmarkOutline) }) },
  { label: '站点设置', key: 'settings', icon: () => h(NIcon, null, { default: () => h(SettingsOutline) }) },
  { label: '审计日志', key: 'audit', icon: () => h(NIcon, null, { default: () => h(BookOutline) }) }
];
const userColumns: DataTableColumns<any> = [
  { title: '用户', key: 'displayName', width: 180, render: (row) => h('div', [h('strong', row.displayName), row.email ? h('div', { class: 'table-secondary' }, row.email) : null]) },
  { title: '权限组', key: 'groups', minWidth: 190, render: (row) => h('div', { class: 'tag-line' }, row.groups.map((group: string) => h(NTag, { size: 'small', type: group === 'admin' ? 'error' : 'info' }, { default: () => group }))) },
  { title: '身份源', key: 'boundProviders', width: 150, render: (row) => h('div', { class: 'tag-line' }, row.boundProviders.map((provider: string) => h(NTag, { size: 'small', bordered: false }, { default: () => provider }))) },
  { title: '状态', key: 'status', width: 96, render: (row) => h(NTag, { type: row.status === 'active' ? 'success' : 'warning' }, { default: () => row.status === 'active' ? '正常' : '已禁用' }) },
  { title: '操作', key: 'actions', width: 154, fixed: 'right', render: (row) => h(NSpace, { size: 6 }, { default: () => [h(NButton, { size: 'small', tertiary: true, onClick: () => editGroups(row) }, { default: () => '权限组' }), h(NButton, { size: 'small', tertiary: true, type: row.status === 'active' ? 'warning' : 'success', onClick: () => toggleStatus(row) }, { default: () => row.status === 'active' ? '禁用' : '启用' })] }) }
];
const groupColumns: DataTableColumns<any> = [{ title: '名称', key: 'name', width: 180 }, { title: '标识', key: 'groupKey', width: 160 }, { title: '类型', key: 'kind', width: 110, render: (row) => h(NTag, { size: 'small', bordered: false }, { default: () => row.kind }) }, { title: '说明', key: 'description', minWidth: 260 }];
const auditColumns: DataTableColumns<any> = [{ title: '时间', key: 'createdAt', width: 180, render: (row) => new Date(row.createdAt).toLocaleString('zh-CN') }, { title: '操作者', key: 'actorName', width: 140 }, { title: '动作', key: 'action', minWidth: 180 }, { title: '对象', key: 'targetId', minWidth: 180 }];

async function request<T>(work: () => Promise<T>) { loading.value = true; try { return await work(); } finally { loading.value = false; } }
async function loadUsers() { users.value = await request(async () => apiGet(`/admin/users?${q.value ? new URLSearchParams({ q: q.value }) : ''}`)); }
async function loadGroups() { groups.value = await request(() => apiGet('/admin/groups')); }
async function loadAudit() { auditLogs.value = await request(() => apiGet('/admin/audit-logs')); }
async function loadSettings() { const settings = await request(() => apiGet<Array<{ key: string; value: unknown }>>('/admin/settings')); siteName.value = String(settings.find((setting) => setting.key === 'site_name')?.value || '冀高联议事'); }
async function saveSiteName() { if (!siteName.value.trim()) return; savingSite.value = true; try { const value = siteName.value.trim(); await apiPatch('/admin/settings', { key: 'site_name', value }); window.dispatchEvent(new CustomEvent('site-config-updated', { detail: value })); message.success('站点设置已保存'); } finally { savingSite.value = false; } }
async function toggleStatus(row: any) { await apiPatch(`/admin/users/${row.id}`, { status: row.status === 'active' ? 'disabled' : 'active' }); message.success('用户状态已更新'); loadUsers(); }
async function editGroups(row: any) { if (!groups.value.length) await loadGroups(); selectedUser.value = row; selectedGroups.value = [...row.groups]; showGroups.value = true; }
async function saveGroups() { if (!selectedUser.value) return; savingGroups.value = true; try { const before = new Set<string>(selectedUser.value.groups as string[]); const after = new Set<string>(selectedGroups.value); await Promise.all([...after].filter((key) => !before.has(key)).map((groupKey) => apiPost(`/admin/users/${selectedUser.value.id}/groups`, { groupKey }))); await Promise.all([...before].filter((key) => !after.has(key)).map((groupKey) => apiDelete(`/admin/users/${selectedUser.value.id}/groups/${encodeURIComponent(groupKey)}`))); message.success('权限组已更新'); showGroups.value = false; loadUsers(); } finally { savingGroups.value = false; } }
async function loadActive() { if (active.value === 'users') await loadUsers(); if (active.value === 'groups') await loadGroups(); if (active.value === 'settings') await loadSettings(); if (active.value === 'audit') await loadAudit(); }
watch(active, loadActive); onMounted(loadActive);
</script>

<style scoped>
.toolbar :deep(.n-input) { width: 300px; }
.card-note { margin-bottom: 18px; }
.settings-form { max-width: 560px; }
.selected-user { margin-top: 0; color: #101828; font-weight: 600; }.selected-user span { display: block; margin-top: 4px; color: #667085; font-size: 13px; font-weight: 400; }
.group-checks { padding: 8px 0; }
:deep(.table-secondary) { margin-top: 3px; color: #667085; font-size: 12px; }
@media (max-width: 540px) { .toolbar { display: grid; grid-template-columns: 1fr auto; } .toolbar :deep(.n-input) { width: 100%; } }
</style>
