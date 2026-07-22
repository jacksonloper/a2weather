import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { drawFront, FRONT_STYLES } from './frontsGeometry';

// Geographic window fit to the SVG: North America + surrounding oceans.
const REGION = {
  type: 'Polygon',
  coordinates: [[[-150, 12], [-52, 12], [-52, 60], [-150, 60], [-150, 12]]],
};

const FRONT_TYPES = ['trough', 'stationary', 'occluded', 'warm', 'cold'];

// Playback speeds: frames (days) advanced per second.
const SPEEDS = [
  { label: '0.5×', fps: 3 },
  { label: '1×', fps: 6 },
  { label: '2×', fps: 12 },
  { label: '4×', fps: 24 },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(frame) {
  if (!frame) return '';
  const [y, m, d] = frame.date.split('-').map(Number);
  const hh = String(frame.hour).padStart(2, '0');
  return `${MONTHS[m - 1]} ${d}, ${y} · ${hh}:00 UTC`;
}

export default function FrontsPage() {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const basemapGRef = useRef(null);
  const frontsGRef = useRef(null);
  const projectionRef = useRef(null);
  const pathRef = useRef(null);
  const scaleRef = useRef(1);

  const [basemap, setBasemap] = useState(null);
  const [index, setIndex] = useState(null);
  const [year, setYear] = useState(null);
  const [frames, setFrames] = useState([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [loadingYear, setLoadingYear] = useState(false);
  const [error, setError] = useState(null);
  const [dims, setDims] = useState({ width: 900, height: 560 });

  const yearCache = useRef(new Map());
  const advancingRef = useRef(false);

  // Load index + basemap once.
  useEffect(() => {
    Promise.all([
      fetch('/data/fronts/index.json').then((r) => r.json()),
      fetch('/data/fronts/basemap.json').then((r) => r.json()),
    ])
      .then(([idx, base]) => {
        setIndex(idx);
        setBasemap(base);
        if (idx.years?.length) setYear(idx.years[0].year);
      })
      .catch((e) => setError(`Failed to load fronts data: ${e.message}`));
  }, []);

  // Load a year's frames (cached).
  const loadYear = useCallback(async (yr) => {
    if (yearCache.current.has(yr)) {
      setFrames(yearCache.current.get(yr));
      return yearCache.current.get(yr);
    }
    setLoadingYear(true);
    try {
      const res = await fetch(`/data/fronts/${yr}.json`);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      yearCache.current.set(yr, data);
      setFrames(data);
      return data;
    } catch (e) {
      setError(`Failed to load ${yr}: ${e.message}`);
      return [];
    } finally {
      setLoadingYear(false);
    }
  }, []);

  // Fetch frames whenever the selected year changes.
  useEffect(() => {
    if (year == null) return;
    advancingRef.current = false;
    loadYear(year);
  }, [year, loadYear]);

  // Responsive sizing.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const width = el.clientWidth;
      const height = Math.round(Math.max(360, Math.min(680, width * 0.62)));
      setDims({ width, height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [basemap]);

  // Build projection + draw static basemap when basemap / dims change.
  useEffect(() => {
    if (!basemap || !svgRef.current) return;
    const { width, height } = dims;
    const svg = d3.select(svgRef.current);
    svg.attr('width', width).attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`);
    svg.selectAll('*').remove();

    const projection = d3.geoAlbers()
      .rotate([96, 0])
      .center([0, 39])
      .parallels([20, 55])
      .fitExtent([[8, 8], [width - 8, height - 8]], REGION);
    const path = d3.geoPath(projection);
    projectionRef.current = projection;
    pathRef.current = path;
    scaleRef.current = Math.max(0.75, Math.min(1.4, width / 900));

    // Ocean background.
    svg.append('rect')
      .attr('width', width).attr('height', height)
      .attr('class', 'fronts-ocean');

    const basemapG = svg.append('g').attr('class', 'fronts-basemap');
    // Land fill.
    basemapG.append('path')
      .datum({ type: 'GeometryCollection', geometries: basemap.countries })
      .attr('d', path)
      .attr('class', 'fronts-land');
    // State boundaries (light).
    basemapG.append('path')
      .datum({ type: 'GeometryCollection', geometries: basemap.states })
      .attr('d', path)
      .attr('class', 'fronts-states')
      .attr('fill', 'none');
    // Country outlines (stronger).
    basemapG.append('path')
      .datum({ type: 'GeometryCollection', geometries: basemap.countries })
      .attr('d', path)
      .attr('class', 'fronts-borders')
      .attr('fill', 'none');

    basemapGRef.current = basemapG;
    frontsGRef.current = svg.append('g').attr('class', 'fronts-layer');
  }, [basemap, dims]);

  // Draw the current frame's fronts + pressure centers.
  useEffect(() => {
    const g = frontsGRef.current;
    const projection = projectionRef.current;
    if (!g || !projection || frames.length === 0) return;
    const frame = frames[Math.min(frameIndex, frames.length - 1)];
    if (!frame) return;

    g.selectAll('*').remove();
    const scale = scaleRef.current;

    // Fronts (draw troughs first so pipped fronts sit on top).
    FRONT_TYPES.forEach((type) => {
      const lines = frame[type];
      if (!lines) return;
      lines.forEach((line) => {
        const screen = line
          .map(([lat, lon]) => projection([lon, lat]))
          .filter((p) => p && isFinite(p[0]) && isFinite(p[1]));
        if (screen.length >= 2) drawFront(g, screen, type, scale);
      });
    });

    // Pressure centers.
    const drawCenter = (pts, letter, color) => {
      (pts || []).forEach(([lat, lon, pressure]) => {
        const p = projection([lon, lat]);
        if (!p || !isFinite(p[0])) return;
        const cg = g.append('g').attr('transform', `translate(${p[0]},${p[1]})`);
        cg.append('text')
          .attr('class', 'fronts-center-letter')
          .attr('text-anchor', 'middle')
          .attr('dy', '0.35em')
          .style('fill', color)
          .style('font-size', `${16 * scale}px`)
          .text(letter);
        if (pressure != null) {
          cg.append('text')
            .attr('class', 'fronts-center-pressure')
            .attr('text-anchor', 'middle')
            .attr('y', 14 * scale)
            .style('fill', color)
            .style('font-size', `${9 * scale}px`)
            .text(pressure);
        }
      });
    };
    drawCenter(frame.highs, 'H', '#2166ac');
    drawCenter(frame.lows, 'L', '#b2182b');
  }, [frames, frameIndex, dims]);

  // Advance to the next year (or loop back to the first) at end of playback.
  const goToNextYear = useCallback(() => {
    if (!index?.years?.length) return;
    const years = index.years.map((y) => y.year);
    const pos = years.indexOf(year);
    const next = years[(pos + 1) % years.length];
    advancingRef.current = true;
    setFrameIndex(0);
    setYear(next);
  }, [index, year]);

  // Playback loop.
  useEffect(() => {
    if (!playing || frames.length === 0) return;
    const fps = SPEEDS[speedIdx].fps;
    const id = setInterval(() => {
      setFrameIndex((i) => {
        if (i + 1 < frames.length) return i + 1;
        if (!advancingRef.current) goToNextYear();
        return i;
      });
    }, 1000 / fps);
    return () => clearInterval(id);
  }, [playing, speedIdx, frames, goToNextYear]);

  // Reset the advancing guard once new frames arrive.
  useEffect(() => {
    advancingRef.current = false;
  }, [frames]);

  const currentFrame = frames[Math.min(frameIndex, frames.length - 1)];
  const years = index?.years?.map((y) => y.year) || [];

  const handleScrub = (e) => {
    setPlaying(false);
    setFrameIndex(Number(e.target.value));
  };

  const stepBy = (delta) => {
    setPlaying(false);
    setFrameIndex((i) => Math.max(0, Math.min(frames.length - 1, i + delta)));
  };

  return (
    <>
      <header className="app-header">
        <h1>North America Weather Fronts</h1>
        <p className="subtitle">
          Surface fronts, troughs &amp; pressure centers analyzed by the NWS,
          one map per day since 2003
        </p>
      </header>

      <main className="app-main">
        {error && <div className="error">{error}</div>}

        <div className="fronts-controls">
          <button
            className="fronts-play"
            onClick={() => setPlaying((p) => !p)}
            disabled={frames.length === 0}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>

          <button className="nav-button" onClick={() => stepBy(-1)} aria-label="Previous day">‹</button>
          <button className="nav-button" onClick={() => stepBy(1)} aria-label="Next day">›</button>

          <div className="selector-group">
            <label htmlFor="fronts-year">Year</label>
            <select
              id="fronts-year"
              value={year ?? ''}
              onChange={(e) => { setPlaying(false); setFrameIndex(0); setYear(Number(e.target.value)); }}
            >
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <div className="selector-group">
            <label htmlFor="fronts-speed">Speed</label>
            <select
              id="fronts-speed"
              value={speedIdx}
              onChange={(e) => setSpeedIdx(Number(e.target.value))}
            >
              {SPEEDS.map((s, i) => <option key={s.label} value={i}>{s.label}</option>)}
            </select>
          </div>

          <span className="fronts-date">
            {loadingYear ? 'Loading…' : formatDate(currentFrame)}
          </span>
        </div>

        <input
          className="fronts-slider"
          type="range"
          min={0}
          max={Math.max(0, frames.length - 1)}
          value={Math.min(frameIndex, Math.max(0, frames.length - 1))}
          onChange={handleScrub}
          disabled={frames.length === 0}
        />

        <div ref={containerRef} className="fronts-map-container">
          <svg ref={svgRef}></svg>
        </div>

        <div className="fronts-legend">
          {Object.entries(FRONT_STYLES).map(([type, style]) => (
            <span className="fronts-legend-item" key={type}>
              <span className="fronts-swatch" style={{ background: style.color }} />
              {style.label}
            </span>
          ))}
          <span className="fronts-legend-item">
            <span className="fronts-swatch" style={{ background: '#2166ac' }}>H</span>
            High pressure
          </span>
          <span className="fronts-legend-item">
            <span className="fronts-swatch" style={{ background: '#b2182b' }}>L</span>
            Low pressure
          </span>
        </div>
      </main>

      <footer className="app-footer">
        <p>
          Data source:{' '}
          <a href="https://zenodo.org/records/2646544" target="_blank" rel="noopener noreferrer">
            NWS Coded Surface Bulletins (Zenodo 2646544)
          </a>
          {' '}· one bulletin per day near 12:00 UTC, 2003–2018
        </p>
      </footer>
    </>
  );
}
