import { format, addDays, subDays, getDaysInMonth } from 'date-fns';

/**
 * DateRangeSelector component for selecting a center date with ± days range
 * @param {Object} props
 * @param {Date} props.centerDate - The center date
 * @param {number} props.daysRange - Number of days before and after (default: 3)
 * @param {Function} props.onCenterDateChange - Callback when center date changes
 * @param {Function} props.onDaysRangeChange - Callback when days range changes
 */
export default function DateRangeSelector({ 
  centerDate, 
  daysRange = 3, 
  onCenterDateChange, 
  onDaysRangeChange 
}) {
  const month = centerDate.getMonth() + 1;
  const day = centerDate.getDate();

  const handleMonthChange = (e) => {
    const newMonth = parseInt(e.target.value, 10);
    const maxDay = getDaysInMonth(new Date(2000, newMonth - 1, 1));
    const newDay = Math.min(day, maxDay);
    onCenterDateChange(new Date(2000, newMonth - 1, newDay));
  };

  const handleDayChange = (e) => {
    const newDay = parseInt(e.target.value, 10);
    onCenterDateChange(new Date(2000, month - 1, newDay));
  };

  const handleRangeChange = (e) => {
    onDaysRangeChange(parseInt(e.target.value, 10));
  };

  // Navigate by 2n+1 days (full window width)
  const stepDays = 2 * daysRange + 1;
  
  const handlePrev = () => {
    onCenterDateChange(subDays(centerDate, stepDays));
  };
  
  const handleNext = () => {
    onCenterDateChange(addDays(centerDate, stepDays));
  };

  const daysInMonth = getDaysInMonth(new Date(2000, month - 1, 1));

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Calculate the displayed date range
  const startDate = subDays(centerDate, daysRange);
  const endDate = addDays(centerDate, daysRange);
  const rangeText = `${format(startDate, 'MMM d')} - ${format(endDate, 'MMM d')}`;

  return (
    <div className="date-range-selector">
      <button 
        className="nav-button" 
        onClick={handlePrev}
        title={`Go back ${stepDays} days`}
      >
        ◀
      </button>
      
      <div className="selector-group">
        <label htmlFor="month-select">Month:</label>
        <select 
          id="month-select" 
          value={month} 
          onChange={handleMonthChange}
        >
          {months.map((m, i) => (
            <option key={i + 1} value={i + 1}>{m}</option>
          ))}
        </select>
      </div>
      
      <div className="selector-group">
        <label htmlFor="day-select">Day:</label>
        <select 
          id="day-select" 
          value={day} 
          onChange={handleDayChange}
        >
          {Array.from({ length: daysInMonth }, (_, i) => (
            <option key={i + 1} value={i + 1}>{i + 1}</option>
          ))}
        </select>
      </div>
      
      <div className="selector-group">
        <label htmlFor="range-select">± Days:</label>
        <select 
          id="range-select" 
          value={daysRange} 
          onChange={handleRangeChange}
        >
          {[0, 1, 2, 3, 5, 7, 14].map(r => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      
      <div className="range-display">
        Showing: <strong>{rangeText}</strong>
      </div>
      
      <button 
        className="nav-button" 
        onClick={handleNext}
        title={`Go forward ${stepDays} days`}
      >
        ▶
      </button>
    </div>
  );
}
