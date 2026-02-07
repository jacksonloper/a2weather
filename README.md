# Ann Arbor Historical Weather

A lightweight React + Vite website displaying historical weather data for Ann Arbor, Michigan.  Live at https://main--a2weather.netlify.app/ and production at https://a2weather.netlify.app/

## Features

- **Swarm Plot Visualization**: View daily low, average, and high temperatures as a bee swarm plot
- **Date Selection**: Select any day of the year and view ± 0-14 days of historical data
- **Multiple Data Sources**: Currently supports Open-Meteo (more sources planned)
- **75+ Years of Data**: Historical records from 1950 to present

## Tech Stack

- **Frontend**: React 19 + Vite
- **Visualization**: D3.js
- **Data Ingestion**: Python
- **Hosting**: Netlify

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Data Management

Weather data is stored in CSV format under `public/data/`. Each data source has its own subdirectory.

### Updating Weather Data

Run the update script manually:

```bash
python scripts/fetch_openmeteo.py
```

Or trigger the GitHub Action:
1. Go to Actions tab
2. Select "Update Weather Data" workflow
3. Click "Run workflow"
4. Select the data source and run

## Project Structure

```
├── public/
│   └── data/
│       └── openmeteo/
│           └── temps.csv       # Temperature data
├── scripts/
│   └── fetch_openmeteo.py      # Data ingestion script
├── src/
│   ├── components/
│   │   ├── DataSourceSelector.jsx
│   │   ├── DateRangeSelector.jsx
│   │   └── SwarmPlot.jsx
│   ├── App.jsx
│   ├── App.css
│   ├── main.jsx
│   └── index.css
├── .github/
│   └── workflows/
│       └── update-weather-data.yml
├── netlify.toml
└── package.json
```

## Data Sources

### Open-Meteo
- Free historical weather API
- Data available from 1940 to present
- Updates daily

## License

MIT
