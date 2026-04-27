import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { removeToken } from '../utils/api';

const baseClass =
  'inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium text-neutral-400 hover:text-white border border-white/10 hover:border-white/25 hover:bg-white/5 transition-all';

type Props = { className?: string };

export function LogoutButton({ className = '' }: Props) {
  const navigate = useNavigate();

  const handleLogout = () => {
    removeToken();
    localStorage.removeItem('cuex_workspace_id');
    navigate('/auth', { replace: true });
  };

  return (
    <button type="button" onClick={handleLogout} className={`${baseClass} ${className}`.trim()}>
      <LogOut className="w-4 h-4" strokeWidth={1.5} />
      Log out
    </button>
  );
}
