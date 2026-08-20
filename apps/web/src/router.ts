import { createRouter, createWebHistory } from 'vue-router';
import IssueDetailView from './views/IssueDetailView.vue';
import IssueListView from './views/IssueListView.vue';
import NewIssueView from './views/NewIssueView.vue';
import AdminView from './views/AdminView.vue';
import ProfileView from './views/ProfileView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: IssueListView },
    { path: '/issues/new', component: NewIssueView },
    { path: '/issues/:number', component: IssueDetailView },
    { path: '/me', component: ProfileView },
    { path: '/admin', component: AdminView }
  ]
});

