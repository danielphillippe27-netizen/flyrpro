import { Routes, Route } from 'react-router-dom'
import LeaderboardPage from './components/LeaderboardPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<LeaderboardPage />} />
      <Route path="/leaderboard" element={<LeaderboardPage />} />
    </Routes>
  )
}

export default App
