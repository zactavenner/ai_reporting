import { it } from 'vitest';
import { scoreCapitalRaisingQA } from '../../supabase/functions/_shared/meetgeekQuality';
const pad = (n: number) => 'Rep: understood, noted for the record. '.repeat(n);
const T = [
  'Rep: thanks for making time. What are you looking to accomplish with this allocation?',
  'Prospect: I have capital available and I want exposure to a real estate fund.',
  'Rep: what is your time horizon, and how much would you allocate?',
  'Prospect: maybe a 500k check size over five years.',
  'Rep: tell me about your portfolio mix today?',
  'Prospect: mostly public equity.',
  'Rep: the offering is a private placement with a preferred return; targeted returns are projected, not guaranteed, and there is risk of loss.',
  'Rep: on liquidity, the hold period is five to seven years and distributions begin in year two.',
  'Prospect: I am a little concerned about the lock-up.',
  'Rep: that is fair. Here is how we handle it. Does that address your concern?',
  'Prospect: yes, that clarifies it.',
  'Rep: we will schedule the next call for Tuesday at 2pm and send over the PPM.',
  pad(6),
].join('\n');
it('dbg', () => {
  const qa = scoreCapitalRaisingQA({ transcript: T, summary: 'Discovery call on the fund offering; PPM to follow.', actionItems: ['Jane: send the PPM by Friday'], analytics: { kpis: { engagement: 5 } } });
  console.log(JSON.stringify({ t: qa.total, g: qa.gateStatus, flags: qa.redFlags, cats: qa.categories.map(c=>[c.key,c.points,c.na,c.insufficientEvidence]) }, null, 1));
});
