import React from "react";
import FullDashboardPage from "./pages/FullDashboardPage";
import SimpleJoystickPage from "./pages/SimpleJoystickPage";

export default function App() {
  const isSimple = typeof window !== "undefined" && window.location.pathname.startsWith("/joystick");
  return isSimple ? <SimpleJoystickPage /> : <FullDashboardPage />;
}
