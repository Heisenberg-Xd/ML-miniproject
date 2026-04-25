import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthPage } from './pages/AuthPage';
import Home from './pages/Home';
import UploadPage from './pages/UploadPage';
import Analytics from './pages/Analytics';
import { getToken } from './utils/api';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = getToken();
  if (!token) {
    return <Navigate to="/auth" replace />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/auth" element={<AuthPage />} />
        
        {/* Protected Routes */}
        <Route path="/upload" element={
          <ProtectedRoute>
            <UploadPage />
          </ProtectedRoute>
        } />
        
        <Route path="/dashboard/:dataset_id" element={
          <ProtectedRoute>
            <Analytics />
          </ProtectedRoute>
        } />
        
        {/* Fallback for missing routes */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
