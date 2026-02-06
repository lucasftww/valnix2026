import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Render React immediately - Firebase handles its own caching
createRoot(document.getElementById("root")!).render(<App />);
