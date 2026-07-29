// Verifier-league renderer. redde/gen-board, vesper/gauge+league, ruptor/build-page
// and praeda/site each hand-rolled a variant of this HTML. This is the shared one:
// given the surface manifests, render a single neutral league (console + HTML).

const VERDICT_COLOR = { green: '#16a34a', yellow: '#ca8a04', red: '#dc2626', gray: '#6b7280' };
const DIR_LABEL = {
  past: 'PAST · reconstruct',
  present: 'PRESENT · verify',
  adversarial: 'ADVERSARIAL · weaponize',
};

export function renderConsole(surfaces) {
  const rows = surfaces.map((s) => {
    const dir = (DIR_LABEL[s.direction] || s.direction).padEnd(24);
    const name = (s.title || s.name).padEnd(10);
    return `  ${name} ${dir} ${s.invariant}`;
  });
  return [
    'Re-execution verifier league',
    '─'.repeat(60),
    ...rows,
    '─'.repeat(60),
  ].join('\n');
}

export function renderHtml(surfaces, { title = 'Re-execution verifier league' } = {}) {
  const cards = surfaces
    .map((s) => {
      const color = VERDICT_COLOR[s.verdict?.status] || VERDICT_COLOR.gray;
      const dir = DIR_LABEL[s.direction] || s.direction;
      return `      <article class="card">
        <header><span class="dir">${dir}</span><h2>${s.title || s.name}</h2></header>
        <p class="inv">${s.invariant}</p>
        <p class="tag">${s.tagline || ''}</p>
        <p class="verdict" style="--c:${color}">${s.verdict?.label || '—'}</p>
      </article>`;
    })
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 ui-sans-serif,system-ui,sans-serif; max-width: 60rem; margin: 3rem auto; padding: 0 1rem; }
  h1 { font-size: 1.6rem; }
  .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill,minmax(15rem,1fr)); }
  .card { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: .75rem; padding: 1rem; }
  .dir { font-size: .7rem; letter-spacing: .05em; opacity: .6; text-transform: uppercase; }
  .card h2 { font-size: 1.1rem; margin: .2rem 0 .4rem; }
  .inv { font-weight: 600; margin: .2rem 0; }
  .tag { opacity: .7; font-size: .85rem; }
  .verdict { color: var(--c); font-weight: 700; margin-top: .6rem; }
</style>
<h1>${title}</h1>
<p>One re-execution engine, four surfaces: reconstruct the past, verify the present, weaponize the boundary.</p>
<div class="grid">
${cards}
</div>`;
}
