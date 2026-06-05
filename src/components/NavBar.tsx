import { useState } from "react";

interface NavBarProps {
  onMenuAction?: (menu: string) => void;
}

export default function NavBar({ onMenuAction }: NavBarProps) {
  const menuItems = ["File", "Edit", "View", "Terminal", "Help"];
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const handleClick = (menu: string) => {
    setActiveMenu(menu);
    if (onMenuAction) {
      onMenuAction(menu);
    }
  };

  return (
    <div className="navbar">
      <div className="navbar-logo">XSTerm</div>
      <div className="navbar-menu">
        {menuItems.map((item) => (
          <button
            key={item}
            className={`navbar-item${activeMenu === item ? " active" : ""}`}
            onClick={() => handleClick(item)}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}
