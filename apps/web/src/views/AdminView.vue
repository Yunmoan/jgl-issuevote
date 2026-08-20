<template>
  <main class="content-wrap">
    <div class="page-title"><div><h1>管理后台</h1><p class="page-subtitle">管理成员身份、权限边界、站点配置和操作记录。</p></div></div>
    <div class="admin-grid">
      <aside class="admin-navigation">
        <n-select v-if="compactAdminNav" v-model:value="active" class="admin-mobile-select" :options="adminSelectOptions" aria-label="切换管理功能" />
        <n-card v-else class="admin-menu" content-style="padding: 8px" size="small"><n-menu v-model:value="active" :options="menuOptions" /></n-card>
      </aside>
      <section class="admin-content">
        <n-card v-if="active === 'users'" title="用户管理" size="large">
          <template #header-extra><n-button tertiary @click="loadUsers"><template #icon><n-icon><RefreshOutline /></n-icon></template>刷新</n-button></template>
          <n-space class="toolbar" :wrap="true"><n-input v-model:value="q" clearable placeholder="姓名、邮箱或身份标识" @keyup.enter="loadUsers"><template #prefix><n-icon><SearchOutline /></n-icon></template></n-input><n-button type="primary" @click="loadUsers">搜索</n-button></n-space>
          <n-data-table :columns="userColumns" :data="users" :loading="loading" :pagination="{ pageSize: 10 }" :scroll-x="1080" />
        </n-card>

        <n-card v-else-if="active === 'groups'" title="权限组" size="large">
          <template #header-extra><n-space :wrap="true"><n-button tertiary @click="loadGroups"><template #icon><n-icon><RefreshOutline /></n-icon></template>刷新</n-button><n-button :loading="syncingFeishuDepartments" secondary @click="syncFeishuDepartments"><template #icon><n-icon><RefreshOutline /></n-icon></template>同步飞书部门</n-button><n-button type="primary" @click="openGroupEditor()"><template #icon><n-icon><AddOutline /></n-icon></template>新建权限组</n-button></n-space></template>
          <n-alert type="info" :bordered="false" class="card-note">权限组决定议题可见范围和投票资格。飞书部门会同步为只读权限组，飞书用户登录时自动更新所属部门。</n-alert>
          <n-data-table :columns="groupColumns" :data="groups" :loading="loading" :scroll-x="820" />
        </n-card>

        <n-card v-else-if="active === 'labels'" title="议题分类" size="large">
          <template #header-extra><n-space><n-button tertiary @click="loadLabels"><template #icon><n-icon><RefreshOutline /></n-icon></template>刷新</n-button><n-button type="primary" @click="openLabelEditor()"><template #icon><n-icon><AddOutline /></n-icon></template>新建分类</n-button></n-space></template>
          <n-alert type="info" :bordered="false" class="card-note">分类用于组织和筛选议题。已被议题使用的分类不可删除，但可修改名称、颜色和说明。</n-alert>
          <n-data-table :columns="labelColumns" :data="labels" :loading="loading" :scroll-x="760" />
        </n-card>

        <n-card v-else-if="active === 'settings'" title="站点设置" size="large" class="settings-card">
          <template #header-extra><n-button tertiary @click="loadSettings"><template #icon><n-icon><RefreshOutline /></n-icon></template>刷新</n-button></template>
          <section class="settings-section" aria-labelledby="site-settings-heading">
            <div class="settings-section-heading"><h2 id="site-settings-heading">站点与展示</h2><p>用于统一首页、导航栏和议题创建时的默认展示方式。</p></div>
            <n-form label-placement="top" class="settings-form">
            <n-form-item label="站点名称" :feedback="'显示在浏览器标题和全站导航栏中。'">
              <n-input v-model:value="siteName" maxlength="40" show-count placeholder="例如：冀高联事项" />
            </n-form-item>
            <n-form-item label="新议题默认可见性"><n-select v-model:value="defaultIssueVisibility" :options="visibilityOptions" /></n-form-item>
            <n-form-item class="settings-span-full" label="站点简介"><n-input v-model:value="siteDescription" maxlength="160" show-count placeholder="显示在议题列表标题下方" /></n-form-item>
            <n-form-item class="settings-span-full" label="站点公告"><n-input v-model:value="siteNotice" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" placeholder="留空则不显示公告" /></n-form-item>
            <n-form-item class="settings-span-full" label="页脚版权标识"><n-input v-model:value="footerText" maxlength="160" show-count placeholder="例如：Copyright 2026 冀高联事项" /></n-form-item>
            <n-form-item label="已关闭议题自动归档"><n-input-number v-model:value="closedIssueArchiveAfterDays" :min="1" :max="3650" clearable><template #suffix>天后</template></n-input-number></n-form-item>
            <n-form-item label="水印显示"><n-select v-model:value="watermarkMode" :options="watermarkOptions" /></n-form-item>
            <div class="settings-time-presets settings-span-full">
              <n-form-item label="议题短周期"><n-input-number v-model:value="timePresets.discussionShortDays" :min="1" :max="365"><template #suffix>天</template></n-input-number></n-form-item>
              <n-form-item label="议题长周期"><n-input-number v-model:value="timePresets.discussionLongDays" :min="1" :max="365"><template #suffix>天</template></n-input-number></n-form-item>
              <n-form-item label="即时投票"><n-input-number v-model:value="timePresets.voteInstantMinutes" :min="1" :max="43200"><template #suffix>分钟</template></n-input-number></n-form-item>
              <n-form-item label="短周期投票"><n-input-number v-model:value="timePresets.voteShortMinutes" :min="1" :max="43200"><template #suffix>分钟</template></n-input-number></n-form-item>
              <n-form-item label="长周期投票"><n-input-number v-model:value="timePresets.voteLongMinutes" :min="1" :max="43200"><template #suffix>分钟</template></n-input-number></n-form-item>
            </div>
              <div class="settings-actions settings-span-full"><n-button type="primary" :loading="savingSite" @click="saveSiteName"><template #icon><n-icon><SaveOutline /></n-icon></template>保存站点设置</n-button></div>
            </n-form>
          </section>
          <n-divider />
          <section class="settings-section" aria-labelledby="review-settings-heading">
            <div class="settings-section-heading"><h2 id="review-settings-heading">议题预审</h2><p>选择创建议题时使用的预审流程，并在启用 AI 时维护模型连接。</p></div>
            <n-form label-placement="top" class="settings-form">
            <n-form-item class="settings-span-full" label="新议题预审方式" :feedback="'关闭：直接发布；手动：普通成员提交后由其他成员审批；AI：在创建第 1 步自动审核。'">
              <n-select v-model:value="aiReviewMode" :options="aiReviewModeOptions" />
            </n-form-item>
            <template v-if="aiReviewMode === 'ai'">
              <n-alert type="warning" :bordered="false" class="card-note settings-span-full">AI 预审用于初步筛查，不能替代专业法律意见。模型服务地址须兼容 OpenAI 的 <code>/chat/completions</code> 接口；Qwen3-8B 可直接使用。</n-alert>
              <n-form-item class="settings-span-full" label="AI 服务地址" :feedback="'填写 OpenAI 兼容 API 的基础地址，例如 http://127.0.0.1:8000/v1 或完整的 /chat/completions 地址。'"><n-input v-model:value="aiEndpoint" maxlength="500" placeholder="https://your-ai-service/v1" /></n-form-item>
              <n-form-item label="模型名称"><n-input v-model:value="aiModel" maxlength="160" placeholder="Qwen3-8B" /></n-form-item>
              <n-form-item label="API 密钥" :feedback="aiApiKeyConfigured ? '已保存密钥。留空会保留原密钥。' : '本地模型服务如未启用鉴权可留空。'"><n-input v-model:value="aiApiKey" type="password" show-password-on="click" autocomplete="new-password" maxlength="2000" placeholder="留空以保留现有密钥" /></n-form-item>
              <n-form-item v-if="aiApiKeyConfigured" class="settings-span-full" label="清除已保存的 API 密钥"><n-switch v-model:value="clearAiApiKey" /></n-form-item>
              <n-form-item class="settings-span-full" label="额外预审条件" :feedback="'这段提示词会与法律法规初步筛查一同发送给模型，用于定义独立的组织规则。'"><n-input v-model:value="aiPolicyPrompt" type="textarea" :autosize="{ minRows: 4, maxRows: 10 }" maxlength="6000" show-count placeholder="例如：议题必须说明预算来源，且不得包含个人隐私信息。" /></n-form-item>
            </template>
              <div class="settings-actions settings-span-full"><n-button type="primary" :loading="savingAiReview" @click="saveAiReviewSettings"><template #icon><n-icon><SaveOutline /></n-icon></template>保存预审设置</n-button><n-button v-if="aiReviewMode === 'ai'" :loading="testingAiReview" @click="testAiReviewSettings">测试 AI 连接</n-button></div>
            </n-form>
          </section>
          <n-divider />
          <n-alert type="info" :bordered="false">身份认证密钥只从部署环境变量读取。AI API 密钥保存在系统设置中，后台不会返回其明文。</n-alert>
        </n-card>

        <n-card v-else title="审计日志" size="large">
          <template #header-extra><n-button tertiary @click="loadAudit"><template #icon><n-icon><RefreshOutline /></n-icon></template>刷新</n-button></template>
          <n-data-table :columns="auditColumns" :data="auditLogs" :loading="loading" :pagination="{ pageSize: 12 }" :scroll-x="720" />
        </n-card>
      </section>
    </div>

    <n-modal v-model:show="showGroups" preset="card" title="调整用户权限组" :style="{ width: 'min(480px, calc(100vw - 24px))' }" :bordered="false">
      <p v-if="selectedUser" class="selected-user">{{ selectedUser.displayName }} <span>{{ selectedUser.email || '未提供邮箱' }}</span></p>
      <n-checkbox-group v-model:value="selectedGroups" class="group-checks"><n-space vertical><n-checkbox v-for="group in groups" :key="group.groupKey" :value="group.groupKey" :disabled="group.kind === 'feishu_org'" :label="group.name" /></n-space></n-checkbox-group>
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

    <n-modal v-model:show="showLabelEditor" preset="card" :title="editingLabel ? '编辑议题分类' : '新建议题分类'" :style="{ width: 'min(520px, calc(100vw - 24px))' }" :bordered="false">
      <n-form label-placement="top">
        <n-form-item label="分类名称"><n-input v-model:value="labelForm.name" maxlength="40" show-count placeholder="例如：财务" /></n-form-item>
        <n-form-item label="分类颜色"><n-color-picker v-model:value="labelForm.color" :show-alpha="false" /></n-form-item>
        <n-form-item label="说明"><n-input v-model:value="labelForm.description" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" maxlength="200" /></n-form-item>
      </n-form>
      <template #footer><n-space justify="end"><n-button @click="showLabelEditor = false">取消</n-button><n-button type="primary" :loading="savingLabel" @click="saveLabel">保存</n-button></n-space></template>
    </n-modal>
  </main>
</template>

<script setup lang="ts">
import { h, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { AddOutline, BookOutline, PeopleOutline, PricetagOutline, RefreshOutline, SaveOutline, SearchOutline, SettingsOutline, ShieldCheckmarkOutline } from '@vicons/ionicons5';
import { NAlert, NButton, NCard, NCheckbox, NCheckboxGroup, NColorPicker, NDataTable, NDivider, NForm, NFormItem, NIcon, NInput, NInputNumber, NMenu, NModal, NSelect, NSpace, NSwitch, NTag, useDialog, useMessage } from 'naive-ui';
import type { DataTableColumns, MenuOption } from 'naive-ui';
import { apiDelete, apiGet, apiPatch, apiPost } from '../api';
import { displayAuditAction, displayGroup, displayProvider } from '../presentation';

const message = useMessage();
const dialog = useDialog();
const active = ref('users'); const q = ref(''); const loading = ref(false); const users = ref<any[]>([]); const groups = ref<any[]>([]); const labels = ref<any[]>([]); const auditLogs = ref<any[]>([]);
const siteName = ref('冀高联事项'); const siteDescription = ref(''); const siteNotice = ref(''); const footerText = ref(''); const defaultIssueVisibility = ref('login'); const closedIssueArchiveAfterDays = ref<number | null>(7); const watermarkMode = ref('off'); const timePresets = reactive({ discussionShortDays: 3, discussionLongDays: 5, voteInstantMinutes: 10, voteShortMinutes: 60, voteLongMinutes: 1440 }); const savingSite = ref(false); const aiReviewMode = ref<'disabled' | 'manual' | 'ai'>('manual'); const aiEndpoint = ref(''); const aiModel = ref('Qwen3-8B'); const aiApiKey = ref(''); const aiApiKeyConfigured = ref(false); const clearAiApiKey = ref(false); const aiPolicyPrompt = ref(''); const savingAiReview = ref(false); const testingAiReview = ref(false); const showGroups = ref(false); const selectedUser = ref<any>(null); const selectedGroups = ref<string[]>([]); const savingGroups = ref(false);
const showGroupEditor = ref(false); const editingGroup = ref<any>(null); const savingGroup = ref(false); const groupForm = reactive({ groupKey: '', name: '', description: '', isAssignable: true });
const showLabelEditor = ref(false); const editingLabel = ref<any>(null); const savingLabel = ref(false); const syncingFeishuDepartments = ref(false); const syncingFeishuUserId = ref<string | null>(null); const labelForm = reactive({ name: '', color: '#1677ff', description: '' });
const visibilityOptions = [{ label: '公开可见', value: 'public' }, { label: '登录可见', value: 'login' }, { label: '指定权限组可见', value: 'groups' }];
const watermarkOptions = [{ label: '关闭', value: 'off' }, { label: '全局水印', value: 'global' }, { label: '仅议题页水印', value: 'issue' }];
const aiReviewModeOptions = [{ label: '关闭预审', value: 'disabled' }, { label: '手动预审', value: 'manual' }, { label: 'AI 自动预审', value: 'ai' }];
const compactAdminNav = ref(false);
const adminSelectOptions = [{ label: '用户管理', value: 'users' }, { label: '权限组', value: 'groups' }, { label: '议题分类', value: 'labels' }, { label: '站点设置', value: 'settings' }, { label: '审计日志', value: 'audit' }];
const menuOptions: MenuOption[] = [
  { label: '用户管理', key: 'users', icon: () => h(NIcon, null, { default: () => h(PeopleOutline) }) },
  { label: '权限组', key: 'groups', icon: () => h(NIcon, null, { default: () => h(ShieldCheckmarkOutline) }) },
  { label: '议题分类', key: 'labels', icon: () => h(NIcon, null, { default: () => h(PricetagOutline) }) },
  { label: '站点设置', key: 'settings', icon: () => h(NIcon, null, { default: () => h(SettingsOutline) }) },
  { label: '审计日志', key: 'audit', icon: () => h(NIcon, null, { default: () => h(BookOutline) }) }
];
const userColumns: DataTableColumns<any> = [
  { title: '用户', key: 'displayName', width: 180, render: (row) => h('div', [h('strong', row.displayName), row.email ? h('div', { class: 'table-secondary' }, row.email) : null]) },
  { title: '权限组', key: 'groups', minWidth: 190, render: (row) => h('div', { class: 'tag-line' }, (row.groupDetails || row.groups.map((group: string) => ({ groupKey: group, name: displayGroup(group) }))).map((group: { groupKey: string; name: string }) => h(NTag, { size: 'small', type: group.groupKey === 'admin' ? 'error' : 'info' }, { default: () => group.name }))) },
  { title: '身份源', key: 'boundProviders', width: 150, render: (row) => h('div', { class: 'tag-line' }, row.boundProviders.map((provider: string) => h(NTag, { size: 'small', bordered: false }, { default: () => displayProvider(provider) }))) },
  { title: '状态', key: 'status', width: 96, render: (row) => h(NTag, { type: row.status === 'active' ? 'success' : 'warning' }, { default: () => row.status === 'active' ? '正常' : '已禁用' }) },
  { title: '操作', key: 'actions', width: 260, fixed: 'right', render: (row) => h(NSpace, { size: 6 }, { default: () => [h(NButton, { size: 'small', tertiary: true, onClick: () => editGroups(row) }, { default: () => '权限组' }), row.boundProviders.includes('feishu') ? h(NButton, { size: 'small', tertiary: true, loading: syncingFeishuUserId.value === row.id, onClick: () => syncFeishuUserDepartments(row) }, { default: () => '同步飞书' }) : null, h(NButton, { size: 'small', tertiary: true, type: row.status === 'active' ? 'warning' : 'success', onClick: () => toggleStatus(row) }, { default: () => row.status === 'active' ? '禁用' : '启用' })] }) }
];
const groupColumns: DataTableColumns<any> = [
  { title: '名称', key: 'name', width: 160 }, { title: '标识', key: 'groupKey', width: 150 }, { title: '类型', key: 'kind', width: 110, render: (row) => h(NTag, { size: 'small', bordered: false }, { default: () => row.kind === 'system' ? '系统' : row.kind === 'feishu_org' ? '飞书部门' : '自定义' }) }, { title: '说明', key: 'description', minWidth: 220 },
  { title: '操作', key: 'actions', width: 150, fixed: 'right', render: (row) => row.kind === 'custom' ? h(NSpace, { size: 6 }, { default: () => [h(NButton, { size: 'small', tertiary: true, onClick: () => openGroupEditor(row) }, { default: () => '编辑' }), h(NButton, { size: 'small', tertiary: true, type: 'error', onClick: () => confirmDeleteGroup(row) }, { default: () => '删除' })] }) : h(NTag, { size: 'small', bordered: false }, { default: () => '受保护' }) }
];
const labelColumns: DataTableColumns<any> = [
  { title: '分类', key: 'name', width: 170, render: (row) => h(NTag, { size: 'small', bordered: false, color: { color: `${row.color}1f`, textColor: row.color } }, { default: () => row.name }) },
  { title: '说明', key: 'description', minWidth: 220, render: (row) => row.description || '未填写' },
  { title: '使用议题', key: 'issueCount', width: 110, render: (row) => `${row.issueCount} 个` },
  { title: '操作', key: 'actions', width: 150, fixed: 'right', render: (row) => h(NSpace, { size: 6 }, { default: () => [h(NButton, { size: 'small', tertiary: true, onClick: () => openLabelEditor(row) }, { default: () => '编辑' }), h(NButton, { size: 'small', tertiary: true, type: 'error', disabled: row.issueCount > 0, onClick: () => confirmDeleteLabel(row) }, { default: () => '删除' })] }) }
];
const auditColumns: DataTableColumns<any> = [{ title: '时间', key: 'createdAt', width: 180, render: (row) => new Date(row.createdAt).toLocaleString('zh-CN') }, { title: '操作者', key: 'actorName', width: 140 }, { title: '动作', key: 'action', minWidth: 180, render: (row) => displayAuditAction(row.action) }, { title: '对象', key: 'targetId', minWidth: 180 }];

async function request<T>(work: () => Promise<T>) { loading.value = true; try { return await work(); } finally { loading.value = false; } }
async function loadUsers() { users.value = await request(async () => apiGet(`/admin/users?${q.value ? new URLSearchParams({ q: q.value }) : ''}`)); }
async function loadGroups() { groups.value = await request(() => apiGet('/admin/groups')); }
async function syncFeishuDepartments() { syncingFeishuDepartments.value = true; try { const result = await apiPost<{ synced: number; created: number; updated: number }>('/admin/feishu/departments/sync'); message.success(`已同步 ${result.synced} 个飞书部门，新增 ${result.created} 个`); await loadGroups(); } catch (error) { message.error(error instanceof Error ? error.message : '飞书部门同步失败'); } finally { syncingFeishuDepartments.value = false; } }
async function syncFeishuUserDepartments(row: any) { syncingFeishuUserId.value = row.id; try { await apiPost(`/admin/users/${row.id}/feishu-departments/sync`); await loadUsers(); message.success(`已同步 ${row.displayName} 的飞书部门`); } catch (error) { message.error(error instanceof Error ? error.message : '飞书部门同步失败'); } finally { syncingFeishuUserId.value = null; } }
async function loadLabels() { labels.value = await request(() => apiGet('/admin/labels')); }
async function loadAudit() { auditLogs.value = await request(() => apiGet('/admin/audit-logs')); }
async function loadSettings() { const [settings, aiSettings] = await request(() => Promise.all([apiGet<Array<{ key: string; value: unknown }>>('/admin/settings'), apiGet<{ mode: 'disabled' | 'manual' | 'ai'; endpoint: string; model: string; policyPrompt: string; apiKeyConfigured: boolean }>('/admin/ai-review-settings')])); const value = (key: string, fallback: unknown = ''): unknown => settings.find((setting) => setting.key === key)?.value ?? fallback; siteName.value = String(value('site_name', '冀高联事项')); siteDescription.value = String(value('site_description')); siteNotice.value = String(value('site_notice')); footerText.value = String(value('footer_text')); defaultIssueVisibility.value = String(value('default_issue_visibility', 'login')); closedIssueArchiveAfterDays.value = Number(value('closed_issue_archive_after_days', 7)); watermarkMode.value = String(value('watermark_mode', 'off')); const savedPresets = value('issue_time_presets', {}) as Record<string, unknown>; timePresets.discussionShortDays = presetNumber(savedPresets.discussionShortDays, 3); timePresets.discussionLongDays = presetNumber(savedPresets.discussionLongDays, 5); timePresets.voteInstantMinutes = presetNumber(savedPresets.voteInstantMinutes, 10); timePresets.voteShortMinutes = presetNumber(savedPresets.voteShortMinutes, 60); timePresets.voteLongMinutes = presetNumber(savedPresets.voteLongMinutes, 1440); aiReviewMode.value = aiSettings.mode; aiEndpoint.value = aiSettings.endpoint; aiModel.value = aiSettings.model; aiPolicyPrompt.value = aiSettings.policyPrompt; aiApiKey.value = ''; aiApiKeyConfigured.value = aiSettings.apiKeyConfigured; clearAiApiKey.value = false; }
async function saveSiteName() { if (!siteName.value.trim()) return; if (!validTimePresets()) { message.error('请按从短到长的顺序设置有效的议题与投票周期'); return; } savingSite.value = true; try { const name = siteName.value.trim(); const footer = footerText.value.trim(); await Promise.all([apiPatch('/admin/settings', { key: 'site_name', value: name }), apiPatch('/admin/settings', { key: 'site_description', value: siteDescription.value.trim() }), apiPatch('/admin/settings', { key: 'site_notice', value: siteNotice.value.trim() }), apiPatch('/admin/settings', { key: 'footer_text', value: footer }), apiPatch('/admin/settings', { key: 'default_issue_visibility', value: defaultIssueVisibility.value }), apiPatch('/admin/settings', { key: 'closed_issue_archive_after_days', value: closedIssueArchiveAfterDays.value || 7 }), apiPatch('/admin/settings', { key: 'watermark_mode', value: watermarkMode.value }), apiPatch('/admin/settings', { key: 'issue_time_presets', value: { ...timePresets } })]); window.dispatchEvent(new CustomEvent('site-config-updated', { detail: { siteName: name, footerText: footer, watermarkMode: watermarkMode.value } })); message.success('站点设置已保存'); } finally { savingSite.value = false; } }
function presetNumber(value: unknown, fallback: number) { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback; }
function validTimePresets() { const values = Object.values(timePresets); return values.every((value) => Number.isInteger(value) && value >= 1 && value <= 43200) && timePresets.discussionShortDays <= timePresets.discussionLongDays && timePresets.voteInstantMinutes <= timePresets.voteShortMinutes && timePresets.voteShortMinutes <= timePresets.voteLongMinutes; }
async function saveAiReviewSettings() { if (aiReviewMode.value === 'ai' && (!aiEndpoint.value.trim() || !aiModel.value.trim())) { message.error('启用 AI 预审时请填写 AI 服务地址和模型名称'); return; } savingAiReview.value = true; try { const result = await apiPatch<{ apiKeyConfigured: boolean }>('/admin/ai-review-settings', { mode: aiReviewMode.value, endpoint: aiEndpoint.value.trim(), model: aiModel.value.trim() || 'Qwen3-8B', apiKey: aiApiKey.value || undefined, clearApiKey: clearAiApiKey.value, policyPrompt: aiPolicyPrompt.value.trim() }); aiApiKey.value = ''; aiApiKeyConfigured.value = result.apiKeyConfigured; clearAiApiKey.value = false; window.dispatchEvent(new CustomEvent('site-config-updated', { detail: { issueReviewMode: aiReviewMode.value } })); message.success('预审设置已保存'); } finally { savingAiReview.value = false; } }
async function testAiReviewSettings() { testingAiReview.value = true; try { const result = await apiPost<{ model: string; message: string }>('/admin/ai-review-settings/test'); message.success(`AI 连接成功：${result.model}${result.message ? `（${result.message}）` : ''}`); } catch (error) { message.error(error instanceof Error ? `AI 连接失败：${error.message}` : 'AI 连接失败'); } finally { testingAiReview.value = false; } }
async function toggleStatus(row: any) { await apiPatch(`/admin/users/${row.id}`, { status: row.status === 'active' ? 'disabled' : 'active' }); message.success('用户状态已更新'); loadUsers(); }
async function editGroups(row: any) { if (!groups.value.length) await loadGroups(); selectedUser.value = row; selectedGroups.value = [...row.groups]; showGroups.value = true; }
async function saveGroups() { if (!selectedUser.value) return; savingGroups.value = true; try { const before = new Set<string>(selectedUser.value.groups as string[]); const after = new Set<string>(selectedGroups.value); await Promise.all([...after].filter((key) => !before.has(key)).map((groupKey) => apiPost(`/admin/users/${selectedUser.value.id}/groups`, { groupKey }))); await Promise.all([...before].filter((key) => !after.has(key)).map((groupKey) => apiDelete(`/admin/users/${selectedUser.value.id}/groups/${encodeURIComponent(groupKey)}`))); message.success('权限组已更新'); showGroups.value = false; loadUsers(); } finally { savingGroups.value = false; } }
function openGroupEditor(group?: any) { editingGroup.value = group || null; groupForm.groupKey = group?.groupKey || ''; groupForm.name = group?.name || ''; groupForm.description = group?.description || ''; groupForm.isAssignable = group?.isAssignable ?? true; showGroupEditor.value = true; }
async function saveGroup() { if (!groupForm.name.trim() || (!editingGroup.value && !/^[a-z][a-z0-9_]{1,79}$/.test(groupForm.groupKey))) { message.error('请填写名称和有效的权限组标识'); return; } savingGroup.value = true; try { const input = { name: groupForm.name.trim(), description: groupForm.description.trim() || null, isAssignable: groupForm.isAssignable }; if (editingGroup.value) await apiPatch(`/admin/groups/${encodeURIComponent(editingGroup.value.groupKey)}`, input); else await apiPost('/admin/groups', { ...input, groupKey: groupForm.groupKey }); message.success(editingGroup.value ? '权限组已更新' : '权限组已创建'); showGroupEditor.value = false; loadGroups(); } finally { savingGroup.value = false; } }
function confirmDeleteGroup(group: any) { dialog.error({ title: '删除权限组', content: `确定删除“${group.name}”吗？未被成员或议题使用的自定义权限组才可删除。`, positiveText: '确认删除', negativeText: '取消', onPositiveClick: async () => { try { await apiDelete(`/admin/groups/${encodeURIComponent(group.groupKey)}`); message.success('权限组已删除'); loadGroups(); } catch (error) { message.error(error instanceof Error ? error.message : '删除失败'); return false; } } }); }
function openLabelEditor(label?: any) { editingLabel.value = label || null; labelForm.name = label?.name || ''; labelForm.color = label?.color || '#1677ff'; labelForm.description = label?.description || ''; showLabelEditor.value = true; }
async function saveLabel() { if (!labelForm.name.trim()) { message.error('请填写分类名称'); return; } savingLabel.value = true; try { const input = { name: labelForm.name.trim(), color: labelForm.color, description: labelForm.description.trim() || null }; if (editingLabel.value) await apiPatch(`/admin/labels/${editingLabel.value.id}`, input); else await apiPost('/admin/labels', input); message.success(editingLabel.value ? '分类已更新' : '分类已创建'); showLabelEditor.value = false; loadLabels(); } finally { savingLabel.value = false; } }
function confirmDeleteLabel(label: any) { dialog.error({ title: '删除议题分类', content: `确定删除“${label.name}”吗？删除后不可恢复。`, positiveText: '确认删除', negativeText: '取消', onPositiveClick: async () => { try { await apiDelete(`/admin/labels/${label.id}`); message.success('分类已删除'); loadLabels(); } catch (error) { message.error(error instanceof Error ? error.message : '删除失败'); return false; } } }); }
async function loadActive() { if (active.value === 'users') await loadUsers(); if (active.value === 'groups') await loadGroups(); if (active.value === 'labels') await loadLabels(); if (active.value === 'settings') await loadSettings(); if (active.value === 'audit') await loadAudit(); }
function updateAdminNavigationMode() { compactAdminNav.value = window.matchMedia('(max-width: 980px)').matches; }
watch(active, loadActive);
onMounted(() => { updateAdminNavigationMode(); window.addEventListener('resize', updateAdminNavigationMode); loadActive(); });
onBeforeUnmount(() => window.removeEventListener('resize', updateAdminNavigationMode));
</script>

<style scoped>
.toolbar :deep(.n-input) { width: 300px; }
.card-note { margin-bottom: 18px; }
.settings-section { max-width: 900px; }
.settings-section-heading { margin: 0 0 20px; }
.settings-section-heading h2 { margin: 0; color: inherit; font-size: 18px; font-weight: 650; line-height: 1.4; }
.settings-section-heading p { margin: 5px 0 0; color: inherit; font-size: 14px; line-height: 1.6; opacity: .72; }
.settings-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 18px; max-width: 900px; }
.settings-span-full { grid-column: 1 / -1; }
.settings-time-presets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 18px; }
.settings-time-presets :deep(.n-form-item) { min-width: 0; }
.settings-form :deep(.n-input-number) { width: 100%; }
.settings-actions { display: flex; flex-wrap: wrap; gap: 10px; padding-top: 2px; }
.selected-user { margin-top: 0; color: inherit; font-weight: 600; }.selected-user span { display: block; margin-top: 4px; color: inherit; opacity: .72; font-size: 13px; font-weight: 400; }
.group-checks { padding: 8px 0; }
:deep(.table-secondary) { margin-top: 3px; color: inherit; opacity: .72; font-size: 12px; }
@media (max-width: 980px) { .admin-mobile-select { width: 100%; } }
@media (max-width: 640px) { .settings-form, .settings-time-presets { grid-template-columns: minmax(0, 1fr); } .settings-span-full { grid-column: auto; } .admin-content :deep(.n-card-header) { align-items: flex-start; flex-wrap: wrap; row-gap: 12px; } .admin-content :deep(.n-card-header__main) { flex: 0 0 100%; width: 100%; } .admin-content :deep(.n-card-header__extra) { width: 100%; margin-left: 0; } .admin-content :deep(.n-card-header__extra .n-space) { width: 100%; } .settings-card :deep(.n-card__content) { padding: 16px !important; } .settings-section-heading { margin-bottom: 16px; } }
@media (max-width: 540px) { .toolbar { display: grid; grid-template-columns: 1fr auto; } .toolbar :deep(.n-input) { width: 100%; } .settings-actions > .n-button { flex: 1 1 auto; } }
</style>
