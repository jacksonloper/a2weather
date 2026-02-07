/**
 * DataSourceSelector component for selecting the weather data source
 * @param {Object} props
 * @param {string} props.source - Currently selected source
 * @param {Array} props.sources - Available sources
 * @param {Function} props.onSourceChange - Callback when source changes
 */
export default function DataSourceSelector({ source, sources, onSourceChange }) {
  return (
    <div className="data-source-selector">
      <label htmlFor="source-select">Data Source:</label>
      <select 
        id="source-select" 
        value={source} 
        onChange={(e) => onSourceChange(e.target.value)}
      >
        {sources.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </div>
  );
}
