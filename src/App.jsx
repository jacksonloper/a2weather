import { useState, useEffect, useMemo, useCallback } from 'react';
import { addDays, subDays } from 'date-fns';
import SwarmPlot from './components/SwarmPlot';
import DateRangeSelector from './components/DateRangeSelector';
import DataSourceSelector from './components/DataSourceSelector';
import './App.css';

// Available data sources
const DATA_SOURCES = [
  { 
    id: 'openmeteo', 
    name: 'Open-Meteo', 
    path: '/data/openmeteo/temps.csv',
    location: {
      name: 'Ann Arbor, MI',
      latitude: 42.2808,
      longitude: -83.7430
    }
  }
];

function App() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [source, setSource] = useState('openmeteo');
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Memoize the expanded change callback to prevent unnecessary re-renders
  const handleExpandedChange = useCallback((expanded) => {
    setIsExpanded(expanded);
  }, []);
  
  // Default to today's date
  const today = new Date();
  const [centerDate, setCenterDate] = useState(
    new Date(2000, today.getMonth(), today.getDate())
  );
  const [daysRange, setDaysRange] = useState(3);

  // Calculate selected days based on center date and range
  const selectedDays = useMemo(() => {
    const days = [];
    for (let i = -daysRange; i <= daysRange; i++) {
      const date = i === 0 ? centerDate : (i < 0 ? subDays(centerDate, -i) : addDays(centerDate, i));
      days.push({
        month: date.getMonth() + 1,
        day: date.getDate()
      });
    }
    return days;
  }, [centerDate, daysRange]);

  // Load data when source changes
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      
      const sourceConfig = DATA_SOURCES.find(s => s.id === source);
      if (!sourceConfig) {
        setError('Unknown data source');
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(sourceConfig.path);
        if (!response.ok) {
          throw new Error(`Failed to load data: ${response.statusText}`);
        }
        
        const csvText = await response.text();
        const lines = csvText.trim().split('\n').map(line => line.replace(/\r$/, ''));
        const headers = lines[0].split(',');
        
        const parsedData = lines.slice(1).map(line => {
          const values = line.split(',');
          const row = {};
          headers.forEach((header, i) => {
            row[header] = values[i];
          });
          
          // Parse date components
          const [year, month, day] = row.date.split('-').map(Number);
          
          return {
            date: row.date,
            year,
            month,
            day,
            temp_min: parseFloat(row.temp_min),
            temp_max: parseFloat(row.temp_max),
            temp_mean: parseFloat(row.temp_mean)
          };
        });
        
        setData(parsedData);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [source]);

  // Calculate data statistics
  const stats = useMemo(() => {
    if (data.length === 0) return null;
    
    const years = data.map(d => d.year);
    return {
      totalRecords: data.length,
      yearRange: `${Math.min(...years)} - ${Math.max(...years)}`
    };
  }, [data]);

  // Get current source config for display
  const currentSource = useMemo(() => 
    DATA_SOURCES.find(s => s.id === source),
    [source]
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>Ann Arbor Historical Weather</h1>
        <p className="subtitle">Daily temperature records for Ann Arbor, Michigan</p>
      </header>
      
      <main className="app-main">
        {!isExpanded && (
          <div className="controls">
            <DataSourceSelector
              source={source}
              sources={DATA_SOURCES}
              onSourceChange={setSource}
            />
            <DateRangeSelector
              centerDate={centerDate}
              daysRange={daysRange}
              onCenterDateChange={setCenterDate}
              onDaysRangeChange={setDaysRange}
            />
          </div>
        )}

        {loading && (
          <div className="loading">Loading weather data...</div>
        )}
        
        {error && (
          <div className="error">Error: {error}</div>
        )}
        
        {!loading && !error && data.length > 0 && (
          <>
            <SwarmPlot data={data} selectedDays={selectedDays} onExpandedChange={handleExpandedChange} />
            {stats && (
              <div className="stats">
                <p>
                  Showing data from <strong>{stats.yearRange}</strong> 
                  {' '}({stats.totalRecords.toLocaleString()} total records)
                </p>
              </div>
            )}
          </>
        )}
      </main>
      
      <footer className="app-footer">
        <p>
          Data source: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>
          {currentSource?.location && (
            <span className="location-info">
              {' '}| Location: {currentSource.location.name} ({currentSource.location.latitude}°, {currentSource.location.longitude}°)
            </span>
          )}
        </p>
      </footer>
    </div>
  );
}

export default App;
