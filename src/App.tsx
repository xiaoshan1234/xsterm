import { useState } from "react";
import Sidebar from "./components/Sidebar";
import Terminal from "./components/Terminal";
import "./App.css";

function App() {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  return (
    <div className="app-container">
      <Sidebar activeMenu={activeMenu} onMenuClick={setActiveMenu} />
      <div className={`main-content ${activeMenu ? "with-menu" : ""}`}>
        <Terminal hasSidebarMenu={!!activeMenu} />
      </div>
    </div>
  );
}

export default App;