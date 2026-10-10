/**
 * @file commentTree 单元测试（V3.0.0）
 * @description 验证树算法：层级组装、顺序保持、孤儿提升、深度优先平铺与往返一致性。
 */
import { describe, it, expect } from 'vitest';
import {
  buildCommentTree,
  flattenTree,
  MAX_COMMENT_DEPTH,
  type TreeRow,
} from '../../src/utils/commentTree';

interface Row extends TreeRow {
  name: string;
}

const rows: Row[] = [
  { id: 'r1', parent_id: null, name: 'L1-a' },
  { id: 'r2', parent_id: 'r1', name: 'L2-a' },
  { id: 'r3', parent_id: 'r2', name: 'L3-a' },
  { id: 'r4', parent_id: 'r2', name: 'L3-b' },
  { id: 'r5', parent_id: null, name: 'L1-b' },
];

describe('commentTree 常量', () => {
  it('MAX_COMMENT_DEPTH = 3', () => {
    expect(MAX_COMMENT_DEPTH).toBe(3);
  });
});

describe('buildCommentTree', () => {
  it('按 parent_id 组装层级，children 顺序与输入一致', () => {
    const tree = buildCommentTree(rows);
    expect(tree).toHaveLength(2);
    expect(tree[0].id).toBe('r1');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].id).toBe('r2');
    expect(tree[0].children[0].children.map((c) => c.id)).toEqual(['r3', 'r4']);
    expect(tree[1].id).toBe('r5');
  });

  it('父节点缺失的孤儿提升为根节点，不丢失', () => {
    const withOrphan: Row[] = [
      { id: 'a', parent_id: null, name: 'A' },
      { id: 'b', parent_id: 'ghost', name: 'B' },
    ];
    const tree = buildCommentTree(withOrphan);
    expect(tree.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('空数组返回空树', () => {
    expect(buildCommentTree([])).toEqual([]);
  });

  it('三级封顶平铺：L3 再回复 L3 时上移挂到最近 L2，不出现第四级', () => {
    interface DRow extends TreeRow {
      depth: number;
    }
    const drows: DRow[] = [
      { id: 'l2', parent_id: 'root', depth: 2 },
      { id: 'l3a', parent_id: 'l2', depth: 3 },
      { id: 'l3b', parent_id: 'l3a', depth: 3 },
      { id: 'l3c', parent_id: 'l3b', depth: 3 },
    ];
    const depthOf = (r: DRow) => r.depth;
    const tree = buildCommentTree(drows, { depthOf });
    // l2 为根；l3a/l3b/l3c 全部平铺为 l2 的子节点
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('l2');
    expect(tree[0].children.map((c) => c.id)).toEqual(['l3a', 'l3b', 'l3c']);
    expect(tree[0].children.every((c) => c.children.length === 0)).toBe(true);
  });

  it('L3 互回但浅层祖先断链时提升为根节点，内容不丢失', () => {
    interface DRow extends TreeRow {
      depth: number;
    }
    const drows: DRow[] = [
      { id: 'a3', parent_id: 'ghost3', depth: 3 },
      { id: 'b3', parent_id: 'a3', depth: 3 },
    ];
    const tree = buildCommentTree(drows, { depthOf: (r) => r.depth });
    expect(tree.map((t) => t.id)).toEqual(['a3', 'b3']);
  });
});

describe('flattenTree', () => {
  it('深度优先前序平铺：父先于子', () => {
    const flat = flattenTree(buildCommentTree(rows));
    expect(flat.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
  });

  it('build → flatten 往返不重不漏', () => {
    const flat = flattenTree(buildCommentTree(rows));
    expect(flat).toHaveLength(rows.length);
    expect(new Set(flat.map((r) => r.id))).toEqual(new Set(rows.map((r) => r.id)));
  });
});
