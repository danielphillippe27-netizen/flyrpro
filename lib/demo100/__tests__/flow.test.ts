import {
  DEMO100_MEMBERS,
  DEMO100_STAGES,
  balancedDemo100ZoneIndex,
  getDemo100Metrics,
  getDemo100Outcomes,
  nextDemo100Stage,
  parseDemo100StoredState,
} from '@/lib/demo100/flow';

let passed = 0;
let failed = 0;

function test(name: string, callback: () => void) {
  try {
    callback();
    console.log(`✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    failed += 1;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

test('moves through the complete demo in order', () => {
  DEMO100_STAGES.slice(0, -1).forEach((stage, index) => {
    assert(nextDemo100Stage(stage) === DEMO100_STAGES[index + 1], `${stage} should advance once`);
  });
  assert(nextDemo100Stage('cta') === 'cta', 'CTA should be terminal');
  assert(DEMO100_STAGES[2] === 'territory_preview', 'The 3D territory should appear immediately after creation');
  assert(DEMO100_STAGES[3] === 'post_create_video', 'The second video should follow the 3D territory reveal');
  assert(
    DEMO100_STAGES.indexOf('field_guide_intro_video') === DEMO100_STAGES.indexOf('team_stats') + 1,
    'The standalone field guide video should follow team stats',
  );
  assert(
    DEMO100_STAGES.indexOf('iphone_chapters') === DEMO100_STAGES.indexOf('field_guide_intro_video') + 1,
    'The synchronized iPhone chapter guide should follow its standalone introduction',
  );
});

test('derives one consistent outcome and metrics set', () => {
  for (const total of [4, 37, 1000]) {
    const outcomes = getDemo100Outcomes(total);
    const metrics = getDemo100Metrics(total);
    const noAnswers = outcomes.filter((outcome) => outcome === 'no_answer').length;
    const conversations = outcomes.length - noAnswers;
    const leads = outcomes.filter((outcome) => outcome === 'lead' || outcome === 'appointment').length;
    const appointments = outcomes.filter((outcome) => outcome === 'appointment').length;

    assert(outcomes.length === total, `expected ${total} outcomes`);
    assert(metrics.doors === total, `expected ${total} doors`);
    assert(metrics.noAnswers === noAnswers, 'no-answer totals should agree');
    assert(metrics.conversations === conversations, 'conversation totals should agree');
    assert(metrics.leads === leads, 'lead totals should agree');
    assert(metrics.appointments === appointments, 'appointment totals should agree');
  }
});

test('balances contiguous zones across four members', () => {
  for (const total of [4, 37, 1000]) {
    const counts = Array(DEMO100_MEMBERS.length).fill(0) as number[];
    for (let index = 0; index < total; index += 1) {
      counts[balancedDemo100ZoneIndex(index, total)] += 1;
    }
    assert(Math.max(...counts) - Math.min(...counts) <= 1, `unbalanced ${total}-home split: ${counts.join(',')}`);
  }
});

test('restores valid state and rejects incompatible storage', () => {
  const polygon: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [[[-79.4, 43.7], [-79.39, 43.7], [-79.39, 43.71], [-79.4, 43.7]]],
  };
  const restored = parseDemo100StoredState(JSON.stringify({
    version: 2,
    stage: 'assignments',
    selectedCount: 24,
    campaignName: 'Downtown launch',
    polygon,
    bbox: [-79.4, 43.7, -79.39, 43.71],
    createdAt: '2026-09-08T12:00:00.000Z',
  }));
  assert(restored?.stage === 'assignments', 'stage should restore');
  assert(restored.selectedCount === 24, 'selected count should restore');
  assert(restored.campaignName === 'Downtown launch', 'campaign name should restore');
  assert(parseDemo100StoredState('{"version":1,"stage":"campaign_builder"}') === null, 'old versions should be rejected');
  assert(parseDemo100StoredState('{"version":2,"stage":"unknown"}') === null, 'unknown stages should be rejected');
});

if (failed > 0) process.exit(1);
console.log(`\n${passed} passed`);
