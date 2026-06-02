// src/components/Cell.jsx
const STATE_ICONS = {
  start:    '🏁',
  racer1:   '🔵',
  racer2:   '🟠',
  racer3:   '🟡',
  racer4:   '🟤',
  racer5:   '⚫',
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

function Cell({ row, col, state, onClick, coord, isOrigin, isXAxis, isYAxis, activeMode, racerModels = [] }) {
  const handleClick = () => {
    if (activeMode === 'start'          && (state === 'goal'  || state === 'dynamic' || state === 'agent' || state.startsWith('racer') || state === 'waypoint' || state.startsWith('traffic-light'))) return;
    if (activeMode === 'goal'           && (state === 'start' || state === 'dynamic' || state === 'agent' || state.startsWith('racer') || state === 'waypoint' || state.startsWith('traffic-light'))) return;
    if (activeMode === 'waypoint'       && (state === 'start' || state === 'goal'    || state === 'dynamic' || state === 'agent' || state.startsWith('racer') || state.startsWith('traffic-light'))) return;
    if (activeMode === 'traffic-light'  && (state === 'start' || state === 'goal'    || state === 'dynamic' || state === 'agent' || state.startsWith('racer') || state === 'waypoint')) return;
    onClick(row, col);
  };

  const label = coord ? `(${coord.x}, ${coord.y}) — ${state}` : `(${row},${col}) — ${state}`;

  let extraClass = '';
  if (isOrigin)     extraClass = ' cell--origin';
  else if (isXAxis) extraClass = ' cell--x-axis';
  else if (isYAxis) extraClass = ' cell--y-axis';

  const cursor = (state === 'start' || state === 'goal' || state === 'agent' || state.startsWith('racer'))
    ? (activeMode === 'obstacle' || activeMode === 'dynamic' ? 'not-allowed' : 'cell')
    : MODE_CURSOR[activeMode] || 'pointer';

  const isRacer = state.startsWith('racer');
  let racerIndex = -1;
  if (isRacer) {
    racerIndex = parseInt(state.replace('racer', '')) - 1;
  }
  const modelName = racerIndex >= 0 && racerModels?.[racerIndex] ? racerModels[racerIndex] : '';

  return (
    <div className={`cell cell--${state.startsWith('racer') ? 'agent cell--' + state : state}${extraClass}`}
      onClick={handleClick} title={label} role="gridcell" aria-label={label}
      style={{ cursor, position: 'relative' }}>
      {STATE_ICONS[state] && <span className="cell__icon">{STATE_ICONS[state]}</span>}

      {isRacer && modelName && (
        <span className="cell__racer-label" style={{
          position: 'absolute',
          bottom: '2px',
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: '7.5px',
          fontFamily: 'monospace',
          fontWeight: 'bold',
          color: '#ffffff',
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          border: '0.5px solid rgba(255, 255, 255, 0.25)',
          padding: '0px 3px',
          borderRadius: '3px',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          textShadow: '0 0 2px #000',
          zIndex: 5
        }}>
          {modelName.replace('_', ' ').toUpperCase()}
        </span>
      )}
      {(isXAxis || isYAxis) && coord && (
        <span className="cell__axis-label">{isXAxis ? coord.x : coord.y}</span>
      )}
    </div>
  );
}

export default Cell;
