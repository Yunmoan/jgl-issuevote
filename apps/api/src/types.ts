import type { Request } from 'express';

export type Provider = 'feishu' | 'natayarkid';
export type IssueVisibility = 'public' | 'login' | 'groups';
export type IssueStatus = 'draft' | 'open' | 'voting' | 'closed' | 'archived';
export type IssueOutcome = 'pending' | 'passed' | 'rejected' | 'manual_required' | 'not_applicable';
export type VoteChoice = 'agree' | 'disagree' | 'abstain';

export interface Viewer {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  status: 'active' | 'disabled' | 'pending';
  groups: string[];
  boundProviders: Provider[];
}

export type AppRequest = Request & {
  viewer?: Viewer | null;
};
