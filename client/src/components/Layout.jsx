import BottomNav from './BottomNav.jsx';

export default function Layout({ children }) {
  return (
    <div className="app-shell">
      <div className="page">{children}</div>
      <BottomNav />
    </div>
  );
}
