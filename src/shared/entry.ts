export interface EntryField { key: string; value: string; protected: boolean }
export interface EntryView {
  id: string; title: string; username: string; url: string;
  password: string; fields: EntryField[]; expired: boolean;
  created: number | null; expires: number | null
}
export interface EntrySummary { id: string; title: string; username: string; url: string; expired: boolean }
export interface TreeNode {
  groupId: string; name: string;
  entries: EntrySummary[];
  children: TreeNode[]
}
