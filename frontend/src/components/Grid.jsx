// src/components/Grid.jsx
import Cell from './Cell';

function Grid({ grid, onCellClick, size, center, indexToCoord, activeMode }) {
  return (
    <div className="grid-wrapper">
      <div className="grid-scene">
        {/* Y ekseni etiketi */}
        <div className="axis-label axis-label--y">y</div>

        <div className="grid-and-x">
          <div
            className="grid-container"
            style={{
              gridTemplateColumns: `repeat(${size}, var(--cell-size))`,
              gridTemplateRows:    `repeat(${size}, var(--cell-size))`,
            }}
            role="grid"
            aria-label={`${size}x${size} Koordinat Düzlemi`}
          >
            {grid.map((row, rowIndex) =>
              row.map((cellState, colIndex) => {
                const coord     = indexToCoord(rowIndex, colIndex, size);
                const isOrigin  = rowIndex === center && colIndex === center;
                const isXAxis   = rowIndex === center && !isOrigin;
                const isYAxis   = colIndex === center && !isOrigin;
                return (
                  <Cell
                    key={`${rowIndex}-${colIndex}`}
                    row={rowIndex}
                    col={colIndex}
                    state={cellState}
                    onClick={onCellClick}
                    coord={coord}
                    isOrigin={isOrigin}
                    isXAxis={isXAxis}
                    isYAxis={isYAxis}
                    activeMode={activeMode}
                  />
                );
              })
            )}
          </div>

          {/* X ekseni etiketi */}
          <div className="axis-label axis-label--x">x</div>
        </div>
      </div>

      <p className="grid-info">
        <strong>Mod:</strong>{' '}
        {activeMode === 'obstacle' && 'Hücreye tıkla → Engel koy / kaldır'}
        {activeMode === 'start'    && 'Hücreye tıkla → Başlangıç konumunu seç'}
        {activeMode === 'goal'     && 'Hücreye tıkla → Hedef konumunu seç'}
        {activeMode === 'waypoint' && 'Hücrelere tıkla → Birden fazla Durak (📍) ekle / kaldır'}
        {activeMode === 'traffic-light' && 'Hücrelere tıkla → Trafik Işığı (🚦) ekle / kaldır'}
        &nbsp;·&nbsp; Koordinatlar: <strong>(x, y)</strong> — merkez (0, 0)
      </p>
    </div>
  );
}

export default Grid;
