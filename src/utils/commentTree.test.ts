/**
 * @file commentTree.test.ts
 * @description TR-6.1 前端同构评论树算法单测：组装顺序、孤儿提升、前序平铺不丢节点。
 */
import { describe, expect, it } from 'vitest';
import {
  buildCommentTree,
  flattenTree,
  MAX_COMMENT_DEPTH,
  type TreeRow,
} from './commentTree';

interface Row extends TreeRow {
  text: string;
}

const row = (id: string, parent_id: string | null, text = id): Row => ({
  id,
  parent_id,
  text,
});

describe('buildCommentTree', () => {
  it('MAX_COMMENT_DEPTH 恒为 3', () => {
    expect(MAX_COMMENT_DEPTH).toBe(3);
  });

  it('parent_id=null 的行成为根节点', () => {
    const roots = buildCommentTree([row('a', null), row('b', null)]);
    expect(roots).toHaveLength(2);
    expect(roots.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('按 parent_id 组装嵌套，保持输入顺序', () => {
    const roots = buildCommentTree([
      row('a', null),
      row('b', 'a'),
      row('c', 'b'),
    ]);
    expect(roots).toHaveLength(1);
    expect(roots[0].children.map((r) => r.id)).toEqual(['b']);
    expect(roots[0].children[0].children.map((r) => r.id)).toEqual(['c']);
  });

  it('多个子节点同级且顺序稳定', () => {
    const roots = buildCommentTree([
      row('a', null),
      row('b', 'a'),
      row('c', 'a'),
    ]);
    expect(roots[0].children.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('父节点缺失的孤儿提升为根节点，不丢行', () => {
    const roots = buildCommentTree([row('a', null), row('b', 'missing')]);
    expect(roots).toHaveLength(2);
    expect(roots[1].id).toBe('b');
    expect(roots[1].children).toEqual([]);
  });

  it('空数组返回空树', () => {
    expect(buildCommentTree([])).toEqual([]);
  });

  it('三级封顶平铺：L3 互回 L3 时上移到 L2，永不出现第四级', () => {
    interface DRow extends TreeRow {
      depth: number;
    }
    const drows: DRow[] = [
      { id: 'l2', parent_id: 'root', depth: 2 },
      { id: 'l3a', parent_id: 'l2', depth: 3 },
      { id: 'l3b', parent_id: 'l3a', depth: 3 },
      { id: 'l3c', parent_id: 'l3b', depth: 3 },
    ];
    const roots = buildCommentTree(drows, { depthOf: (r) => r.depth });
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe('l2');
    expect(roots[0].children.map((r) => r.id)).toEqual(['l3a', 'l3b', 'l3c']);
  });
});

describe('flattenTree', () => {
  it('深度优先前序平铺且行数不丢失', () => {
    const roots = buildCommentTree([
      row('a', null),
      row('b', 'a'),
      row('c', 'b'),
      row('d', 'a'),
    ]);
    const flat = flattenTree(roots);
    expect(flat.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(flat).toHaveLength(4);
  });

  it('平铺后不含 children 字段', () => {
    const roots = buildCommentTree([row('a', null), row('b', 'a')]);
    const [first] = flattenTree(roots);
    expect('children' in first).toBe(false);
  });
});
