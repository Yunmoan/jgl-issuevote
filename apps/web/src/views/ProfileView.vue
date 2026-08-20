<template>
  <main class="content-wrap">
    <div class="page-title">
      <div>
        <h1>个人中心</h1>
        <div class="muted">查看登录身份、权限组和绑定状态。</div>
      </div>
      <n-button v-if="session.viewer" secondary @click="session.logout">退出登录</n-button>
    </div>

    <section v-if="session.viewer" class="panel profile">
      <n-avatar :size="56" :src="session.viewer.avatarUrl || undefined">{{ session.viewer.displayName.slice(0, 1) }}</n-avatar>
      <div>
        <h2>{{ session.viewer.displayName }}</h2>
        <p class="muted">{{ session.viewer.email || '未提供邮箱' }}</p>
        <div class="tag-line">
          <n-tag v-for="group in session.viewer.groups" :key="group" type="info" size="small">{{ group }}</n-tag>
          <n-tag v-for="provider in session.viewer.boundProviders" :key="provider" size="small">{{ provider }}</n-tag>
        </div>
      </div>
    </section>

    <section v-else class="panel">
      <n-empty description="尚未登录" />
      <n-space>
        <n-button v-if="session.providers?.natayarkid.enabled" type="primary" @click="session.loginWithNatayarkId">NatayarkID 登录</n-button>
        <n-button v-if="session.providers?.devLogin" secondary @click="session.devLogin">开发登录</n-button>
      </n-space>
    </section>
  </main>
</template>

<script setup lang="ts">
import { NAvatar, NButton, NEmpty, NSpace, NTag } from 'naive-ui';
import { useSessionStore } from '../stores/session';

const session = useSessionStore();
</script>

<style scoped>
.profile {
  display: flex;
  align-items: center;
  gap: 16px;
}

h2 {
  margin: 0 0 4px;
}
</style>

