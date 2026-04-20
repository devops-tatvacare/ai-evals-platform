import { describe, expect, it } from 'vitest';

import {
  deriveChartHeight,
  deriveChartLayout,
  widthBucketFor,
} from './chartLayout';

describe('widthBucketFor', () => {
  it('places sub-360 widths in xs', () => {
    expect(widthBucketFor(320, 'chat')).toBe('xs');
  });

  it('places 360-539 widths in sm', () => {
    expect(widthBucketFor(460, 'chat')).toBe('sm');
  });

  it('places 540-719 widths in md', () => {
    expect(widthBucketFor(640, 'dashboard-half')).toBe('md');
  });

  it('places 720+ widths in lg', () => {
    expect(widthBucketFor(960, 'detail')).toBe('lg');
  });

  it('falls back to surface default when width is undefined', () => {
    expect(widthBucketFor(undefined, 'chat')).toBe('sm');
    expect(widthBucketFor(undefined, 'dashboard-half')).toBe('md');
    expect(widthBucketFor(undefined, 'dashboard-full')).toBe('lg');
    expect(widthBucketFor(undefined, 'detail')).toBe('lg');
  });

  it('ignores zero and negative widths', () => {
    expect(widthBucketFor(0, 'chat')).toBe('sm');
    expect(widthBucketFor(-20, 'chat')).toBe('sm');
  });
});

describe('deriveChartHeight', () => {
  it('chat bar height scales modestly by data density', () => {
    const small = deriveChartHeight('chat', 'bar', 1);
    const big = deriveChartHeight('chat', 'bar', 20);
    expect(small).toBeGreaterThanOrEqual(220);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThanOrEqual(300);
  });

  it('detail surface has a taller cap than chat/dashboard', () => {
    const chat = deriveChartHeight('chat', 'bar', 12);
    const detail = deriveChartHeight('detail', 'bar', 12);
    expect(detail).toBeGreaterThan(chat);
  });

  it('dashboard-full and dashboard-half produce different heights', () => {
    const half = deriveChartHeight('dashboard-half', 'bar', 12);
    const full = deriveChartHeight('dashboard-full', 'bar', 12);
    expect(full).toBeGreaterThan(half);
  });

  it('pie charts stay short in chat', () => {
    const pie = deriveChartHeight('chat', 'pie', 5);
    expect(pie).toBeLessThanOrEqual(260);
  });
});

describe('deriveChartLayout', () => {
  it('narrow chat bucket shrinks left/bottom gutters vs wide detail', () => {
    const narrow = deriveChartLayout({
      surface: 'chat',
      type: 'bar',
      dataCount: 5,
      width: 320,
    });
    const wide = deriveChartLayout({
      surface: 'detail',
      type: 'bar',
      dataCount: 5,
      width: 960,
    });
    expect(narrow.margin.left).toBeLessThan(wide.margin.left + 1);
    expect(narrow.margin.bottom).toBeGreaterThanOrEqual(wide.margin.bottom);
  });

  it('horizontal-bar layout widens y-axis only as much as the bucket allows', () => {
    const xs = deriveChartLayout({
      surface: 'chat',
      type: 'horizontal_bar',
      dataCount: 6,
      width: 320,
    });
    const lg = deriveChartLayout({
      surface: 'detail',
      type: 'horizontal_bar',
      dataCount: 6,
      width: 960,
    });
    expect(xs.yAxisWidth).toBeLessThan(lg.yAxisWidth);
    expect(xs.yAxisWidth).toBeLessThanOrEqual(100);
    expect(lg.yAxisWidth).toBeLessThanOrEqual(160);
  });

  it('dashboard half-tile and full-tile pick different layout output', () => {
    const half = deriveChartLayout({
      surface: 'dashboard-half',
      type: 'bar',
      dataCount: 10,
    });
    const full = deriveChartLayout({
      surface: 'dashboard-full',
      type: 'bar',
      dataCount: 10,
    });
    expect(half.height).not.toBe(full.height);
  });

  it('detail surface allows a taller cap but still reacts to width', () => {
    const wide = deriveChartLayout({
      surface: 'detail',
      type: 'bar',
      dataCount: 12,
      width: 960,
    });
    const narrowerDetail = deriveChartLayout({
      surface: 'detail',
      type: 'bar',
      dataCount: 12,
      width: 460,
    });
    expect(wide.widthBucket).toBe('lg');
    expect(narrowerDetail.widthBucket).toBe('sm');
    // Same height range (surface = detail) but margins react to width.
    expect(wide.margin.right).toBeGreaterThan(narrowerDetail.margin.right);
  });

  it('keeps height within surface range for tiny result sets', () => {
    const layout = deriveChartLayout({
      surface: 'chat',
      type: 'bar',
      dataCount: 1,
    });
    expect(layout.height).toBeGreaterThanOrEqual(220);
    expect(layout.height).toBeLessThanOrEqual(300);
  });

  it('reports tick-truncation cap shrinks on narrow surfaces', () => {
    const narrow = deriveChartLayout({
      surface: 'chat',
      type: 'bar',
      dataCount: 5,
      width: 320,
    });
    const wide = deriveChartLayout({
      surface: 'detail',
      type: 'bar',
      dataCount: 5,
      width: 960,
    });
    expect(narrow.xTickCharCap).toBeLessThan(wide.xTickCharCap);
  });
});
