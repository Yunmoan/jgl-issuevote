<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-dialog-provider>
        <n-layout class="app-shell">
          <n-layout-header bordered class="topbar">
            <div class="topbar-inner">
              <RouterLink class="brand" to="/">
                <n-icon :size="34">
                  <CheckmarkCircleOutline />
                </n-icon>
                <span>冀高联议事</span>
              </RouterLink>
              <nav class="topnav" aria-label="主导航">
                <RouterLink to="/">
                  <n-button text>议题</n-button>
                </RouterLink>
                <RouterLink v-if="session.canCreateIssue" to="/issues/new">
                  <n-button text>创建</n-button>
                </RouterLink>
                <RouterLink v-if="session.isAdmin" to="/admin">
                  <n-button text>管理</n-button>
                </RouterLink>
              </nav>
              <div class="top-actions">
                <n-button v-if="!session.viewer && session.providers?.natayarkid.enabled" quaternary round @click="session.loginWithNatayarkId">
                  <template #icon>
                    <n-icon><LogInOutline /></n-icon>
                  </template>
                  <span>登录</span>
                </n-button>
                <n-button v-if="!session.viewer && session.providers?.devLogin" size="small" text @click="session.devLogin">
                  开发登录
                </n-button>
                <RouterLink v-if="session.viewer" class="viewer-link" to="/me">
                  <n-avatar :size="34" :src="session.viewer.avatarUrl || undefined">{{ session.viewer.displayName.slice(0, 1) }}</n-avatar>
                  <span>{{ session.viewer.displayName }}</span>
                </RouterLink>
              </div>
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
import { CheckmarkCircleOutline, LogInOutline } from '@vicons/ionicons5';
import { NAvatar, NButton, NConfigProvider, NDialogProvider, NIcon, NLayout, NLayoutContent, NLayoutHeader, NMessageProvider } from 'naive-ui';
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
