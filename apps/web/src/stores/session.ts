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
      feishu: { enabled: boolean; autoLogin: boolean };
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
    async logout() {
      await apiPost('/auth/logout');
      this.viewer = null;
    }
  }
});

