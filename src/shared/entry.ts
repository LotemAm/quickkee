export const CARD_FLAG_KEY = 'QK-IsCard';
export const CARDHOLDER_NAME_KEY = 'Cardholder Name';

export interface EntryField { key: string; value: string; protected: boolean }
export interface EntryView {
  id: string; title: string; username: string; url: string;
  password: string; fields: EntryField[]; expired: boolean;
  created: number | null; expires: number | null; isCard: boolean
}
export interface EntrySummary { id: string; title: string; username: string; url: string; expired: boolean; isCard: boolean }
export interface TreeNode {
  groupId: string; name: string;
  entries: EntrySummary[];
  children: TreeNode[]
}
