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
    canCreateIssue: (state) => Boolean(state.viewer?.groups.some((group) => ['member', 'council', 'issue_creator', 'admin', 'auditor'].includes(group))),
    canPublishIssue: (state) => Boolean(state.viewer?.groups.some((group) => ['admin', 'issue_creator'].includes(group))),
    canReviewIssueSubmissions: (state) => Boolean(state.viewer?.groups.some((group) => ['member', 'council', 'issue_creator', 'admin', 'auditor'].includes(group)))
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
      if (!this.providers?.natayarkid.enabled) return;
      window.location.href = authStartUrl('natayarkid');
    },
    linkNatayarkId() {
      if (!this.providers?.natayarkid.enabled) return;
      window.location.href = authStartUrl('natayarkid', 'link');
    },
    async autoLoginWithFeishu() {
      const feishu = this.providers?.feishu;
      if (!feishu?.enabled || !feishu.autoLogin || !feishu.appId || feishuAutoLoginAttempted) return;
      if (this.viewer?.boundProviders.includes('feishu')) return;
      feishuAutoLoginAttempted = true;
      try {
        await loadFeishuSdk(feishu.sdkUrl);
        if (!await waitForFeishuSdkReady()) return;
        const code = await requestFeishuAuthCode(feishu.appId);
        if (code) this.viewer = await apiPost<Viewer>(this.viewer ? '/auth/feishu/bind-code' : '/auth/feishu/code', { code });
      } catch (error) {
        // The SDK is intentionally attempted after it has been loaded: some Feishu
        // WebViews expose their bridge only then and do not identify in the UA.
        console.warn('飞书自动登录未完成', error);
      }
    },
    async logout() {
      await apiPost('/auth/logout');
      this.viewer = null;
    }
  }
});

let feishuAutoLoginAttempted = false;
let feishuSdkPromise: Promise<void> | null = null;

declare global {
  interface Window {
    tt?: {
      requestAccess?: (options: { scopeList: string[]; appID: string; success: (result: { code?: string }) => void; fail: (error: unknown) => void }) => void;
      requestAuthCode?: (options: { appId: string; success: (result: { code?: string }) => void; fail: (error: unknown) => void }) => void;
    };
    h5sdk?: { ready?: (callback: () => void) => void };
  }
}

function hasFeishuAuthApi() {
  return Boolean(window.tt?.requestAccess || window.tt?.requestAuthCode);
}

function loadFeishuSdk(src?: string) {
  if (feishuSdkPromise) return feishuSdkPromise;
  if (hasFeishuAuthApi()) return Promise.resolve();
  if (!src) return Promise.reject(new Error('飞书 SDK 地址未配置'));
  feishuSdkPromise = new Promise<void>((resolve, reject) => {
    const onLoaded = () => {
      const script = document.querySelector<HTMLScriptElement>('script[data-feishu-sdk]');
      if (script) script.dataset.feishuSdkLoaded = 'true';
      resolve();
    };
    const onError = (script: HTMLScriptElement) => {
      script.remove();
      feishuSdkPromise = null;
      reject(new Error(`飞书 SDK 加载失败：${src}`));
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-feishu-sdk]');
    if (existing) {
      if (existing.dataset.feishuSdkLoaded === 'true' || window.h5sdk) { onLoaded(); return; }
      existing.addEventListener('load', onLoaded, { once: true });
      existing.addEventListener('error', () => onError(existing), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.feishuSdk = 'true';
    script.onload = onLoaded;
    script.onerror = () => onError(script);
    document.head.appendChild(script);
  });
  return feishuSdkPromise;
}

function waitForFeishuSdkReady() {
  const ready = window.h5sdk?.ready;
  // The official JSAPI requires requestAccess/requestAuthCode to run in ready().
  if (!ready) return Promise.resolve(hasFeishuAuthApi());
  return new Promise<boolean>((resolve) => {
    const timeout = window.setTimeout(() => resolve(false), 10000);
    try {
      ready(() => { window.clearTimeout(timeout); resolve(true); });
    } catch {
      window.clearTimeout(timeout);
      resolve(false);
    }
  });
}

function requestFeishuAuthCode(appId: string) {
  return new Promise<string>((resolve, reject) => {
    const success = (result: { code?: string }) => result.code ? resolve(result.code) : reject(new Error('飞书未返回授权码'));
    const requestLegacyCode = () => {
      if (!window.tt?.requestAuthCode) return false;
      window.tt.requestAuthCode({ appId, success, fail: reject });
      return true;
    };
    const fail = (error: unknown) => {
      // requestAccess was introduced in newer clients. errno 103 means the
      // current client cannot use it, for which Feishu specifies this fallback.
      if (typeof error === 'object' && error !== null && 'errno' in error && error.errno === 103 && requestLegacyCode()) return;
      reject(error);
    };
    // requestAccess is the current API. An empty scope list only obtains the
    // one-time login code, so the user is not prompted for additional scopes.
    if (window.tt?.requestAccess) { window.tt.requestAccess({ scopeList: [], appID: appId, success, fail }); return; }
    if (requestLegacyCode()) return;
    reject(new Error('飞书授权接口不可用'));
  });
}
