import { useState, useEffect } from 'react';
import WeatherPage from './components/WeatherPage';
import FrontsPage from './components/FrontsPage';
import './App.css';

// Minimal hash-based routing so each view has a shareable URL.
const ROUTES = {
  '#/fronts': 'fronts',
  '#/weather': 'weather',
  '': 'weather',
};

function currentRoute() {
  return ROUTES[window.location.hash] ?? 'weather';
}

function App() {
  const [route, setRoute] = useState(currentRoute());

  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <div className="app">
      <nav className="app-nav">
        <a
          href="#/weather"
          className={route === 'weather' ? 'active' : ''}
        >
          Ann Arbor Temps
        </a>
        <a
          href="#/fronts"
          className={route === 'fronts' ? 'active' : ''}
        >
          North America Fronts
        </a>
      </nav>

      {route === 'fronts' ? <FrontsPage /> : <WeatherPage />}
    </div>
  );
}

export default App;
