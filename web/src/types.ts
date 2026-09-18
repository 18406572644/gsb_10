export type Role = 'editor' | 'commenter' | 'viewer';

export type Op =
  | { type: 'insert'; pos: number; text: string }
  | { type: 'delete'; pos: number; len: number };

export interface Cursor {
  pos: number;
  start: number;
  end: number;
}

export interface Member {
  id: string;
  name: string;
  role: Role;
}

export interface Reply {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  ts: number;
}

export interface Annotation {
  id: string;
  start: number;
  end: number;
  quote: string;
  content: string;
  authorId: string;
  authorName: string;
  resolved: boolean;
  createdAt: number;
  replies: Reply[];
}

/** offline: 未连接/已断开；connecting: 连接中（含重连退避）；syncing: 已连接，等待全量快照；online: 就绪 */
export type ConnStatus = 'offline' | 'connecting' | 'syncing' | 'online';

export const ROLE_LABEL: Record<Role, string> = {
  editor: '编辑',
  commenter: '批注',
  viewer: '只读',
};
