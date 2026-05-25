// src/components/Cell.jsx
const STATE_ICONS = {
  start:    '🏁',
  agent:    '🤖',
  goal:     '🎯',
  waypoint: '📍',
  'traffic-light-green': '🚦',
  'traffic-light-red': '🚦',
  obstacle: '',
  dynamic:  '',
  empty:    '',
};

const MODE_CURSOR = { obstacle: 'crosshair', dynamic: 'crosshair', start: 'cell', goal: 'cell', waypoint: 'cell', 'traffic-light': 'cell' };

function Cell({ row, col, state, onClick, coord, isOrigin, isXAxis, isYAxis, activeMode }) {
  const handleClick = () => {
    if (activeMode === 'start'          && (state === 'goal'  || state === 'dynamic' || state === 'agent' || state === 'waypoint' || state.startsWith('traffic-light'))) return;
    if (activeMode === 'goal'           && (state === 'start' || state === 'dynamic' || state === 'agent' || state === 'waypoint' || state.startsWith('traffic-light'))) return;
    if (activeMode === 'waypoint'       && (state === 'start' || state === 'goal'    || state === 'dynamic' || state === 'agent' || state.startsWith('traffic-light'))) return;
    if (activeMode === 'traffic-light'  && (state === 'start' || state === 'goal'    || state === 'dynamic' || state === 'agent' || state === 'waypoint')) return;
    onClick(row, col);
  };

  const label = coord ? `(${coord.x}, ${coord.y}) — ${state}` : `(${row},${col}) — ${state}`;

  let extraClass = '';
  if (isOrigin)     extraClass = ' cell--origin';
  else if (isXAxis) extraClass = ' cell--x-axis';
  else if (isYAxis) extraClass = ' cell--y-axis';

  const cursor = (state === 'start' || state === 'goal' || state === 'agent')
    ? (activeMode === 'obstacle' || activeMode === 'dynamic' ? 'not-allowed' : 'cell')
    : MODE_CURSOR[activeMode] || 'pointer';

  return (
    <div className={`cell cell--${state}${extraClass}`}
      onClick={handleClick} title={label} role="gridcell" aria-label={label}
      style={{ cursor }}>
      {STATE_ICONS[state] && <span className="cell__icon">{STATE_ICONS[state]}</span>}
      {(isXAxis || isYAxis) && coord && (
        <span className="cell__axis-label">{isXAxis ? coord.x : coord.y}</span>
      )}
    </div>
  );
}

export default Cell;
