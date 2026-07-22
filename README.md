# Ann Arbor Historical Weather

A lightweight React + Vite website displaying historical weather data for Ann Arbor, Michigan.  Live at https://main--a2weather.netlify.app/ and production at https://a2weather.netlify.app/

The site has two pages (switch with the nav at the top, or via the URL hash):

- **Ann Arbor Temps** (`#/weather`) — daily temperature history
- **North America Fronts** (`#/fronts`) — an animated player of surface weather fronts

## Features

### Ann Arbor Temps
- **Swarm Plot Visualization**: View daily low, average, and high temperatures as a bee swarm plot
- **Date Selection**: Select any day of the year and view ± 0-14 days of historical data
- **Multiple Data Sources**: Currently supports Open-Meteo (more sources planned)
- **75+ Years of Data**: Historical records from 1950 to present

### North America Fronts
- **Playable surface analysis**: Press play to animate one weather map per day from 2003 to 2018
- **Real NWS symbology**: Cold fronts (blue triangles), warm fronts (red semicircles), stationary and occluded fronts, troughs, and H/L pressure centers with millibar values
- **Scrub & step**: Drag the timeline, step day-by-day, jump to any year, and adjust playback speed
- **Source**: [NWS Coded Surface Bulletins](https://zenodo.org/records/2646544) (Zenodo record 2646544), one bulletin per day near 12:00 UTC

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
│       ├── openmeteo/
│       │   └── temps.csv       # Temperature data
│       └── fronts/             # Weather fronts frames + basemap
│           ├── index.json
│           ├── basemap.json
│           └── 2003.json ...   # one file per year
├── scripts/
│   ├── fetch_openmeteo.py      # Temperature data ingestion
│   ├── process_fronts.py       # Fronts JSON pre-processor
│   └── build_basemap.py        # North America basemap builder
├── src/
│   ├── components/
│   │   ├── DataSourceSelector.jsx
│   │   ├── DateRangeSelector.jsx
│   │   ├── SwarmPlot.jsx
│   │   ├── WeatherPage.jsx     # Ann Arbor temps page
│   │   ├── FrontsPage.jsx      # Fronts player page
│   │   └── frontsGeometry.js   # Front-symbol drawing helpers
│   ├── App.jsx                 # Hash router + nav
│   ├── App.css
│   ├── main.jsx
│   └── index.css
├── .github/
│   └── workflows/
│       └── update-weather-data.yml
├── netlify.toml
└── package.json
```

### Weather Fronts Data

The fronts player is driven by pre-processed JSON under `public/data/fronts/`
(per-year frame files plus `basemap.json` and `index.json`). To regenerate it:

```bash
# 1. Download the source archive (77 MB) from Zenodo
curl -sSL -o CODSUS.tgz \
  https://zenodo.org/api/records/2646544/files/CODSUS_JSON_2003-2018.tgz/content

# 2. Build one daily frame per year (~1 MB/year)
python scripts/process_fronts.py CODSUS.tgz

# 3. Rebuild the North America basemap (needs the two Natural Earth GeoJSON files)
python scripts/build_basemap.py ne_110m_admin_0_countries.geojson \
                                ne_110m_admin_1_states_provinces.geojson
```

## Data Sources

### Open-Meteo
- Free historical weather API
- Data available from 1940 to present
- Updates daily

### NWS Coded Surface Bulletins
- Locations of fronts, troughs, and pressure centers analyzed every 3 hours by the Weather Prediction Center
- Coverage 2003–2018 ([Zenodo 2646544](https://zenodo.org/records/2646544))
- Basemap from [Natural Earth](https://www.naturalearthdata.com/) 110m data

## License

MIT
