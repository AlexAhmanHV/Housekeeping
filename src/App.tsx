import { Navigate, Route, Routes } from "react-router-dom";
import "./styles/theme.css";

import LoginPage from "./auth/LoginPage";
import SignupPage from "./auth/SignupPage";
import ForgotPasswordPage from "./auth/ForgotPasswordPage";
import ResetPasswordPage from "./auth/ResetPasswordPage";

import ProtectedRoute from "./auth/ProtectedRoute";

import AppLayout from "./pages/app/AppLayout";
import OverviewPage from "./pages/app/OverviewPage";
import AccountPage from "./pages/app/AccountPage";
import ImportantPage from "./pages/app/ImportantPage";
import TodosPage from "./pages/app/TodosPage";
import MatPage from "./pages/app/MatPage";
import TasksEventsPage from "./pages/app/TasksEventsPage";
import EconomyPage from "./pages/app/EconomyPage";

export default function App() {
  return (
    <Routes>
      {/* Auth */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot" element={<ForgotPasswordPage />} />
      <Route path="/reset" element={<ResetPasswordPage />} />
    

      {/* App (skyddad) */}
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="shopping" element={<MatPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="important" element={<ImportantPage />} />
        <Route path="todos" element={<TodosPage />} />
        <Route path="agenda" element={<TasksEventsPage />} />
        <Route path="economy" element={<EconomyPage />} />

        {/* Om du fortfarande använder recept-detaljer: */}
        {/* <Route path="recipes/:id" element={<RecipeDetailPage />} /> */}
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
