export interface EntryField { key: string; value: string; protected: boolean }
export interface EntryView {
  id: string; title: string; username: string; url: string;
  password: string; fields: EntryField[]; expired: boolean
}
export interface TreeNode {
  groupId: string; name: string;
  entries: { id: string; title: string; username: string; url: string; expired: boolean }[];
  children: TreeNode[]
}
