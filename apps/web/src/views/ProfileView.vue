<template>
  <main class="content-wrap">
    <div class="page-title"><div><h1>个人中心</h1><p class="page-subtitle">查看你的登录身份和权限归属。</p></div><n-button v-if="session.viewer" secondary @click="session.logout"><template #icon><n-icon><LogOutOutline /></n-icon></template>退出登录</n-button></div>
    <n-card v-if="session.viewer" size="large">
      <n-space vertical size="large">
        <n-space align="center" size="large"><n-avatar round :size="64" :src="session.viewer.avatarUrl || undefined">{{ session.viewer.displayName.slice(0, 1) }}</n-avatar><div><n-h2 style="margin: 0">{{ session.viewer.displayName }}</n-h2><n-text depth="3">{{ session.viewer.email || '未提供邮箱' }}</n-text></div></n-space>
        <n-descriptions label-placement="top" :column="2" responsive="screen" bordered>
          <n-descriptions-item label="账号状态"><n-tag :type="session.viewer.status === 'active' ? 'success' : 'warning'">{{ session.viewer.status === 'active' ? '正常' : session.viewer.status }}</n-tag></n-descriptions-item>
          <n-descriptions-item label="登录身份"><n-space><n-tag v-for="provider in session.viewer.boundProviders" :key="provider" size="small">{{ provider }}</n-tag></n-space></n-descriptions-item>
          <n-descriptions-item label="权限组" :span="2"><n-space><n-tag v-for="group in session.viewer.groups" :key="group" type="info" size="small">{{ group }}</n-tag></n-space></n-descriptions-item>
        </n-descriptions>
        <n-divider />
        <n-space align="center" justify="space-between" :wrap="true"><div><n-text strong>账户绑定</n-text><br /><n-text depth="3">绑定额外身份后，可使用任一已绑定账户登录。</n-text></div><n-button v-if="!session.viewer.boundProviders.includes('natayarkid') && session.providers?.natayarkid.enabled" secondary @click="session.linkNatayarkId"><template #icon><n-icon><LinkOutline /></n-icon></template>绑定 NatayarkID</n-button><n-tag v-else type="success" :bordered="false">NatayarkID 已绑定</n-tag></n-space>
      </n-space>
    </n-card>
    <n-card v-else size="large"><n-empty description="尚未登录" class="login-empty"><template #extra><n-space><n-button v-if="session.providers?.natayarkid.enabled" type="primary" @click="session.loginWithNatayarkId">NatayarkID 登录</n-button><n-button v-if="session.providers?.devLogin" secondary @click="session.devLogin">开发登录</n-button></n-space></template></n-empty></n-card>
  </main>
</template>

<script setup lang="ts">
import { LinkOutline, LogOutOutline } from '@vicons/ionicons5';
import { NAvatar, NButton, NCard, NDescriptions, NDescriptionsItem, NDivider, NEmpty, NH2, NIcon, NSpace, NTag, NText } from 'naive-ui';
import { useSessionStore } from '../stores/session';
const session = useSessionStore();
</script>

<style scoped>.login-empty { padding: 36px 0; }</style>
