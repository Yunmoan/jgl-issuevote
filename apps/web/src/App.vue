<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN">
    <n-loading-bar-provider>
      <n-message-provider>
        <n-dialog-provider>
          <n-layout class="app-shell" :class="{ 'is-dark': resolvedTheme === 'dark' }">
            <n-layout-header bordered class="topbar">
              <div class="topbar-inner">
                <RouterLink class="brand" to="/" :aria-label="siteName">
                  <n-icon :size="28" color="#1677ff"><CheckmarkCircleOutline /></n-icon>
                  <span>{{ siteName }}</span>
                </RouterLink>
                <n-menu class="desktop-menu" mode="horizontal" :value="activeKey" :options="menuOptions" @update:value="navigate" />
                <div class="top-actions">
                  <n-tooltip><template #trigger><n-button quaternary circle :aria-label="themeLabel" @click="cycleTheme"><template #icon><n-icon><component :is="themeIcon" /></n-icon></template></n-button></template>{{ themeLabel }}</n-tooltip>
                  <n-button v-if="!session.viewer && session.providers?.natayarkid.enabled" quaternary @click="session.loginWithNatayarkId"><template #icon><n-icon><LogInOutline /></n-icon></template>登录</n-button>
                  <n-button v-if="!session.viewer && session.providers?.devLogin" quaternary @click="session.devLogin">开发登录</n-button>
                  <RouterLink v-if="session.viewer" class="viewer-link" to="/me">
                    <n-avatar round :size="32" :src="session.viewer.avatarUrl || undefined">{{ session.viewer.displayName.slice(0, 1) }}</n-avatar>
                    <span>{{ session.viewer.displayName }}</span>
                  </RouterLink>
                  <n-button class="mobile-menu-button" quaternary circle aria-label="打开导航" @click="showMobileNav = true"><template #icon><n-icon><MenuOutline /></n-icon></template></n-button>
                </div>
              </div>
            </n-layout-header>
            <n-layout-content class="page">
              <RouterView v-slot="{ Component }"><Transition name="page-fade"><component :is="Component" :key="route.fullPath" /></Transition></RouterView>
              <Transition name="skeleton-fade">
                <div v-if="routeLoading" class="page-skeleton-overlay">
                  <div class="page-skeleton content-wrap">
                    <n-skeleton text :repeat="1" width="26%" size="medium" />
                    <n-skeleton text :repeat="1" width="48%" />
                    <div class="skeleton-panel"><n-skeleton text :repeat="5" /></div>
                    <div class="skeleton-panel"><n-skeleton text :repeat="3" /></div>
                  </div>
                </div>
              </Transition>
            </n-layout-content>
            <n-layout-footer bordered class="site-footer"><div>{{ footerText }} / Developed by 云默安 <a href="//www.zyghit.cn" target="_blank">@ZGIT</a></div> 这是一个开源软件： <a href="https://github.com/Yunmoan/jgl-issuevote" target="_blank">Github仓库</a> · 欢迎提交代码或反馈意见 </n-layout-footer>
          </n-layout>
          <n-watermark v-if="showWatermark" cross fullscreen :selectable="false" :content="watermarkContent" :font-size="16" :line-height="16" :rotate="-15" :width="800" :height="500" :x-offset="12" :y-offset="60" />
          <n-drawer v-model:show="showMobileNav" placement="right" :width="280">
            <n-drawer-content :title="siteName" closable body-content-style="padding: 8px"><n-menu :value="activeKey" :options="menuOptions" @update:value="navigate" /></n-drawer-content>
          </n-drawer>
        </n-dialog-provider>
      </n-message-provider>
    </n-loading-bar-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CheckmarkCircleOutline, ClipboardOutline, CreateOutline, DesktopOutline, DocumentTextOutline, LogInOutline, MenuOutline, MoonOutline, PersonOutline, SettingsOutline, SunnyOutline } from '@vicons/ionicons5';
import { darkTheme, dateZhCN, NAvatar, NButton, NConfigProvider, NDialogProvider, NDrawer, NDrawerContent, NIcon, NLayout, NLayoutContent, NLayoutFooter, NLayoutHeader, NLoadingBarProvider, NMenu, NMessageProvider, NSkeleton, NTooltip, NWatermark, zhCN } from 'naive-ui';
import type { MenuOption } from 'naive-ui';
import { apiGet } from './api';
import { useSessionStore } from './stores/session';

type ThemePreference = 'system' | 'light' | 'dark';
type WatermarkMode = 'off' | 'global' | 'issue';

const session = useSessionStore();
const route = useRoute();
const router = useRouter();
const siteName = ref('冀高联事项');
const footerText = ref(`版权所有 © ${new Date().getFullYear()} 冀高联事项`);
const watermarkMode = ref<WatermarkMode>('off');
const showMobileNav = ref(false);
const routeLoading = ref(false);
const prefersDark = ref(false);
let systemThemeQuery: MediaQueryList | null = null;
let routeLoadingTimer: number | null = null;
let routeLoadingDelayTimer: number | null = null;
const themePreference = ref<ThemePreference>(readThemePreference());
const resolvedTheme = computed(() => themePreference.value === 'system' ? (prefersDark.value ? 'dark' : 'light') : themePreference.value);
const naiveTheme = computed(() => resolvedTheme.value === 'dark' ? darkTheme : null);
const themeIcon = computed(() => themePreference.value === 'system' ? DesktopOutline : themePreference.value === 'light' ? SunnyOutline : MoonOutline);
const themeLabel = computed(() => ({ system: '跟随系统', light: '浅色模式', dark: '深色模式' })[themePreference.value]);
const showWatermark = computed(() => watermarkMode.value === 'global' || (watermarkMode.value === 'issue' && route.path.startsWith('/issues/')));
const watermarkContent = computed(() => session.viewer ? `${siteName.value}\n用户 ${session.viewer.displayName}` : siteName.value);
const themeOverrides = { common: { primaryColor: '#1677ff', primaryColorHover: '#4096ff', primaryColorPressed: '#0958d9', primaryColorSuppl: '#1677ff', borderRadius: '6px', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' } };

function icon(component: any) { return () => h(NIcon, null, { default: () => h(component) }); }
const menuOptions = computed<MenuOption[]>(() => {
  const options: MenuOption[] = [{ label: '议题', key: '/', icon: icon(DocumentTextOutline) }];
  if (session.canCreateIssue) options.push({ label: '创建议题', key: '/issues/new', icon: icon(CreateOutline) });
  if (session.canReviewIssueSubmissions) options.push({ label: '预审', key: '/reviews', icon: icon(ClipboardOutline) });
  if (session.isAdmin) options.push({ label: '管理', key: '/admin', icon: icon(SettingsOutline) });
  if (session.viewer) options.push({ label: '个人中心', key: '/me', icon: icon(PersonOutline) });
  return options;
});
const activeKey = computed(() => route.path.startsWith('/issues/new') ? '/issues/new' : route.path.startsWith('/reviews') ? '/reviews' : route.path.startsWith('/admin') ? '/admin' : route.path.startsWith('/me') ? '/me' : '/');

function navigate(key: string) { showMobileNav.value = false; router.push(key); }
function setTheme(value: ThemePreference) { themePreference.value = value; localStorage.setItem('jgl-theme-preference', value); }
function cycleTheme() { setTheme(themePreference.value === 'system' ? 'light' : themePreference.value === 'light' ? 'dark' : 'system'); }
function readThemePreference(): ThemePreference { const value = localStorage.getItem('jgl-theme-preference'); return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'; }
async function loadSiteConfig() {
  try {
    const config = await apiGet<{ siteName: string; footerText?: string; watermarkMode?: WatermarkMode }>('/site-config');
    siteName.value = config.siteName;
    footerText.value = config.footerText || footerText.value;
    watermarkMode.value = config.watermarkMode || 'off';
  } catch { /* A config failure must not block rendering. */ }
}
function updateSiteConfig(event: Event) { const value = (event as CustomEvent<Partial<{ siteName: string; footerText: string; watermarkMode: WatermarkMode }>>).detail; if (value?.siteName?.trim()) siteName.value = value.siteName.trim(); if (typeof value?.footerText === 'string') footerText.value = value.footerText.trim() || `版权所有 © ${new Date().getFullYear()} ${siteName.value}`; if (value?.watermarkMode) watermarkMode.value = value.watermarkMode; }
function updateSystemTheme(event: MediaQueryListEvent) { prefersDark.value = event.matches; }
const removeBeforeNavigation = router.beforeEach(() => {
  if (routeLoadingTimer !== null) window.clearTimeout(routeLoadingTimer);
  if (routeLoadingDelayTimer !== null) window.clearTimeout(routeLoadingDelayTimer);
  routeLoading.value = false;
  routeLoadingDelayTimer = window.setTimeout(() => { routeLoading.value = true; routeLoadingDelayTimer = null; }, 180);
});
const removeAfterNavigation = router.afterEach(() => {
  if (routeLoadingDelayTimer !== null) window.clearTimeout(routeLoadingDelayTimer);
  routeLoadingDelayTimer = null;
  if (routeLoading.value) routeLoadingTimer = window.setTimeout(() => { routeLoading.value = false; routeLoadingTimer = null; }, 80);
});
watch(siteName, (value) => { document.title = value; }, { immediate: true });
watch(resolvedTheme, (value) => { document.documentElement.style.colorScheme = value; });
onMounted(() => {
  systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  prefersDark.value = systemThemeQuery.matches;
  systemThemeQuery.addEventListener('change', updateSystemTheme);
  session.load().catch(() => undefined);
  loadSiteConfig();
  window.addEventListener('site-config-updated', updateSiteConfig);
});
onBeforeUnmount(() => { if (routeLoadingTimer !== null) window.clearTimeout(routeLoadingTimer); if (routeLoadingDelayTimer !== null) window.clearTimeout(routeLoadingDelayTimer); removeBeforeNavigation(); removeAfterNavigation(); systemThemeQuery?.removeEventListener('change', updateSystemTheme); window.removeEventListener('site-config-updated', updateSiteConfig); });
</script>
