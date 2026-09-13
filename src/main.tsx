import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// The recorder pill is a second, transparent window that loads this same bundle with "#overlay".
const mode = window.location.hash === "#overlay" ? "overlay" : "main";
document.documentElement.dataset.mode = mode;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App mode={mode} />
  </React.StrictMode>
);
