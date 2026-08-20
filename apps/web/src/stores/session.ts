import { defineStore } from 'pinia';
import { apiGet, apiPost, authStartUrl } from '../api';

export interface Viewer {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  status: string;
  groups: string[];
  boundProviders: string[];
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    viewer: null as Viewer | null,
    loading: false,
    providers: null as null | {
      feishu: { enabled: boolean; autoLogin: boolean; appId: string | null; sdkUrl: string };
      natayarkid: { enabled: boolean; authorizationUrl: string };
      devLogin: boolean;
    }
  }),
  getters: {
    isAdmin: (state) => Boolean(state.viewer?.groups.includes('admin')),
    canCreateIssue: (state) => Boolean(state.viewer?.groups.some((group) => ['admin', 'issue_creator'].includes(group)))
  },
  actions: {
    async load() {
      this.loading = true;
      try {
        const [viewer, providers] = await Promise.all([
          apiGet<Viewer | null>('/me'),
          apiGet<typeof this.providers>('/auth/providers')
        ]);
        this.viewer = viewer;
        this.providers = providers;
        await this.autoLoginWithFeishu();
      } finally {
        this.loading = false;
      }
    },
    async devLogin() {
      this.viewer = await apiPost<Viewer>('/auth/dev-login');
    },
    loginWithNatayarkId() {
      window.location.href = authStartUrl('natayarkid');
    },
    linkNatayarkId() {
      window.location.href = authStartUrl('natayarkid', 'link');
    },
    async autoLoginWithFeishu() {
      const feishu = this.providers?.feishu;
      if (!feishu?.enabled || !feishu.autoLogin || !feishu.appId || !isFeishuContainer() || feishuAutoLoginAttempted) return;
      if (this.viewer?.boundProviders.includes('feishu')) return;
      feishuAutoLoginAttempted = true;
      try {
        await loadFeishuSdk(feishu.sdkUrl);
        const code = await requestFeishuAuthCode(feishu.appId);
        if (code) this.viewer = await apiPost<Viewer>(this.viewer ? '/auth/feishu/bind-code' : '/auth/feishu/code', { code });
      } catch {
        // Outside the Feishu container the SDK may be unavailable; keep the page usable.
      }
    },
    async logout() {
      await apiPost('/auth/logout');
      this.viewer = null;
    }
  }
});

let feishuAutoLoginAttempted = false;

declare global {
  interface Window {
    tt?: { requestAuthCode?: (options: { appId: string; success: (result: { code?: string }) => void; fail?: (error: unknown) => void }) => void };
    h5sdk?: { ready?: (callback: () => void) => void; biz?: { util?: { getAuthCode?: (options: { appId: string; onSuccess: (result: { code?: string }) => void; onFail?: (error: unknown) => void }) => void } } };
  }
}

function isFeishuContainer() {
  return /feishu|lark/i.test(navigator.userAgent) || Boolean(window.tt?.requestAuthCode || window.h5sdk?.biz?.util?.getAuthCode);
}

function loadFeishuSdk(src?: string) {
  if (window.tt?.requestAuthCode || window.h5sdk?.biz?.util?.getAuthCode) return Promise.resolve();
  if (!src) return Promise.reject(new Error('飞书 SDK 地址未配置'));
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-feishu-sdk]');
    if (existing) { existing.addEventListener('load', () => resolve(), { once: true }); existing.addEventListener('error', () => reject(new Error('飞书 SDK 加载失败')), { once: true }); return; }
    const script = document.createElement('script'); script.src = src; script.async = true; script.dataset.feishuSdk = 'true'; script.onload = () => resolve(); script.onerror = () => reject(new Error('飞书 SDK 加载失败')); document.head.appendChild(script);
  });
}

function requestFeishuAuthCode(appId: string) {
  return new Promise<string>((resolve, reject) => {
    const success = (result: { code?: string }) => result.code ? resolve(result.code) : reject(new Error('飞书未返回授权码'));
    const fail = (error: unknown) => reject(error);
    if (window.tt?.requestAuthCode) { window.tt.requestAuthCode({ appId, success, fail }); return; }
    if (window.h5sdk?.biz?.util?.getAuthCode) { window.h5sdk.biz.util.getAuthCode({ appId, onSuccess: success, onFail: fail }); return; }
    reject(new Error('飞书授权接口不可用'));
  });
}
