import React from "react";
import ReactDOM from "react-dom/client";
import App from "./view/App";
import "./view/styles/tokens.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
