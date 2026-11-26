import { describe, expect, it } from 'vitest';
import { pageItems } from '../src/components/ui/Pagination';

describe('pageItems', () => {
  it('lists every page when there are few', () => {
    expect(pageItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('collapses the middle around the current page', () => {
    expect(pageItems(6, 12)).toEqual([1, 'gap', 5, 6, 7, 'gap', 12]);
  });

  it('keeps the first pages together near the start', () => {
    expect(pageItems(2, 12)).toEqual([1, 2, 3, 4, 'gap', 12]);
  });

  it('keeps the last pages together near the end', () => {
    expect(pageItems(11, 12)).toEqual([1, 'gap', 9, 10, 11, 12]);
  });
});
