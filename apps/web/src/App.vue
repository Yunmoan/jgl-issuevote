<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-dialog-provider>
        <n-layout class="app-shell">
          <n-layout-header bordered class="topbar">
            <RouterLink class="brand" to="/">
              <span class="brand-mark">冀</span>
              <span>冀高联议事投票</span>
            </RouterLink>
            <nav class="topnav">
              <RouterLink to="/">议题</RouterLink>
              <RouterLink v-if="session.canCreateIssue" to="/issues/new">创建</RouterLink>
              <RouterLink v-if="session.isAdmin" to="/admin">管理</RouterLink>
            </nav>
            <div class="top-actions">
              <n-button v-if="!session.viewer && session.providers?.natayarkid.enabled" size="small" type="primary" @click="session.loginWithNatayarkId">
                NatayarkID
              </n-button>
              <n-button v-if="!session.viewer && session.providers?.devLogin" size="small" secondary @click="session.devLogin">
                开发登录
              </n-button>
              <RouterLink v-if="session.viewer" class="viewer-link" to="/me">
                <n-avatar :size="28" :src="session.viewer.avatarUrl || undefined">{{ session.viewer.displayName.slice(0, 1) }}</n-avatar>
                <span>{{ session.viewer.displayName }}</span>
              </RouterLink>
            </div>
          </n-layout-header>
          <n-layout-content class="page">
            <RouterView />
          </n-layout-content>
        </n-layout>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { NAvatar, NButton, NConfigProvider, NDialogProvider, NLayout, NLayoutContent, NLayoutHeader, NMessageProvider } from 'naive-ui';
import { useSessionStore } from './stores/session';

const session = useSessionStore();

const themeOverrides = {
  common: {
    primaryColor: '#1677ff',
    primaryColorHover: '#4096ff',
    primaryColorPressed: '#0958d9',
    primaryColorSuppl: '#1677ff',
    borderRadius: '6px',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  }
};

onMounted(() => {
  session.load().catch(() => undefined);
});
</script>

