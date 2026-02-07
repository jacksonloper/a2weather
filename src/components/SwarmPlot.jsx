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
    const height = 500;
    const margin = { top: 40, right: 40, bottom: 60, left: 60 };
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
          allPoints.push({
            dayKey,
            type,
            temp,
            year: d.year,
            date: d.date,
            targetX,
            targetY,
            x: targetX,
            y: targetY
          });
        });
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

    // Draw points
    g.selectAll('circle')
      .data(allPoints)
      .join('circle')
      .attr('cx', d => d.x)
      .attr('cy', d => d.y)
      .attr('r', radius)
      .attr('fill', d => colorScale(d.type))
      .attr('opacity', 0.6)
      .attr('stroke', d => colorScale(d.type))
      .attr('stroke-width', 0.5)
      .append('title')
      .text(d => `${d.date}\n${d.type === 'min' ? 'Low' : d.type === 'max' ? 'High' : 'Avg'}: ${d.temp}°F`);

    // Legend
    const legend = g.append('g')
      .attr('class', 'legend')
      .attr('transform', `translate(${innerWidth - 100}, -20)`);

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

  }, [data, selectedDays]);

  return (
    <div ref={containerRef} className="swarm-plot-container">
      <svg ref={svgRef}></svg>
    </div>
  );
}
