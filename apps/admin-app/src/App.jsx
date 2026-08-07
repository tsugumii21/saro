import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@saro/shared";
import StaffShell from "./components/staff/StaffShell";

// StaffShell renders its own login portal when there is no responder profile,
// so it is the whole app. The prototype's viewport-based DeviceGate is gone —
// this deployment is desktop-first and staff-only by definition.
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <StaffShell />
      </AuthProvider>
    </BrowserRouter>
  );
}
