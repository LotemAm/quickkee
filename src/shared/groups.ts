import type { TreeNode } from './entry';

export interface GroupOption {
  groupId: string;
  name: string;
  depth: number;
}

export function flattenGroups(node: TreeNode, depth = 0, acc: GroupOption[] = []): GroupOption[] {
  acc.push({ groupId: node.groupId, name: node.name, depth });
  for (const child of node.children) flattenGroups(child, depth + 1, acc);
  return acc;
}
