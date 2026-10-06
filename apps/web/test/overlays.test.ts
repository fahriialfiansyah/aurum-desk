import { LineStyle } from 'lightweight-charts';
import { describe, expect, test } from 'vitest';
import { drawingSpecs, levelLines, mergeMarkers, setupsForChart, structureMarkers, swingMarkers, zoneSpecs } from '@/chart/overlays';
import { chartPalette } from '@/lib/theme';
import { analysis, setup, zone } from './fixtures';

const dark = chartPalette('dark');
const light = chartPalette('light');

describe('levelLines', () => {
  test('entry/SL/TP1/TP2 are white in dark theme and black in light theme, labelled with exact prices', () => {
    const d = levelLines(setup, dark);
    expect(d.map((l) => l.color)).toEqual(['#ffffff', '#ffffff', '#ffffff', '#ffffff']);
    const l = levelLines(setup, light);
    expect(l.map((x) => x.color)).toEqual(['#000000', '#000000', '#000000', '#000000']);
    expect(d.map((x) => x.title)).toEqual(['ENTRY 4592.10', 'SL 4587.90', 'TP1 4598.40 (1:1.5)', 'TP2 4600.50 (1:2)']);
    expect(d[0]).toMatchObject({ lineWidth: 2, lineStyle: LineStyle.Solid, price: 4592.1 });
    expect(d[1]?.lineStyle).toBe(LineStyle.Dashed);
  });
});

describe('zoneSpecs', () => {
  test('chosen zone uses the ink border and 14% fill; others are dimmed tints', () => {
    const [chosen] = zoneSpecs([zone], zone.id, new Set(), dark);
    expect(chosen?.style.borderColor).toBe('#ffffff');
    expect(chosen?.style.fillColor).toBe('rgba(255,255,255,0.14)');
    expect(chosen?.style.dashed).toBe(false);
    expect(chosen?.box).toEqual({ id: zone.id, fromTime: zone.createdAt, toTime: null, top: zone.top, bottom: zone.bottom });
    const [light1] = zoneSpecs([zone], zone.id, new Set(), light);
    expect(light1?.style.borderColor).toBe('#000000');
    const [runnerUp] = zoneSpecs([zone], null, new Set([zone.id]), dark);
    expect(runnerUp?.style.dashed).toBe(true);
    expect(runnerUp?.style.autoscale).toBe(false);
    const [other] = zoneSpecs([{ ...zone, fresh: false, tested: true }], null, new Set(), dark);
    expect(other?.style.label).toMatch(/tested/);
  });
});

describe('markers', () => {
  test('swing labels and structure events map to sorted markers', () => {
    const swings = swingMarkers(analysis.structure, dark);
    expect(swings.map((m) => m.text)).toEqual(['HL', 'HH']);
    expect(swings[0]?.position).toBe('belowBar');
    const events = structureMarkers(analysis.structure, dark);
    expect(events[0]).toMatchObject({ shape: 'arrowUp', position: 'belowBar', text: 'BOS 4601.20' });
    const merged = mergeMarkers(events, swings);
    expect(merged.map((m) => Number(m.time))).toEqual([...merged.map((m) => Number(m.time))].sort((a, b) => a - b));
  });
});

describe('setupsForChart & drawingSpecs', () => {
  test('setup lines only on the playbook timeframes and only while active', () => {
    const tfs = { biasTf: 'M15', entryTf: 'M5' };
    expect(setupsForChart([setup], 'M5', tfs)).toHaveLength(1);
    expect(setupsForChart([setup], 'M15', tfs)).toHaveLength(1);
    expect(setupsForChart([setup], 'M30', tfs)).toHaveLength(0);
    expect(setupsForChart([{ ...setup, status: 'stopped' }], 'M5', tfs)).toHaveLength(0);
  });

  test('copilot drawings become lines, boxes and markers', () => {
    const specs = drawingSpecs(
      [
        { kind: 'hline', id: 'a', price: 4600, label: 'resistance', style: 'dashed' },
        { kind: 'box', id: 'b', top: 4610, bottom: 4605, fromTime: 1, toTime: null },
        { kind: 'marker', id: 'c', time: 5, position: 'above', text: 'note' },
      ],
      dark,
    );
    expect(specs.lines[0]?.title).toBe('resistance 4600.00');
    expect(specs.zones[0]?.box.id).toBe('draw:b');
    expect(specs.markers[0]?.text).toBe('note');
  });
});
