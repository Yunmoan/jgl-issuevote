<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <n-loading-bar-provider>
      <n-message-provider>
        <n-dialog-provider>
          <n-layout class="app-shell">
            <n-layout-header bordered class="topbar">
              <div class="topbar-inner">
                <RouterLink class="brand" to="/" :aria-label="siteName">
                  <n-icon :size="28" color="#1677ff"><CheckmarkCircleOutline /></n-icon>
                  <span>{{ siteName }}</span>
                </RouterLink>
                <n-menu class="desktop-menu" mode="horizontal" :value="activeKey" :options="menuOptions" @update:value="navigate" />
                <div class="top-actions">
                  <n-button v-if="!session.viewer && session.providers?.natayarkid.enabled" quaternary @click="session.loginWithNatayarkId">
                    <template #icon><n-icon><LogInOutline /></n-icon></template>登录
                  </n-button>
                  <n-button v-if="!session.viewer && session.providers?.devLogin" quaternary @click="session.devLogin">开发登录</n-button>
                  <RouterLink v-if="session.viewer" class="viewer-link" to="/me">
                    <n-avatar round :size="32" :src="session.viewer.avatarUrl || undefined">{{ session.viewer.displayName.slice(0, 1) }}</n-avatar>
                    <span>{{ session.viewer.displayName }}</span>
                  </RouterLink>
                  <n-button class="mobile-menu-button" quaternary circle aria-label="打开导航" @click="showMobileNav = true">
                    <template #icon><n-icon><MenuOutline /></n-icon></template>
                  </n-button>
                </div>
              </div>
            </n-layout-header>
            <n-layout-content class="page"><RouterView /></n-layout-content>
          </n-layout>
          <n-drawer v-model:show="showMobileNav" placement="right" :width="280">
            <n-drawer-content :title="siteName" closable body-content-style="padding: 8px">
              <n-menu :value="activeKey" :options="menuOptions" @update:value="navigate" />
            </n-drawer-content>
          </n-drawer>
        </n-dialog-provider>
      </n-message-provider>
    </n-loading-bar-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CheckmarkCircleOutline, CreateOutline, DocumentTextOutline, LogInOutline, MenuOutline, PersonOutline, SettingsOutline } from '@vicons/ionicons5';
import { NAvatar, NButton, NConfigProvider, NDialogProvider, NDrawer, NDrawerContent, NIcon, NLayout, NLayoutContent, NLayoutHeader, NLoadingBarProvider, NMenu, NMessageProvider } from 'naive-ui';
import type { MenuOption } from 'naive-ui';
import { apiGet } from './api';
import { useSessionStore } from './stores/session';

const session = useSessionStore();
const route = useRoute();
const router = useRouter();
const siteName = ref('冀高联议事');
const showMobileNav = ref(false);
const themeOverrides = { common: { primaryColor: '#1677ff', primaryColorHover: '#4096ff', primaryColorPressed: '#0958d9', primaryColorSuppl: '#1677ff', borderRadius: '6px', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' } };

function icon(component: any) { return () => h(NIcon, null, { default: () => h(component) }); }
const menuOptions = computed<MenuOption[]>(() => {
  const options: MenuOption[] = [{ label: '议题', key: '/', icon: icon(DocumentTextOutline) }];
  if (session.canCreateIssue) options.push({ label: '创建议题', key: '/issues/new', icon: icon(CreateOutline) });
  if (session.isAdmin) options.push({ label: '管理', key: '/admin', icon: icon(SettingsOutline) });
  if (session.viewer) options.push({ label: '个人中心', key: '/me', icon: icon(PersonOutline) });
  return options;
});
const activeKey = computed(() => route.path.startsWith('/issues/new') ? '/issues/new' : route.path.startsWith('/admin') ? '/admin' : route.path.startsWith('/me') ? '/me' : '/');

function navigate(key: string) { showMobileNav.value = false; router.push(key); }
async function loadSiteConfig() {
  try { siteName.value = (await apiGet<{ siteName: string }>('/site-config')).siteName; } catch { /* A config failure must not block rendering. */ }
}

function updateSiteName(event: Event) {
  const value = (event as CustomEvent<string>).detail;
  if (typeof value === 'string' && value.trim()) siteName.value = value.trim();
}
watch(siteName, (value) => { document.title = value; }, { immediate: true });
onMounted(() => { session.load().catch(() => undefined); loadSiteConfig(); window.addEventListener('site-config-updated', updateSiteName); });
onBeforeUnmount(() => window.removeEventListener('site-config-updated', updateSiteName));
</script>
