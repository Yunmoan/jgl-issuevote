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
          <template #header-extra><n-space><n-button tertiary @click="loadGroups"><template #icon><n-icon><RefreshOutline /></n-icon></template>刷新</n-button><n-button type="primary" @click="openGroupEditor()"><template #icon><n-icon><AddOutline /></n-icon></template>新建权限组</n-button></n-space></template>
          <n-alert type="info" :bordered="false" class="card-note">权限组决定议题可见范围和投票资格。成员归属可在“用户管理”中调整。</n-alert>
          <n-data-table :columns="groupColumns" :data="groups" :loading="loading" :scroll-x="820" />
        </n-card>

        <n-card v-else-if="active === 'settings'" title="站点设置" size="large">
          <template #header-extra><n-button tertiary @click="loadSettings"><template #icon><n-icon><RefreshOutline /></n-icon></template>刷新</n-button></template>
          <n-form label-placement="top" class="settings-form">
            <n-form-item label="站点名称" :feedback="'显示在浏览器标题和全站导航栏中。'">
              <n-input v-model:value="siteName" maxlength="40" show-count placeholder="例如：冀高联议事" />
            </n-form-item>
            <n-form-item label="站点简介"><n-input v-model:value="siteDescription" maxlength="160" show-count placeholder="显示在议题列表标题下方" /></n-form-item>
            <n-form-item label="站点公告"><n-input v-model:value="siteNotice" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" placeholder="留空则不显示公告" /></n-form-item>
            <n-form-item label="页脚版权标识"><n-input v-model:value="footerText" maxlength="160" show-count placeholder="例如：Copyright 2026 冀高联议事" /></n-form-item>
            <n-form-item label="新议题默认可见性"><n-select v-model:value="defaultIssueVisibility" :options="visibilityOptions" /></n-form-item>
            <n-form-item label="已关闭议题自动归档"><n-input-number v-model:value="closedIssueArchiveAfterDays" :min="1" :max="3650" clearable><template #suffix>天后</template></n-input-number></n-form-item>
            <n-form-item label="水印显示"><n-select v-model:value="watermarkMode" :options="watermarkOptions" /></n-form-item>
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

    <n-modal v-model:show="showGroupEditor" preset="card" :title="editingGroup ? '编辑权限组' : '新建权限组'" :style="{ width: 'min(520px, calc(100vw - 24px))' }" :bordered="false">
      <n-form label-placement="top">
        <n-form-item label="权限组名称"><n-input v-model:value="groupForm.name" maxlength="80" placeholder="例如：秘书处成员" /></n-form-item>
        <n-form-item label="权限组标识" :feedback="'创建后不可修改；只允许小写字母、数字和下划线。'"><n-input v-model:value="groupForm.groupKey" :disabled="Boolean(editingGroup)" maxlength="80" placeholder="例如：secretariat" /></n-form-item>
        <n-form-item label="说明"><n-input v-model:value="groupForm.description" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" maxlength="300" /></n-form-item>
        <n-form-item label="允许手动分配"><n-switch v-model:value="groupForm.isAssignable" /></n-form-item>
      </n-form>
      <template #footer><n-space justify="end"><n-button @click="showGroupEditor = false">取消</n-button><n-button type="primary" :loading="savingGroup" @click="saveGroup">保存</n-button></n-space></template>
    </n-modal>
  </main>
</template>

<script setup lang="ts">
import { h, onMounted, reactive, ref, watch } from 'vue';
import { AddOutline, BookOutline, PeopleOutline, RefreshOutline, SaveOutline, SearchOutline, SettingsOutline, ShieldCheckmarkOutline } from '@vicons/ionicons5';
import { NAlert, NButton, NCard, NCheckbox, NCheckboxGroup, NDataTable, NDivider, NForm, NFormItem, NIcon, NInput, NInputNumber, NMenu, NModal, NSelect, NSpace, NSwitch, NTag, useDialog, useMessage } from 'naive-ui';
import type { DataTableColumns, MenuOption } from 'naive-ui';
import { apiDelete, apiGet, apiPatch, apiPost } from '../api';
import { displayAuditAction, displayGroup, displayProvider } from '../presentation';

const message = useMessage();
const dialog = useDialog();
const active = ref('users'); const q = ref(''); const loading = ref(false); const users = ref<any[]>([]); const groups = ref<any[]>([]); const auditLogs = ref<any[]>([]);
const siteName = ref('冀高联议事'); const siteDescription = ref(''); const siteNotice = ref(''); const footerText = ref(''); const defaultIssueVisibility = ref('login'); const closedIssueArchiveAfterDays = ref<number | null>(7); const watermarkMode = ref('off'); const savingSite = ref(false); const showGroups = ref(false); const selectedUser = ref<any>(null); const selectedGroups = ref<string[]>([]); const savingGroups = ref(false);
const showGroupEditor = ref(false); const editingGroup = ref<any>(null); const savingGroup = ref(false); const groupForm = reactive({ groupKey: '', name: '', description: '', isAssignable: true });
const visibilityOptions = [{ label: '公开可见', value: 'public' }, { label: '登录可见', value: 'login' }, { label: '指定权限组可见', value: 'groups' }];
const watermarkOptions = [{ label: '关闭', value: 'off' }, { label: '全局水印', value: 'global' }, { label: '仅议题页水印', value: 'issue' }];
const menuOptions: MenuOption[] = [
  { label: '用户管理', key: 'users', icon: () => h(NIcon, null, { default: () => h(PeopleOutline) }) },
  { label: '权限组', key: 'groups', icon: () => h(NIcon, null, { default: () => h(ShieldCheckmarkOutline) }) },
  { label: '站点设置', key: 'settings', icon: () => h(NIcon, null, { default: () => h(SettingsOutline) }) },
  { label: '审计日志', key: 'audit', icon: () => h(NIcon, null, { default: () => h(BookOutline) }) }
];
const userColumns: DataTableColumns<any> = [
  { title: '用户', key: 'displayName', width: 180, render: (row) => h('div', [h('strong', row.displayName), row.email ? h('div', { class: 'table-secondary' }, row.email) : null]) },
  { title: '权限组', key: 'groups', minWidth: 190, render: (row) => h('div', { class: 'tag-line' }, row.groups.map((group: string) => h(NTag, { size: 'small', type: group === 'admin' ? 'error' : 'info' }, { default: () => displayGroup(group) }))) },
  { title: '身份源', key: 'boundProviders', width: 150, render: (row) => h('div', { class: 'tag-line' }, row.boundProviders.map((provider: string) => h(NTag, { size: 'small', bordered: false }, { default: () => displayProvider(provider) }))) },
  { title: '状态', key: 'status', width: 96, render: (row) => h(NTag, { type: row.status === 'active' ? 'success' : 'warning' }, { default: () => row.status === 'active' ? '正常' : '已禁用' }) },
  { title: '操作', key: 'actions', width: 154, fixed: 'right', render: (row) => h(NSpace, { size: 6 }, { default: () => [h(NButton, { size: 'small', tertiary: true, onClick: () => editGroups(row) }, { default: () => '权限组' }), h(NButton, { size: 'small', tertiary: true, type: row.status === 'active' ? 'warning' : 'success', onClick: () => toggleStatus(row) }, { default: () => row.status === 'active' ? '禁用' : '启用' })] }) }
];
const groupColumns: DataTableColumns<any> = [
  { title: '名称', key: 'name', width: 160 }, { title: '标识', key: 'groupKey', width: 150 }, { title: '类型', key: 'kind', width: 100, render: (row) => h(NTag, { size: 'small', bordered: false }, { default: () => row.kind === 'system' ? '系统' : '自定义' }) }, { title: '说明', key: 'description', minWidth: 220 },
  { title: '操作', key: 'actions', width: 150, fixed: 'right', render: (row) => row.kind === 'custom' ? h(NSpace, { size: 6 }, { default: () => [h(NButton, { size: 'small', tertiary: true, onClick: () => openGroupEditor(row) }, { default: () => '编辑' }), h(NButton, { size: 'small', tertiary: true, type: 'error', onClick: () => confirmDeleteGroup(row) }, { default: () => '删除' })] }) : h(NTag, { size: 'small', bordered: false }, { default: () => '受保护' }) }
];
const auditColumns: DataTableColumns<any> = [{ title: '时间', key: 'createdAt', width: 180, render: (row) => new Date(row.createdAt).toLocaleString('zh-CN') }, { title: '操作者', key: 'actorName', width: 140 }, { title: '动作', key: 'action', minWidth: 180, render: (row) => displayAuditAction(row.action) }, { title: '对象', key: 'targetId', minWidth: 180 }];

async function request<T>(work: () => Promise<T>) { loading.value = true; try { return await work(); } finally { loading.value = false; } }
async function loadUsers() { users.value = await request(async () => apiGet(`/admin/users?${q.value ? new URLSearchParams({ q: q.value }) : ''}`)); }
async function loadGroups() { groups.value = await request(() => apiGet('/admin/groups')); }
async function loadAudit() { auditLogs.value = await request(() => apiGet('/admin/audit-logs')); }
async function loadSettings() { const settings = await request(() => apiGet<Array<{ key: string; value: unknown }>>('/admin/settings')); const value = (key: string, fallback: unknown = ''): unknown => settings.find((setting) => setting.key === key)?.value ?? fallback; siteName.value = String(value('site_name', '冀高联议事')); siteDescription.value = String(value('site_description')); siteNotice.value = String(value('site_notice')); footerText.value = String(value('footer_text')); defaultIssueVisibility.value = String(value('default_issue_visibility', 'login')); closedIssueArchiveAfterDays.value = Number(value('closed_issue_archive_after_days', 7)); watermarkMode.value = String(value('watermark_mode', 'off')); }
async function saveSiteName() { if (!siteName.value.trim()) return; savingSite.value = true; try { const name = siteName.value.trim(); const footer = footerText.value.trim(); await Promise.all([apiPatch('/admin/settings', { key: 'site_name', value: name }), apiPatch('/admin/settings', { key: 'site_description', value: siteDescription.value.trim() }), apiPatch('/admin/settings', { key: 'site_notice', value: siteNotice.value.trim() }), apiPatch('/admin/settings', { key: 'footer_text', value: footer }), apiPatch('/admin/settings', { key: 'default_issue_visibility', value: defaultIssueVisibility.value }), apiPatch('/admin/settings', { key: 'closed_issue_archive_after_days', value: closedIssueArchiveAfterDays.value || 7 }), apiPatch('/admin/settings', { key: 'watermark_mode', value: watermarkMode.value })]); window.dispatchEvent(new CustomEvent('site-config-updated', { detail: { siteName: name, footerText: footer, watermarkMode: watermarkMode.value } })); message.success('站点设置已保存'); } finally { savingSite.value = false; } }
async function toggleStatus(row: any) { await apiPatch(`/admin/users/${row.id}`, { status: row.status === 'active' ? 'disabled' : 'active' }); message.success('用户状态已更新'); loadUsers(); }
async function editGroups(row: any) { if (!groups.value.length) await loadGroups(); selectedUser.value = row; selectedGroups.value = [...row.groups]; showGroups.value = true; }
async function saveGroups() { if (!selectedUser.value) return; savingGroups.value = true; try { const before = new Set<string>(selectedUser.value.groups as string[]); const after = new Set<string>(selectedGroups.value); await Promise.all([...after].filter((key) => !before.has(key)).map((groupKey) => apiPost(`/admin/users/${selectedUser.value.id}/groups`, { groupKey }))); await Promise.all([...before].filter((key) => !after.has(key)).map((groupKey) => apiDelete(`/admin/users/${selectedUser.value.id}/groups/${encodeURIComponent(groupKey)}`))); message.success('权限组已更新'); showGroups.value = false; loadUsers(); } finally { savingGroups.value = false; } }
function openGroupEditor(group?: any) { editingGroup.value = group || null; groupForm.groupKey = group?.groupKey || ''; groupForm.name = group?.name || ''; groupForm.description = group?.description || ''; groupForm.isAssignable = group?.isAssignable ?? true; showGroupEditor.value = true; }
async function saveGroup() { if (!groupForm.name.trim() || (!editingGroup.value && !/^[a-z][a-z0-9_]{1,79}$/.test(groupForm.groupKey))) { message.error('请填写名称和有效的权限组标识'); return; } savingGroup.value = true; try { const input = { name: groupForm.name.trim(), description: groupForm.description.trim() || null, isAssignable: groupForm.isAssignable }; if (editingGroup.value) await apiPatch(`/admin/groups/${encodeURIComponent(editingGroup.value.groupKey)}`, input); else await apiPost('/admin/groups', { ...input, groupKey: groupForm.groupKey }); message.success(editingGroup.value ? '权限组已更新' : '权限组已创建'); showGroupEditor.value = false; loadGroups(); } finally { savingGroup.value = false; } }
function confirmDeleteGroup(group: any) { dialog.error({ title: '删除权限组', content: `确定删除“${group.name}”吗？未被成员或议题使用的自定义权限组才可删除。`, positiveText: '确认删除', negativeText: '取消', onPositiveClick: async () => { try { await apiDelete(`/admin/groups/${encodeURIComponent(group.groupKey)}`); message.success('权限组已删除'); loadGroups(); } catch (error) { message.error(error instanceof Error ? error.message : '删除失败'); return false; } } }); }
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
