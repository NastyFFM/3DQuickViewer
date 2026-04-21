import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';
import { Room } from './pages/Room';
import { APP_VERSION } from './version';

const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

function App() {
  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId" element={<Room />} />
      </Routes>
      <div style={{
        position: 'fixed', bottom: 4, right: 8, zIndex: 9999,
        color: '#444', fontSize: 10, fontFamily: 'monospace',
        pointerEvents: 'none',
      }}>
        {APP_VERSION}
      </div>
    </BrowserRouter>
  );
}

export default App;
