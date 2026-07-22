import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { drawFront, FRONT_STYLES } from './frontsGeometry';

// Geographic window fit to the SVG: North America + surrounding oceans.
const REGION = {
  type: 'Polygon',
  coordinates: [[[-150, 12], [-52, 12], [-52, 60], [-150, 60], [-150, 12]]],
};

const FRONT_TYPES = ['trough', 'stationary', 'occluded', 'warm', 'cold'];

// Playback speeds in frames per second. Frames are 3-hourly, so 8 fps is
// roughly one day of weather per second.
const SPEEDS = [
  { label: '0.5×', fps: 4 },
  { label: '1×', fps: 8 },
  { label: '2×', fps: 16 },
  { label: '4×', fps: 30 },
];

const MAX_ZOOM = 8;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatStamp(frame) {
  if (!frame) return '';
  const [y, m, d] = frame.date.split('-').map(Number);
  const hh = String(frame.hour).padStart(2, '0');
  return `${MONTHS[m - 1]} ${d}, ${y} · ${hh}:00 UTC`;
}

export default function FrontsPage() {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const zoomRootRef = useRef(null);
  const frontsGRef = useRef(null);
  const projectionRef = useRef(null);
  const zoomRef = useRef(null);
  const scaleRef = useRef(1);

  const [basemap, setBasemap] = useState(null);
  const [index, setIndex] = useState(null);
  const [episodeId, setEpisodeId] = useState(null);
  const [frames, setFrames] = useState([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [loadingEpisode, setLoadingEpisode] = useState(false);
  const [error, setError] = useState(null);
  const [dims, setDims] = useState({ width: 900, height: 560 });

  const episodeCache = useRef(new Map());

  // Load index + basemap once.
  useEffect(() => {
    Promise.all([
      fetch('/data/fronts/index.json').then((r) => r.json()),
      fetch('/data/fronts/basemap.json').then((r) => r.json()),
    ])
      .then(([idx, base]) => {
        setIndex(idx);
        setBasemap(base);
        if (idx.episodes?.length) setEpisodeId(idx.episodes[0].id);
      })
      .catch((e) => setError(`Failed to load fronts data: ${e.message}`));
  }, []);

  // Load an episode's frames (cached).
  const loadEpisode = useCallback(async (id) => {
    if (episodeCache.current.has(id)) {
      setFrames(episodeCache.current.get(id));
      return;
    }
    setLoadingEpisode(true);
    try {
      const res = await fetch(`/data/fronts/episodes/${id}.json`);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      episodeCache.current.set(id, data);
      setFrames(data);
    } catch (e) {
      setError(`Failed to load episode: ${e.message}`);
    } finally {
      setLoadingEpisode(false);
    }
  }, []);

  useEffect(() => {
    if (episodeId == null) return;
    setFrameIndex(0);
    loadEpisode(episodeId);
  }, [episodeId, loadEpisode]);

  // Responsive sizing.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const width = el.clientWidth;
      const height = Math.round(Math.max(340, Math.min(640, width * 0.64)));
      setDims({ width, height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [basemap]);

  // Build projection, draw the static basemap, and wire up pan/zoom.
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
    scaleRef.current = Math.max(0.75, Math.min(1.4, width / 900));

    // Fixed ocean background (stays put while the map pans/zooms above it).
    svg.append('rect')
      .attr('width', width).attr('height', height)
      .attr('class', 'fronts-ocean');

    // Everything below receives the zoom transform.
    const zoomRoot = svg.append('g').attr('class', 'fronts-zoom-root');
    zoomRootRef.current = zoomRoot;

    const basemapG = zoomRoot.append('g').attr('class', 'fronts-basemap');
    basemapG.append('path')
      .datum({ type: 'GeometryCollection', geometries: basemap.countries })
      .attr('d', path)
      .attr('class', 'fronts-land');
    basemapG.append('path')
      .datum({ type: 'GeometryCollection', geometries: basemap.states })
      .attr('d', path)
      .attr('class', 'fronts-states')
      .attr('fill', 'none');
    basemapG.append('path')
      .datum({ type: 'GeometryCollection', geometries: basemap.countries })
      .attr('d', path)
      .attr('class', 'fronts-borders')
      .attr('fill', 'none');

    frontsGRef.current = zoomRoot.append('g').attr('class', 'fronts-layer');

    const zoom = d3.zoom()
      .scaleExtent([1, MAX_ZOOM])
      .translateExtent([[0, 0], [width, height]])
      .on('zoom', (event) => zoomRoot.attr('transform', event.transform));
    zoomRef.current = zoom;
    svg.call(zoom).on('dblclick.zoom', null);
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

  // Playback loop (loops within the episode).
  useEffect(() => {
    if (!playing || frames.length === 0) return;
    const fps = SPEEDS[speedIdx].fps;
    const id = setInterval(() => {
      setFrameIndex((i) => (i + 1) % frames.length);
    }, 1000 / fps);
    return () => clearInterval(id);
  }, [playing, speedIdx, frames]);

  // Zoom button helpers.
  const zoomBy = (k) => {
    if (!zoomRef.current || !svgRef.current) return;
    d3.select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, k);
  };
  const zoomReset = () => {
    if (!zoomRef.current || !svgRef.current) return;
    d3.select(svgRef.current).transition().duration(300)
      .call(zoomRef.current.transform, d3.zoomIdentity);
  };

  const currentFrame = frames[Math.min(frameIndex, frames.length - 1)];
  const episodes = index?.episodes || [];
  const currentEpisode = episodes.find((e) => e.id === episodeId);

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
          Play 3-hourly NWS surface analyses — fronts, troughs &amp; pressure
          centers — for 24-day episodes since 2003
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

          <button className="nav-button" onClick={() => stepBy(-1)} aria-label="Previous frame">‹</button>
          <button className="nav-button" onClick={() => stepBy(1)} aria-label="Next frame">›</button>

          <div className="selector-group">
            <label htmlFor="fronts-episode">Episode</label>
            <select
              id="fronts-episode"
              value={episodeId ?? ''}
              onChange={(e) => { setPlaying(false); setEpisodeId(e.target.value); }}
            >
              {episodes.map((ep) => <option key={ep.id} value={ep.id}>{ep.label}</option>)}
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
            {loadingEpisode ? 'Loading…' : formatStamp(currentFrame)}
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
          <div className="fronts-zoom-buttons">
            <button onClick={() => zoomBy(1.6)} aria-label="Zoom in">+</button>
            <button onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out">−</button>
            <button onClick={zoomReset} aria-label="Reset zoom" title="Reset view">⤢</button>
          </div>
        </div>

        {currentEpisode && (
          <p className="fronts-episode-note">
            <strong>{currentEpisode.label}:</strong> {currentEpisode.note}
            {' '}({currentEpisode.start} → {currentEpisode.end}, {currentEpisode.frames} frames).
            Drag or pinch the map to zoom.
          </p>
        )}

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
          {' '}· full 3-hourly resolution, high-resolution analysis where available
        </p>
      </footer>
    </>
  );
}
