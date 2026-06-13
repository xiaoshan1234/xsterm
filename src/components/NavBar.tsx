import "./NavBar.css";

interface NavBarProps {
  onMenuAction?: (menu: string) => void;
}

const MENU_ITEMS = ["File", "Edit", "View", "Terminal", "Help"];

export default function NavBar({ onMenuAction }: NavBarProps) {
  return (
    <div className="navbar">
      <div className="navbar-logo">XSTerm</div>
      <div className="navbar-menu">
        {MENU_ITEMS.map((item) => (
          <button
            key={item}
            className="navbar-item"
            onClick={() => onMenuAction?.(item)}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}
