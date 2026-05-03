import { Routes, Route, Navigate } from "react-router-dom";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AppShell } from "@/components/layout/AppShell";

import LandingPage from "@/pages/LandingPage";
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import AuthCallbackPage from "@/pages/AuthCallbackPage";
import ProjectsPage from "@/pages/ProjectsPage";
import ProjectWorkspacePage from "@/pages/ProjectWorkspacePage";
import DocumentViewerPage from "@/pages/DocumentViewerPage";
import SettingsPage from "@/pages/SettingsPage";
import NotFoundPage from "@/pages/NotFoundPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />

      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="projects" replace />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="p/:projectId" element={<ProjectWorkspacePage />} />
        <Route path="p/:projectId/d/:documentId" element={<DocumentViewerPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
