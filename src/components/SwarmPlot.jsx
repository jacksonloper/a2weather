import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

/**
 * SwarmPlot component for displaying temperature data
 * @param {Object} props
 * @param {Array} props.data - Array of {date, month, day, temp_min, temp_max, temp_mean, year}
 * @param {Array} props.selectedDays - Array of {month, day} to highlight
 */
export default function SwarmPlot({ data, selectedDays }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!data || data.length === 0 || !svgRef.current) return;

    // Get container dimensions
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = 560; // Increased for labels
    const margin = { top: 60, right: 40, bottom: 80, left: 60 }; // Increased top/bottom for labels
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Clear previous content
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Filter data for selected days
    const selectedDaySet = new Set(
      selectedDays.map(d => `${d.month}-${d.day}`)
    );
    
    const filteredData = data.filter(d => 
      selectedDaySet.has(`${d.month}-${d.day}`)
    );

    if (filteredData.length === 0) return;

    // Find the most recent year in the data
    const maxYear = d3.max(filteredData, d => d.year);

    // Create x scale - categorical by month-day
    const dayLabels = selectedDays.map(d => {
      const date = new Date(2000, d.month - 1, d.day);
      return {
        key: `${d.month}-${d.day}`,
        label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      };
    });

    const xScale = d3.scaleBand()
      .domain(dayLabels.map(d => d.key))
      .range([0, innerWidth])
      .padding(0.2);

    // Create y scale - temperature
    const allTemps = filteredData.flatMap(d => [d.temp_min, d.temp_max, d.temp_mean]);
    const yExtent = d3.extent(allTemps);
    const yPadding = (yExtent[1] - yExtent[0]) * 0.1;
    
    const yScale = d3.scaleLinear()
      .domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
      .range([innerHeight, 0]);

    // Color scale for temperature types
    const colorScale = d3.scaleOrdinal()
      .domain(['min', 'mean', 'max'])
      .range(['#4393c3', '#999999', '#d6604d']);

    // Group data by day
    const dataByDay = d3.group(filteredData, d => `${d.month}-${d.day}`);

    // Create jittered points using force simulation for each temperature type
    const tempTypes = ['min', 'mean', 'max'];
    const typeOffset = { min: -0.25, mean: 0, max: 0.25 };

    // Prepare all points
    const allPoints = [];
    
    dataByDay.forEach((dayData, dayKey) => {
      tempTypes.forEach(type => {
        dayData.forEach(d => {
          const temp = type === 'min' ? d.temp_min : type === 'max' ? d.temp_max : d.temp_mean;
          const targetX = xScale(dayKey) + xScale.bandwidth() * (0.5 + typeOffset[type]);
          const targetY = yScale(temp);
          const isLatest = d.year === maxYear;
          allPoints.push({
            dayKey,
            type,
            temp,
            year: d.year,
            date: d.date,
            targetX,
            targetY,
            x: targetX,
            y: targetY,
            isLatest
          });
        });
      });
    });

    // Calculate "years since" stats for each day
    const yearsSinceStats = new Map();
    dataByDay.forEach((dayData, dayKey) => {
      // Find the latest year's data for this day
      const latestData = dayData.find(d => d.year === maxYear);
      if (!latestData) {
        yearsSinceStats.set(dayKey, { low: null, high: null });
        return;
      }
      
      const latestLow = latestData.temp_min;
      const latestHigh = latestData.temp_max;
      
      // Find years with temp at least as low (i.e., <= latestLow)
      const yearsAsLow = dayData
        .filter(d => d.year !== maxYear && d.temp_min <= latestLow)
        .map(d => d.year);
      
      // Find years with temp at least as high (i.e., >= latestHigh)
      const yearsAsHigh = dayData
        .filter(d => d.year !== maxYear && d.temp_max >= latestHigh)
        .map(d => d.year);
      
      // Calculate years since (most recent matching year)
      const mostRecentLow = yearsAsLow.length > 0 ? Math.max(...yearsAsLow) : null;
      const mostRecentHigh = yearsAsHigh.length > 0 ? Math.max(...yearsAsHigh) : null;
      
      yearsSinceStats.set(dayKey, {
        low: mostRecentLow ? maxYear - mostRecentLow : null,
        high: mostRecentHigh ? maxYear - mostRecentHigh : null,
        latestLow,
        latestHigh
      });
    });

    // Apply bee swarm using force simulation per day-type group
    const grouped = d3.group(allPoints, d => `${d.dayKey}-${d.type}`);
    const radius = 3;
    
    grouped.forEach((points) => {
      const simulation = d3.forceSimulation(points)
        .force('x', d3.forceX(d => d.targetX).strength(0.8))
        .force('y', d3.forceY(d => d.targetY).strength(1))
        .force('collide', d3.forceCollide(radius + 0.5))
        .stop();

      for (let i = 0; i < 120; i++) simulation.tick();
    });

    // Draw x-axis
    const xAxis = d3.axisBottom(xScale)
      .tickFormat(key => dayLabels.find(d => d.key === key)?.label || key);
    
    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .selectAll('text')
      .style('font-size', '12px');

    // Draw y-axis
    const yAxis = d3.axisLeft(yScale)
      .tickFormat(d => `${d}°F`);
    
    g.append('g')
      .attr('class', 'y-axis')
      .call(yAxis)
      .selectAll('text')
      .style('font-size', '12px');

    // Y-axis label
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -45)
      .attr('x', -innerHeight / 2)
      .attr('text-anchor', 'middle')
      .style('font-size', '14px')
      .style('fill', 'currentColor')
      .text('Temperature (°F)');

    // Draw regular points (non-latest years)
    g.selectAll('circle.regular')
      .data(allPoints.filter(d => !d.isLatest))
      .join('circle')
      .attr('class', 'regular')
      .attr('cx', d => d.x)
      .attr('cy', d => d.y)
      .attr('r', radius)
      .attr('fill', d => colorScale(d.type))
      .attr('opacity', 0.5)
      .attr('stroke', d => colorScale(d.type))
      .attr('stroke-width', 0.5)
      .append('title')
      .text(d => `${d.date}\n${d.type === 'min' ? 'Low' : d.type === 'max' ? 'High' : 'Avg'}: ${d.temp}°F`);

    // Draw latest year points with highlighting
    g.selectAll('circle.latest')
      .data(allPoints.filter(d => d.isLatest))
      .join('circle')
      .attr('class', 'latest')
      .attr('cx', d => d.x)
      .attr('cy', d => d.y)
      .attr('r', radius + 2)
      .attr('fill', d => colorScale(d.type))
      .attr('opacity', 1)
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .append('title')
      .text(d => `${d.date} (Latest)\n${d.type === 'min' ? 'Low' : d.type === 'max' ? 'High' : 'Avg'}: ${d.temp}°F`);

    // Draw "years since" labels above and below each swarm
    dayLabels.forEach(({ key }) => {
      const stats = yearsSinceStats.get(key);
      const xPos = xScale(key) + xScale.bandwidth() / 2;
      
      // High label (above)
      g.append('text')
        .attr('class', 'years-since-label high')
        .attr('x', xPos)
        .attr('y', -25)
        .attr('text-anchor', 'middle')
        .style('font-size', '11px')
        .style('fill', '#d6604d')
        .style('font-weight', 'bold')
        .text(stats?.high != null ? `${stats.high}y` : '—');
      
      // Low label (below)
      g.append('text')
        .attr('class', 'years-since-label low')
        .attr('x', xPos)
        .attr('y', innerHeight + 45)
        .attr('text-anchor', 'middle')
        .style('font-size', '11px')
        .style('fill', '#4393c3')
        .style('font-weight', 'bold')
        .text(stats?.low != null ? `${stats.low}y` : '—');
    });

    // Legend
    const legend = g.append('g')
      .attr('class', 'legend')
      .attr('transform', `translate(${innerWidth - 180}, -40)`);

    const legendData = [
      { type: 'min', label: 'Low' },
      { type: 'mean', label: 'Avg' },
      { type: 'max', label: 'High' }
    ];

    legendData.forEach((d, i) => {
      const legendRow = legend.append('g')
        .attr('transform', `translate(${i * 60}, 0)`);
      
      legendRow.append('circle')
        .attr('r', 5)
        .attr('fill', colorScale(d.type))
        .attr('opacity', 0.7);
      
      legendRow.append('text')
        .attr('x', 10)
        .attr('y', 4)
        .style('font-size', '12px')
        .style('fill', 'currentColor')
        .text(d.label);
    });

    // Latest year indicator in legend
    legend.append('circle')
      .attr('cx', 180)
      .attr('r', 5)
      .attr('fill', '#999')
      .attr('stroke', '#fff')
      .attr('stroke-width', 2);
    
    legend.append('text')
      .attr('x', 190)
      .attr('y', 4)
      .style('font-size', '12px')
      .style('fill', 'currentColor')
      .text(`${maxYear}`);

  }, [data, selectedDays]);

  return (
    <div ref={containerRef} className="swarm-plot-container">
      <svg ref={svgRef}></svg>
    </div>
  );
}
