/**
 * @file commentTree.ts
 * @description V3.0.0 评论树纯算法工具（无副作用、前后端同构）：
 *              - buildCommentTree：把扁平评论行按 parent_id 组装为层级树；
 *              - flattenTree：把树深度优先平铺回线性序列；
 *              - MAX_COMMENT_DEPTH：三级深度守卫常量。
 *              对 parent 缺失的孤儿节点，统一提升为根节点，保证任何输入下不丢节点。
 */

/** 评论最大嵌套深度：L1/L2/L3，系统中永不出现第四级 */
export const MAX_COMMENT_DEPTH = 3;

/** 树算法所需的最小评论行结构 */
export interface TreeRow {
  id: string;
  parent_id: string | null;
}

/** 组装后的树节点：在行结构上挂载 children */
export type TreeNode<T extends TreeRow> = T & { children: TreeNode<T>[] };

/**
 * 把扁平行数组组装为树。
 * 输入顺序即同级展示顺序（调用方应先按 created_at 排序）。
 * 孤儿节点（parent_id 指向不存在的行，如父评论已被单条删除）提升为根节点。
 *
 * 平铺规则：深度到达 MAX_COMMENT_DEPTH(3) 后不再继续向下嵌套——depth=3 的
 * 节点若父节点也是 depth=3，则上移挂到最近的 depth≤2 祖先下（互回语境由
 * "回复 @用户"前缀表达），视觉上永不出现第四级。
 */
export function buildCommentTree<T extends TreeRow>(
  rows: T[],
  options: { depthOf?: (row: T) => number | undefined } = {}
): TreeNode<T>[] {
  const nodes = new Map<string, TreeNode<T>>();
  for (const row of rows) {
    nodes.set(row.id, { ...row, children: [] });
  }

  /** 沿 parent 链找到最近的 depth≤2 祖先；找不到返回 null（调用方提升为根） */
  const findShallowAncestor = (startParentId: string): TreeNode<T> | null => {
    let currentId: string | null = startParentId;
    const seen = new Set<string>();
    while (currentId) {
      if (seen.has(currentId)) return null; // 环保护
      seen.add(currentId);
      const current = nodes.get(currentId);
      if (!current) return null;
      const depth = options.depthOf?.(current);
      if (depth !== undefined && depth !== null && depth <= 2) return current;
      currentId = current.parent_id;
    }
    return null;
  };

  const roots: TreeNode<T>[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id)!;
    if (row.parent_id === null) {
      roots.push(node);
      continue;
    }
    let parent = nodes.get(row.parent_id);

    // 三级封顶平铺：L3 不挂在 L3 下，改挂最近的浅层祖先
    if (parent) {
      const nodeDepth = options.depthOf?.(row);
      const parentDepth = options.depthOf?.(parent);
      if (
        nodeDepth !== undefined &&
        nodeDepth >= MAX_COMMENT_DEPTH &&
        parentDepth !== undefined &&
        parentDepth >= MAX_COMMENT_DEPTH
      ) {
        parent = findShallowAncestor(row.parent_id) ?? undefined;
      }
    }

    if (parent) {
      parent.children.push(node);
    } else {
      // 父节点缺失（删除/数据异常/浅层祖先断链）：提升为根节点，内容不丢失
      roots.push(node);
    }
  }
  return roots;
}

/**
 * 把树深度优先（前序：父先于子）平铺为线性数组。
 * 可用于"嵌套树 → 扁平化展示列表"或遍历计数。
 */
export function flattenTree<T extends TreeRow>(roots: TreeNode<T>[]): T[] {
  const out: T[] = [];
  const walk = (node: TreeNode<T>) => {
    const { children, ...row } = node;
    out.push(row as unknown as T);
    for (const child of children) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}
