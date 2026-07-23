import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';

const DATA_DIR = '/data/wind';
const META_PATH = `${DATA_DIR}/wind_meta.json`;
const STATES_PATH = `${DATA_DIR}/us-states.json`;

const DAYS_PER_SECOND = 1;        // playback rate (~1 second of wall clock per day)
const MAX_PARTICLE_AGE = 90;      // frames before a particle respawns
const FADE = 0.12;                // trail fade strength (higher = shorter trails)
const REFERENCE_WIDTH = 900;      // width the motion scale is tuned for
const BASE_SPEED = 0.42;          // pixels per (m/s) per frame at reference width

// Precompute a color lookup table (turbo ramp) for wind speed.
const LUT_SIZE = 64;
const COLOR_LUT = Array.from({ length: LUT_SIZE }, (_, i) =>
  d3.interpolateTurbo(0.12 + 0.85 * (i / (LUT_SIZE - 1)))
);

// Convert a frame index (each `stepHours` apart from startDate) to a label.
function formatFrame(meta, frameIndex) {
  const [y, m, d] = meta.startDate.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  const dt = new Date(base + frameIndex * (meta.stepHours || 24) * 3600 * 1000);
  const date = dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const hh = String(dt.getUTCHours()).padStart(2, '0');
  return `${date} · ${hh}:00 UTC`;
}

export default function WindMap() {
  const containerRef = useRef(null);
  const mapCanvasRef = useRef(null);
  const particleCanvasRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState(null);
  const [playing, setPlaying] = useState(true);
  const [displayFrame, setDisplayFrame] = useState(0);

  // Mutable animation state kept in refs so the render loop never re-subscribes.
  const dataRef = useRef(null);        // Int16Array of u/v components
  const statesRef = useRef(null);      // GeoJSON boundaries
  const timeRef = useRef(0);           // current fractional frame index
  const playingRef = useRef(true);
  const particlesRef = useRef([]);
  const dimsRef = useRef(null);        // { W, H, dpr, project(), sample() }
  const rafRef = useRef(0);

  playingRef.current = playing;

  // --- Load data -----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const metaRes = await fetch(META_PATH);
        if (!metaRes.ok) throw new Error('Wind data not found');
        const m = await metaRes.json();

        const [binRes, statesRes] = await Promise.all([
          fetch(`${DATA_DIR}/${m.bin}`),
          fetch(STATES_PATH),
        ]);
        if (!binRes.ok) throw new Error('Failed to load wind field');
        const buf = await binRes.arrayBuffer();
        const states = statesRes.ok ? await statesRes.json() : null;

        if (cancelled) return;
        dataRef.current = new Int16Array(buf);
        statesRef.current = states;
        setMeta(m);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // --- Geometry helpers ----------------------------------------------------
  const buildDims = useCallback((m) => {
    const container = containerRef.current;
    const lonSpan = m.step * (m.nlon - 1);
    const latSpan = m.step * (m.nlat - 1);
    const latMax = m.latMin + latSpan;
    const midLat = (m.latMin + latMax) / 2;
    const cosMid = Math.cos((midLat * Math.PI) / 180);
    const geoAspect = (lonSpan * cosMid) / latSpan;

    const cssW = Math.min(container.clientWidth, 1000);
    const cssH = Math.round(cssW / geoAspect);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = cssW * dpr;
    const H = cssH * dpr;

    const project = (lon, lat) => [
      ((lon - m.lonMin) / lonSpan) * W,
      ((latMax - lat) / latSpan) * H,
    ];
    const unproject = (x, y) => [
      m.lonMin + (x / W) * lonSpan,
      latMax - (y / H) * latSpan,
    ];

    const { nlon, nlat, scale, nframes } = m;
    const cellStride = nlon * nlat * 2;

    // Bilinear (space) + linear (time) sample of the wind at a fractional frame.
    const sample = (frameFloat, lon, lat) => {
      const data = dataRef.current;
      const gx = (lon - m.lonMin) / m.step;
      const gy = (lat - m.latMin) / m.step;
      if (gx < 0 || gx > nlon - 1 || gy < 0 || gy > nlat - 1) return null;

      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const x1 = Math.min(x0 + 1, nlon - 1);
      const y1 = Math.min(y0 + 1, nlat - 1);
      const fx = gx - x0;
      const fy = gy - y0;

      const f0 = Math.floor(frameFloat) % nframes;
      const f1 = (f0 + 1) % nframes;
      const ft = frameFloat - Math.floor(frameFloat);

      const at = (frame, col, row, comp) =>
        data[frame * cellStride + (row * nlon + col) * 2 + comp] / scale;

      const lerp = (a, b, t) => a + (b - a) * t;

      const bilin = (frame, comp) => {
        const v00 = at(frame, x0, y0, comp);
        const v10 = at(frame, x1, y0, comp);
        const v01 = at(frame, x0, y1, comp);
        const v11 = at(frame, x1, y1, comp);
        return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
      };

      const u = lerp(bilin(f0, 0), bilin(f1, 0), ft);
      const v = lerp(bilin(f0, 1), bilin(f1, 1), ft);
      return [u, v];
    };

    return { W, H, cssW, cssH, dpr, project, unproject, sample };
  }, []);

  const drawMap = useCallback((m, dims) => {
    const canvas = mapCanvasRef.current;
    if (!canvas) return;
    const { W, H, cssW, cssH, project } = dims;
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    // Ocean / background.
    ctx.fillStyle = dark ? '#0e1726' : '#e8eef5';
    ctx.fillRect(0, 0, W, H);

    const states = statesRef.current;
    if (!states) return;

    ctx.fillStyle = dark ? '#16202f' : '#f7f9fc';
    ctx.strokeStyle = dark ? 'rgba(150,170,200,0.35)' : 'rgba(80,100,130,0.45)';
    ctx.lineWidth = Math.max(0.6, dims.dpr * 0.5);

    const drawRing = (ring) => {
      ctx.beginPath();
      ring.forEach(([lon, lat], i) => {
        const [px, py] = project(lon, lat);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };

    for (const feat of states.features) {
      const { type, coordinates } = feat.geometry;
      if (type === 'Polygon') {
        coordinates.forEach(drawRing);
      } else if (type === 'MultiPolygon') {
        coordinates.forEach((poly) => poly.forEach(drawRing));
      }
    }
  }, []);

  const spawnParticles = useCallback((dims) => {
    const { W, H } = dims;
    const count = Math.max(1500, Math.min(6000, Math.round((W * H) / 900)));
    const particles = new Array(count);
    for (let i = 0; i < count; i++) {
      particles[i] = {
        x: Math.random() * W,
        y: Math.random() * H,
        age: Math.floor(Math.random() * MAX_PARTICLE_AGE),
      };
    }
    particlesRef.current = particles;
  }, []);

  // --- Setup canvases + animation loop ------------------------------------
  useEffect(() => {
    if (!meta || loading) return;

    let lastTs = performance.now();

    const setup = () => {
      const dims = buildDims(meta);
      dimsRef.current = dims;

      const pc = particleCanvasRef.current;
      pc.width = dims.W;
      pc.height = dims.H;
      pc.style.width = `${dims.cssW}px`;
      pc.style.height = `${dims.cssH}px`;

      drawMap(meta, dims);
      spawnParticles(dims);
    };
    setup();

    const speedScale = () =>
      (BASE_SPEED * dimsRef.current.cssW) / REFERENCE_WIDTH;

    const step = (ts) => {
      const dims = dimsRef.current;
      const { W, H, unproject, sample } = dims;
      const dt = Math.min((ts - lastTs) / 1000, 0.05);
      lastTs = ts;

      // Advance the playback clock. Frames are `stepHours` apart, so playing at
      // DAYS_PER_SECOND means (24 / stepHours) frames of wall-clock per second.
      const framesPerSecond = (24 / (meta.stepHours || 24)) * DAYS_PER_SECOND;
      if (playingRef.current) {
        timeRef.current =
          (timeRef.current + dt * framesPerSecond) % meta.nframes;
        const frameInt = Math.floor(timeRef.current);
        setDisplayFrame((prev) => (prev === frameInt ? prev : frameInt));
      }

      const ctx = particleCanvasRef.current.getContext('2d');
      // Fade previous trails without covering the map underneath.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${FADE})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = Math.max(1, dims.dpr);

      const frame = timeRef.current;
      const scale = speedScale();
      const particles = particlesRef.current;
      const speedMax = meta.speedMax || 25;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.age++;
        if (p.age > MAX_PARTICLE_AGE) {
          p.x = Math.random() * W;
          p.y = Math.random() * H;
          p.age = 0;
          continue;
        }
        const [lon, lat] = unproject(p.x, p.y);
        const wind = sample(frame, lon, lat);
        if (!wind) {
          p.age = MAX_PARTICLE_AGE + 1;
          continue;
        }
        const [u, v] = wind;
        const nx = p.x + u * scale * dims.dpr;
        const ny = p.y - v * scale * dims.dpr; // north is up

        const speed = Math.hypot(u, v);
        const t = Math.min(1, speed / speedMax);
        ctx.strokeStyle = COLOR_LUT[Math.min(LUT_SIZE - 1, (t * (LUT_SIZE - 1)) | 0)];

        if (nx < 0 || nx > W || ny < 0 || ny > H) {
          p.age = MAX_PARTICLE_AGE + 1;
        } else {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(nx, ny);
          ctx.stroke();
          p.x = nx;
          p.y = ny;
        }
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);

    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      setup();
      lastTs = performance.now();
      rafRef.current = requestAnimationFrame(step);
    });
    ro.observe(containerRef.current);

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onTheme = () => drawMap(meta, dimsRef.current);
    mq.addEventListener('change', onTheme);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      mq.removeEventListener('change', onTheme);
    };
  }, [meta, loading, buildDims, drawMap, spawnParticles]);

  const handleScrub = useCallback((e) => {
    const frame = Number(e.target.value);
    timeRef.current = frame;
    setDisplayFrame(frame);
  }, []);

  if (loading) {
    return <div className="loading">Loading wind data...</div>;
  }
  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  const speedMax = meta.speedMax || 25;
  const stepHours = meta.stepHours || 24;

  return (
    <div className="wind-map">
      <div className="wind-canvas-wrap" ref={containerRef}>
        <canvas ref={mapCanvasRef} className="wind-layer" />
        <canvas ref={particleCanvasRef} className="wind-layer wind-particles" />
        <div className="wind-date-badge">{formatFrame(meta, displayFrame)}</div>
      </div>

      <div className="wind-controls">
        <button
          className="nav-button wind-play"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : '►'}
        </button>
        <input
          type="range"
          min={0}
          max={meta.nframes - 1}
          value={displayFrame}
          onChange={handleScrub}
          className="wind-slider"
          aria-label="Timestep"
        />
        <div className="wind-legend">
          <span className="wind-legend-label">0</span>
          <div className="wind-legend-bar" />
          <span className="wind-legend-label">{speedMax}+ m/s</span>
        </div>
      </div>
      <p className="wind-hint">
        Animated 100&nbsp;m wind at {stepHours}-hour steps, roughly one second per
        day. Colors show wind speed; streamlines trace the flow. Drag the slider
        to scrub through time.
      </p>
    </div>
  );
}
