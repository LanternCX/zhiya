import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./elements.css";
import "./motion.css";
import { TooltipProvider } from "./components/ui/tooltip";
import { createHashRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { pageRoutes } from "./routes";
import SharedDeliverable from "./features/deliverables/SharedDeliverable";

const router = createHashRouter([
  { path: "/shares/:token", Component: SharedDeliverable },
  { path: "/", Component: App, children: pageRoutes },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  </StrictMode>,
);
